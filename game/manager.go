package game

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"strings"
	"sync"
	"time"

	"github.com/nats-io/nats.go/jetstream"
)

// Player colors for consistent player identification
var playerColors = []string{
	"#4a7c59", // Green (default)
	"#f44336", // Red
	"#2196f3", // Blue
	"#ff9800", // Orange
	"#9c27b0", // Purple
	"#ffeb3b", // Yellow
}

// Manager handles all game state operations
type Manager struct {
	state          GameState
	mutex          sync.RWMutex
	kv             jetstream.KeyValue
	ctx            context.Context
	shellIDCounter int
	getTime        TimeStamper
}

// NewManager creates a new game manager instance
func NewManager(ctx context.Context, kv jetstream.KeyValue) (*Manager, error) {
	manager := &Manager{
		state: GameState{
			Players: make(map[string]PlayerState),
			Shells:  []ShellState{},
		},
		mutex:          sync.RWMutex{},
		kv:             kv,
		ctx:            ctx,
		shellIDCounter: 0,
		getTime:        DefaultTimeStamper,
	}

	// Always ensure we start with an empty players map
	manager.state.Players = make(map[string]PlayerState)
	
	// Save initial empty state to KV
	if err := manager.saveState(); err != nil {
		return nil, fmt.Errorf("failed to save initial game state: %v", err)
	}
	
	log.Printf("Game manager initialized with empty players map")

	// Start background processes
	go manager.runStateCleanup()

	return manager, nil
}

// GetState returns a copy of the current game state
func (m *Manager) GetState() GameState {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	// Create a deep copy to avoid race conditions
	stateCopy := GameState{
		Players: make(map[string]PlayerState, len(m.state.Players)),
		Shells:  make([]ShellState, len(m.state.Shells)),
	}

	// Copy players
	for id, player := range m.state.Players {
		stateCopy.Players[id] = player
	}

	// Copy shells
	copy(stateCopy.Shells, m.state.Shells)

	return stateCopy
}

// UpdatePlayer handles player state updates
func (m *Manager) UpdatePlayer(update PlayerState, playerID string, playerName string) error {
	// Set ID and name in player update
	update.ID = playerID
	update.Name = playerName
	update.Color = m.getPlayerColor(playerID)

	// Get current player state if exists
	m.mutex.RLock()
	currentPlayer, playerExists := m.state.Players[playerID]
	m.mutex.RUnlock()

	// Handle new player joining (not in game state yet)
	if !playerExists {
		// Random offset for spawn position (-20 to 20 range)
		offsetX := -20.0 + rand.Float64()*40.0
		offsetZ := -20.0 + rand.Float64()*40.0

		log.Printf("New player %s joined. Setting spawn position at center with offset (%f, %f)",
			playerID, offsetX, offsetZ)

		// Override position to spawn near center
		update.Position = Position{
			X: offsetX,
			Y: 0,
			Z: offsetZ,
		}

		// Initialize health, kills and deaths for new player
		update.Health = 100
		update.IsDestroyed = false
		update.Kills = 0
		update.Deaths = 0
	} else {
		// If player exists, preserve their current health if not included in update
		if update.Health == 0 {
			update.Health = currentPlayer.Health
		}

		// Maintain destroyed state if already destroyed
		if currentPlayer.IsDestroyed {
			update.IsDestroyed = true
		}
		
		// Preserve existing kills and deaths counts from current player state
		update.Kills = currentPlayer.Kills
		update.Deaths = currentPlayer.Deaths
	}

	// Update player state in game state
	m.mutex.Lock()
	m.state.Players[playerID] = update
	m.mutex.Unlock()

	// NOTE: Physics collision detection will occur in a separate goroutine
	// via the PhysicsIntegration component initiated in main.go

	// Save to KV store
	if err := m.saveState(); err != nil {
		log.Printf("Error saving game state after player update: %v", err)
	}

	log.Printf("Updated player %s at position (%f, %f, %f)",
		playerID,
		update.Position.X,
		update.Position.Y,
		update.Position.Z)

	return nil
}

// FireShell adds a new shell to the game state
func (m *Manager) FireShell(shellData ShellData, playerID string) (ShellState, error) {
	// Generate shell ID
	m.mutex.Lock()
	m.shellIDCounter++
	newShell := ShellState{
		ID:        fmt.Sprintf("shell_%d", m.shellIDCounter),
		PlayerID:  playerID,
		Position:  shellData.Position,
		Direction: shellData.Direction,
		Speed:     shellData.Speed,
		Timestamp: m.getTime(),
	}

	// Add shell to game state
	m.state.Shells = append(m.state.Shells, newShell)

	// Cap the number of shells to avoid memory issues
	if len(m.state.Shells) > 100 {
		m.state.Shells = m.state.Shells[len(m.state.Shells)-100:]
	}
	m.mutex.Unlock()

	// Save to KV store
	if err := m.saveState(); err != nil {
		log.Printf("Error saving game state after shell fired: %v", err)
	}

	log.Printf("Added new shell %s from player %s", newShell.ID, playerID)
	return newShell, nil
}

// ProcessTankHit handles when a tank is hit by a shell
func (m *Manager) ProcessTankHit(hitData HitData) error {
	// Create a transaction function to be executed with proper locking
	processTankHitFunc := func() error {
		// NOTE: Caller must handle locking/unlocking
		
		// Check if target player exists
		if targetPlayer, exists := m.state.Players[hitData.TargetID]; exists {
			// Apply damage to tank
			targetPlayer.Health = targetPlayer.Health - hitData.DamageAmount

			// Check if destroyed
			if targetPlayer.Health <= 0 {
				targetPlayer.Health = 0
				targetPlayer.IsDestroyed = true
				
				// Increment target player's death count
				targetPlayer.Deaths++

				// Increment the source player's kill count if they exist
				if sourcePlayer, sourceExists := m.state.Players[hitData.SourceID]; sourceExists {
					sourcePlayer.Kills++
					m.state.Players[hitData.SourceID] = sourcePlayer
					log.Printf("Incremented kill count for player %s to %d", hitData.SourceID, sourcePlayer.Kills)
				}

				log.Printf("Tank %s destroyed by %s", hitData.TargetID, hitData.SourceID)
			}

			// Save updated player back to game state
			m.state.Players[hitData.TargetID] = targetPlayer
			return nil
		} else {
			// Tank not found in player list - could be an NPC that wasn't properly registered
			// Create a minimal player state for it
			log.Printf("Target tank %s not found - creating placeholder entry", hitData.TargetID)
			
			// Is this an NPC based on ID?
			isNPC := strings.HasPrefix(hitData.TargetID, "npc_")
			
			// Use playerName NPC-Something if we can parse it from ID
			playerName := "Unknown"
			if isNPC {
				// Try to extract NPC name from ID
				parts := strings.Split(hitData.TargetID, "_")
				if len(parts) > 1 {
					playerName = "NPC-" + parts[1]
				} else {
					playerName = "NPC-Unknown"
				}
			}
			
			// Create basic tank state
			newPlayer := PlayerState{
				ID:          hitData.TargetID,
				Name:        playerName,
				Health:      100 - hitData.DamageAmount, // Start with full health minus damage
				Position:    Position{X: 0, Y: 0, Z: 0},  // Default position
				Timestamp:   m.getTime(),
				IsDestroyed: false,
			}
			
			// Check if health is zero
			if newPlayer.Health <= 0 {
				newPlayer.Health = 0
				newPlayer.IsDestroyed = true
				log.Printf("Newly registered tank %s destroyed by %s", hitData.TargetID, hitData.SourceID)
			}
			
			// Add to players map
			m.state.Players[hitData.TargetID] = newPlayer
			
			log.Printf("⚠️ Created new tank entry for %s with health %d", hitData.TargetID, newPlayer.Health)
			return nil
		}
	}
	
	// Acquire lock, process hit, release lock
	m.mutex.Lock()
	err := processTankHitFunc()
	m.mutex.Unlock()
	
	// If we failed to process the hit, return the error
	if err != nil {
		log.Printf("Error processing tank hit: %v", err)
		return err
	}
	
	// Save state after processing hit (without holding lock)
	if err := m.saveState(); err != nil {
		log.Printf("Error saving game state after tank hit: %v", err)
		return err
	}
	
	// Check if this was a killing hit
	m.mutex.RLock()
	targetPlayer, exists := m.state.Players[hitData.TargetID]
	isDestroyed := exists && targetPlayer.IsDestroyed
	m.mutex.RUnlock()
	
	// If tank was destroyed, schedule an auto-respawn
	if isDestroyed {
		// Start a goroutine to respawn the tank after 5 seconds
		go func(playerID string) {
			time.Sleep(5 * time.Second)
			respawnData := RespawnData{
				PlayerID: playerID,
				// Random offset for respawn position
				Position: Position{
					X: -20.0 + rand.Float64()*40.0,
					Y: 0,
					Z: -20.0 + rand.Float64()*40.0,
				},
			}
			if err := m.RespawnTank(respawnData); err != nil {
				log.Printf("Error auto-respawning tank %s: %v", playerID, err)
			} else {
				log.Printf("Auto-respawned tank %s after death", playerID)
			}
		}(hitData.TargetID)
	}
	
	log.Printf("✅ Tank hit processed successfully: Target=%s, Source=%s, Damage=%d", 
		hitData.TargetID, hitData.SourceID, hitData.DamageAmount)
	
	return nil
}

// RespawnTank handles tank respawn events
func (m *Manager) RespawnTank(respawnData RespawnData) error {
	// Update player in game state
	m.mutex.Lock()
	if player, exists := m.state.Players[respawnData.PlayerID]; exists {
		// Reset health and destroyed status
		player.Health = 100
		player.IsDestroyed = false
		
		// Keep existing kills and deaths (don't reset them on respawn)
		// Increment death count only happens in ProcessTankHit
		
		// Update timestamp to ensure state propagation
		player.Timestamp = m.getTime()

		// Update position if provided
		if (respawnData.Position != Position{}) {
			player.Position = respawnData.Position
		} else {
			// Random offset for respawn position
			offsetX := -20.0 + rand.Float64()*40.0
			offsetZ := -20.0 + rand.Float64()*40.0

			player.Position = Position{
				X: offsetX,
				Y: 0,
				Z: offsetZ,
			}
		}
		
		// Update timestamp to ensure state propagation
		player.Timestamp = m.getTime()

		// Save updated player back to game state
		m.state.Players[respawnData.PlayerID] = player

		log.Printf("✅ RESPAWN: Tank %s respawned with health=%d, destroyed=%v at position (%f, %f, %f)",
			respawnData.PlayerID,
			player.Health, 
			player.IsDestroyed,
			player.Position.X,
			player.Position.Y,
			player.Position.Z)

		m.mutex.Unlock()

		// Save to KV store
		if err := m.saveState(); err != nil {
			log.Printf("Error saving game state after tank respawn: %v", err)
			return err
		}

		return nil
	} else {
		// Player not found, create a new one
		log.Printf("Player %s not found for respawn, creating new entry", respawnData.PlayerID)
		
		// Random offset for respawn position or use provided position
		var position Position
		if (respawnData.Position != Position{}) {
			position = respawnData.Position
		} else {
			// Random offset for respawn position
			offsetX := -20.0 + rand.Float64()*40.0
			offsetZ := -20.0 + rand.Float64()*40.0

			position = Position{
				X: offsetX,
				Y: 0,
				Z: offsetZ,
			}
		}
		
		// Create new player state
		playerName := "Player"
		if respawnData.PlayerID != "" {
			playerName = "Player: " + respawnData.PlayerID[:6]
		}
		
		// Create new player
		newPlayer := PlayerState{
			ID:          respawnData.PlayerID,
			Name:        playerName,
			Position:    position,
			Health:      100,
			IsDestroyed: false,
			Timestamp:   m.getTime(),
			Color:       m.getPlayerColor(respawnData.PlayerID),
		}
		
		// Add to game state
		m.state.Players[respawnData.PlayerID] = newPlayer
		
		log.Printf("✅ RESPAWN: Created new tank for %s with health=100 at position (%f, %f, %f)",
			respawnData.PlayerID,
			position.X,
			position.Y,
			position.Z)
		
		m.mutex.Unlock()
		
		// Save to KV store
		if err := m.saveState(); err != nil {
			log.Printf("Error saving game state after new player creation: %v", err)
			return err
		}
		
		return nil
	}
}

// Get player color based on ID
func (m *Manager) getPlayerColor(id string) string {
	// Simple hash of the ID to determine color index
	var sum int
	for _, char := range id {
		sum += int(char)
	}
	index := sum % len(playerColors)
	return playerColors[index]
}

// Load game state from KV store
func (m *Manager) loadState() error {
	entry, err := m.kv.Get(m.ctx, "current")
	if err != nil {
		return err
	}

	// Unmarshal game state
	m.mutex.Lock()
	defer m.mutex.Unlock()

	if err := json.Unmarshal(entry.Value(), &m.state); err != nil {
		return err
	}

	log.Printf("Loaded game state from KV store with %d players and %d shells",
		len(m.state.Players), len(m.state.Shells))

	return nil
}

// Save game state to KV store
func (m *Manager) saveState() error {
	// Don't hold the lock during potentially slow KV operations
	var stateJSON []byte
	var err error
	
	// Use a copy of state under read lock
	m.mutex.RLock()
	// Deep copy the state to avoid concurrent map access issues
	stateCopy := GameState{
		Players: make(map[string]PlayerState, len(m.state.Players)),
		Shells:  make([]ShellState, len(m.state.Shells)),
	}
	
	// Copy players map
	for id, player := range m.state.Players {
		stateCopy.Players[id] = player
	}
	
	// Copy shells slice 
	copy(stateCopy.Shells, m.state.Shells)
	m.mutex.RUnlock()
	
	// Marshal the copied state
	stateJSON, err = json.Marshal(stateCopy)
	if err != nil {
		log.Printf("Error marshaling game state: %v", err)
		return fmt.Errorf("error marshaling game state: %v", err)
	}

	// Perform KV operation without holding lock
	_, err = m.kv.Put(m.ctx, "current", stateJSON)
	if err != nil {
		log.Printf("Error saving game state to KV: %v", err)
		return fmt.Errorf("error saving game state to KV: %v", err)
	}

	// Log successful save occasionally
	if time.Now().UnixNano()%100 == 0 {
		log.Printf("Game state saved successfully: %d players, %d shells", 
			len(stateCopy.Players), len(stateCopy.Shells))
	}
	
	return nil
}

// Cleanup inactive players and expired shells
func (m *Manager) runStateCleanup() {
	for {
		m.cleanupGameState()

		// Save current game state to KV store
		if err := m.saveState(); err != nil {
			log.Printf("Error saving game state during cleanup: %v", err)
		}

		time.Sleep(250 * time.Millisecond)
	}
}

// WatchState creates a watcher for game state changes
// Returns the KeyWatcher directly so caller can use its Updates() channel
func (m *Manager) WatchState(ctx context.Context) (jetstream.KeyWatcher, error) {
	// Create a watcher for the KV store
	watcher, err := m.kv.Watch(ctx, "current")
	if err != nil {
		return nil, fmt.Errorf("failed to create KV watcher: %v", err)
	}

	return watcher, nil
}

// RemoveShells removes specific shells by ID from game state
func (m *Manager) RemoveShells(shellIDs []string) error {
	if len(shellIDs) == 0 {
		return nil
	}
	
	// First, create a function to handle the shell updates with proper locking
	removeShellsFunc := func() []ShellState {
		// NOTE: The caller must handle locking
		
		// Create a map for faster lookup of shell IDs to remove
		removeMap := make(map[string]bool)
		for _, id := range shellIDs {
			removeMap[id] = true
		}
		
		// Filter out shells that should be removed
		var remainingShells []ShellState
		var removedCount int
		for _, shell := range m.state.Shells {
			if !removeMap[shell.ID] {
				remainingShells = append(remainingShells, shell)
			} else {
				removedCount++
			}
		}
		
		// Update shells in game state
		m.state.Shells = remainingShells
		
		if removedCount > 0 {
			log.Printf("Removed %d shells from state", removedCount)
		}
		
		return remainingShells
	}
	
	// Acquire lock, process shell removal, release lock
	m.mutex.Lock()
	removeShellsFunc()
	m.mutex.Unlock()
	
	// Save state without holding the lock
	if err := m.saveState(); err != nil {
		log.Printf("Error saving game state after removing shells: %v", err)
		return err
	}
	
	return nil
}

// cleanupGameState removes inactive players and expired shells
func (m *Manager) cleanupGameState() {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	now := m.getTime()

	// Clean up inactive players
	for id, player := range m.state.Players {
		// If player hasn't updated in 10 seconds, remove them
		if now-player.Timestamp > 10000 {
			log.Printf("Removing inactive player: %s", id)
			delete(m.state.Players, id)
		}
	}

	// Clean up expired shells (older than 5 seconds - increased from 3 to account for travel time)
	var activeShells []ShellState
	var expiredCount int
	for _, shell := range m.state.Shells {
		if now-shell.Timestamp < 5000 {
			activeShells = append(activeShells, shell)
		} else {
			expiredCount++
		}
	}

	if expiredCount > 0 {
		log.Printf("Removed %d expired shells during cleanup", expiredCount)
	}

	// Limit total number of shells to avoid excessive processing
	if len(activeShells) > 50 {
		// Keep only the most recent 50 shells
		activeShells = activeShells[len(activeShells)-50:]
		log.Printf("Limited shell count to 50 (was %d)", len(activeShells))
	}

	// Update shells in game state
	m.state.Shells = activeShells
}
