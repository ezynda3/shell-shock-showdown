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

	// Load initial state from KV
	if err := manager.loadState(); err != nil {
		// Only log the error, but don't fail initialization
		log.Printf("Error loading initial game state: %v, starting with fresh state", err)

		// Save initial state to KV
		if err := manager.saveState(); err != nil {
			return nil, fmt.Errorf("failed to save initial game state: %v", err)
		}
	}

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

		// Initialize health for new player
		update.Health = 100
		update.IsDestroyed = false
	} else {
		// If player exists, preserve their current health if not included in update
		if update.Health == 0 {
			update.Health = currentPlayer.Health
		}

		// Maintain destroyed state if already destroyed
		if currentPlayer.IsDestroyed {
			update.IsDestroyed = true
		}
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

		// Save updated player back to game state
		m.state.Players[respawnData.PlayerID] = player

		m.mutex.Unlock()

		// Save to KV store
		if err := m.saveState(); err != nil {
			log.Printf("Error saving game state after tank respawn: %v", err)
		}

		log.Printf("Tank %s respawned at position (%f, %f, %f)",
			respawnData.PlayerID,
			player.Position.X,
			player.Position.Y,
			player.Position.Z)

		return nil
	} else {
		m.mutex.Unlock()
		return fmt.Errorf("player %s not found for respawn", respawnData.PlayerID)
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
