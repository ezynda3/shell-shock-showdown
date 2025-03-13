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
	state              GameState
	mutex              sync.RWMutex
	kv                 jetstream.KeyValue
	ctx                context.Context
	shellIDCounter     int
	getTime            TimeStamper
	lastPlayerFireTime map[string]int64 // Map to track the last time each player fired a shell
	fireCooldownMs     int64            // Cooldown time between firing shells
}

// NewManager creates a new game manager instance
func NewManager(ctx context.Context, kv jetstream.KeyValue) (*Manager, error) {
	manager := &Manager{
		state: GameState{
			Players: make(map[string]PlayerState),
			Shells:  []ShellState{},
		},
		mutex:              sync.RWMutex{},
		kv:                 kv,
		ctx:                ctx,
		shellIDCounter:     0,
		getTime:            DefaultTimeStamper,
		lastPlayerFireTime: make(map[string]int64),
		fireCooldownMs:     500, // 500ms cooldown between shell firings
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
		// Random position anywhere on the 5000x5000 map
		posX := -2500.0 + rand.Float64()*5000.0
		posZ := -2500.0 + rand.Float64()*5000.0

		log.Printf("New player %s joined. Setting spawn position at (%f, %f)",
			playerID, posX, posZ)

		// Set spawn position across full map
		update.Position = Position{
			X: posX,
			Y: 0,
			Z: posZ,
		}

		// Initialize health, kills and deaths for new player
		update.Health = 100
		update.IsDestroyed = false
		update.Status = StatusReady // New player starts in READY state
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

		// Keep current player status unless explicitly changed
		if update.Status == "" {
			update.Status = currentPlayer.Status
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

// FireShell adds a new shell to the game state with debouncing
func (m *Manager) FireShell(shellData ShellData, playerID string) (ShellState, error) {
	// Apply debouncing logic
	currentTime := m.getTime()

	m.mutex.Lock()

	// Check if the player has fired recently
	lastFireTime, exists := m.lastPlayerFireTime[playerID]
	if exists && (currentTime-lastFireTime < m.fireCooldownMs) {
		// Player is trying to fire too quickly
		m.mutex.Unlock()
		log.Printf("Rejected shell firing from player %s: cooldown in effect", playerID)
		return ShellState{}, fmt.Errorf("firing too rapidly, please wait %dms between shots", m.fireCooldownMs)
	}

	// Update the last fire time for this player
	m.lastPlayerFireTime[playerID] = currentTime

	// Generate shell ID
	m.shellIDCounter++
	newShell := ShellState{
		ID:        fmt.Sprintf("shell_%d", m.shellIDCounter),
		PlayerID:  playerID,
		Position:  shellData.Position,
		Direction: shellData.Direction,
		Speed:     shellData.Speed,
		Timestamp: currentTime,
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

// ProcessTankHit handles when a tank is hit by a shell - server is authoritative for all damage
func (m *Manager) ProcessTankHit(hitData HitData) error {
	// Create a transaction function to be executed with proper locking
	processTankHitFunc := func() error {
		// NOTE: Caller must handle locking/unlocking

		// Set timestamp if not already set
		if hitData.Timestamp == 0 {
			hitData.Timestamp = m.getTime()
		}

		// Check if target player exists
		if targetPlayer, exists := m.state.Players[hitData.TargetID]; exists {
			// Skip if tank is already destroyed
			if targetPlayer.IsDestroyed {
				log.Printf("🛑 INVALID HIT: Tank %s is already destroyed, ignoring hit", hitData.TargetID)
				return nil
			}

			// Log detailed hit location info for debugging
			log.Printf("🎯 DAMAGE: Tank %s hit on %s for %d damage by %s",
				hitData.TargetID, hitData.HitLocation, hitData.DamageAmount, hitData.SourceID)

			// Additional validation to prevent excessive damage
			// Ensure damage isn't excessive (more than 50 per hit)
			if hitData.DamageAmount > 50 {
				log.Printf("⚠️ EXCESSIVE DAMAGE CAPPED: Reducing %d to 50 for tank %s",
					hitData.DamageAmount, hitData.TargetID)
				hitData.DamageAmount = 50
			}

			// Log health before damage
			log.Printf("HEALTH UPDATE: Tank %s health before hit: %d", hitData.TargetID, targetPlayer.Health)

			// Apply damage to tank
			targetPlayer.Health = targetPlayer.Health - hitData.DamageAmount

			// Log health after damage
			log.Printf("HEALTH UPDATE: Tank %s health after hit: %d", hitData.TargetID, targetPlayer.Health)

			// Check if destroyed
			if targetPlayer.Health <= 0 {
				targetPlayer.Health = 0
				targetPlayer.IsDestroyed = true
				targetPlayer.Status = StatusDestroyed // Update player status to DESTROYED

				// Increment target player's death count
				targetPlayer.Deaths++

				// Increment the source player's kill count if they exist
				if sourcePlayer, sourceExists := m.state.Players[hitData.SourceID]; sourceExists {
					sourcePlayer.Kills++
					m.state.Players[hitData.SourceID] = sourcePlayer
					log.Printf("Incremented kill count for player %s to %d", hitData.SourceID, sourcePlayer.Kills)
				}

				// Track kill information for client notifications
				targetPlayer.LastKilledBy = hitData.SourceID
				targetPlayer.LastDeathTime = m.getTime()

				// Get killer and victim names for notification
				killerName := "Unknown"
				victimName := "Unknown"

				if sourcePlayer, exists := m.state.Players[hitData.SourceID]; exists {
					killerName = sourcePlayer.Name
				}

				victimName = targetPlayer.Name

				// Create notification message for client display
				notification := fmt.Sprintf("%s destroyed %s", killerName, victimName)

				// This will be handled by signals in the frontend
				targetPlayer.Notification = notification

				log.Printf("💥 DESTRUCTION: %s", notification)
			}

			// Save updated player back to game state
			m.state.Players[hitData.TargetID] = targetPlayer
			return nil
		} else {
			// Tank not found in player list - could be an NPC that wasn't properly registered
			// Create a minimal player state for it
			log.Printf("Target tank %s not found - creating placeholder entry", hitData.TargetID)

			// Is this a bot based on ID?
			isBot := strings.HasPrefix(hitData.TargetID, "bot_")

			// Use a default name for bots that we can't identify
			playerName := "Unknown"
			if isBot {
				// Use a generic bot name since we can't recover the original name
				playerName = "Mystery Bot"
			}

			// Create basic tank state
			newPlayer := PlayerState{
				ID:          hitData.TargetID,
				Name:        playerName,
				Health:      100 - hitData.DamageAmount, // Start with full health minus damage
				Position:    Position{X: 0, Y: 0, Z: 0}, // Default position
				Timestamp:   m.getTime(),
				IsDestroyed: false,
				Status:      StatusActive, // Default to active status
			}

			// Check if health is zero
			if newPlayer.Health <= 0 {
				newPlayer.Health = 0
				newPlayer.IsDestroyed = true
				newPlayer.Status = StatusDestroyed // Update player status to DESTROYED
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

	// If tank was destroyed, log that it is now waiting for manual respawn
	if isDestroyed {
		log.Printf("🚨 AWAITING RESPAWN: Tank %s was destroyed and is waiting for explicit respawn request", hitData.TargetID)
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
		player.Status = StatusActive // Set player status to ACTIVE

		// Keep existing kills and deaths (don't reset them on respawn)
		// Increment death count only happens in ProcessTankHit

		// Reset movement-related properties
		player.IsMoving = false
		player.Velocity = 0.0                                 // Start with zero velocity to prevent erratic movement
		player.TurretRotation = player.TankRotation           // Reset turret to match tank
		player.Color = m.getPlayerColor(respawnData.PlayerID) // Ensure color is set consistently

		// Update timestamp to ensure state propagation
		player.Timestamp = m.getTime()

		// Update position - always use the full map range like in UpdatePlayer
		// Random position anywhere on the 5000x5000 map
		player.Position = Position{
			X: -2500.0 + rand.Float64()*5000.0,
			Y: 0,
			Z: -2500.0 + rand.Float64()*5000.0,
		}

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

		// Use playerID as both ID and name, like in UpdatePlayer
		playerID := respawnData.PlayerID

		// Random position anywhere on the 5000x5000 map (same as in UpdatePlayer)
		posX := -2500.0 + rand.Float64()*5000.0
		posZ := -2500.0 + rand.Float64()*5000.0

		log.Printf("New player %s joined via respawn. Setting spawn position at (%f, %f)",
			playerID, posX, posZ)

		// Create new player with same initialization as UpdatePlayer
		newPlayer := PlayerState{
			ID:   playerID,
			Name: playerID, // Use ID as name like UpdatePlayer would
			Position: Position{
				X: posX,
				Y: 0,
				Z: posZ,
			},
			Health:      100,
			IsDestroyed: false,
			Kills:       0,
			Deaths:      0,
			Status:      StatusActive, // Player is active
			Timestamp:   m.getTime(),
			Color:       m.getPlayerColor(playerID),
			IsMoving:    false,
			Velocity:    0.0,
		}

		// Add to game state
		m.state.Players[playerID] = newPlayer

		log.Printf("✅ RESPAWN: Created new tank for %s with health=100 at position (%f, %f, %f)",
			playerID,
			posX,
			0.0,
			posZ)

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
	watcher, err := m.kv.Watch(ctx, "current", jetstream.UpdatesOnly())
	if err != nil {
		return nil, fmt.Errorf("failed to create KV watcher: %v", err)
	}

	return watcher, nil
}

// RemovePlayer removes a player by ID from the game state
func (m *Manager) RemovePlayer(playerID string) error {
	if playerID == "" {
		return fmt.Errorf("playerID cannot be empty")
	}
	
	// Check if player exists first
	m.mutex.RLock()
	_, exists := m.state.Players[playerID]
	m.mutex.RUnlock()
	
	if !exists {
		return fmt.Errorf("player with ID %s not found", playerID)
	}
	
	// Remove the player from game state
	m.mutex.Lock()
	delete(m.state.Players, playerID)
	
	// Also clean up the lastPlayerFireTime entry for this player
	delete(m.lastPlayerFireTime, playerID)
	
	log.Printf("Player %s has been removed from the game state", playerID)
	m.mutex.Unlock()
	
	// Save to KV store
	if err := m.saveState(); err != nil {
		log.Printf("Error saving game state after removing player: %v", err)
		return fmt.Errorf("error saving game state after removing player: %v", err)
	}
	
	return nil
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

			// Also clean up the lastPlayerFireTime entry for this player
			delete(m.lastPlayerFireTime, id)
		}

		// Check if player has inconsistent state (destroyed but positive health)
		if player.IsDestroyed && player.Health > 0 {
			log.Printf("🔄 FIXING INCONSISTENT STATE: Player %s has health=%d but is marked destroyed, correcting state", id, player.Health)
			player.IsDestroyed = false
			player.Status = StatusActive
			m.state.Players[id] = player
			continue
		}

		// Auto-respawn destroyed players after 5 seconds
		if player.IsDestroyed && player.Status == StatusDestroyed {
			// Check if 5 seconds have passed since death
			if player.LastDeathTime > 0 && now-player.LastDeathTime >= 5000 {
				log.Printf("Auto-respawning player %s after 5 seconds", id)

				// Reset health and destroyed status
				player.Health = 100
				player.IsDestroyed = false
				player.Status = StatusActive // Set player status to ACTIVE immediately

				// Random position anywhere on the 5000x5000 map
				player.Position = Position{
					X: -2500.0 + rand.Float64()*5000.0,
					Y: 0,
					Z: -2500.0 + rand.Float64()*5000.0,
				}

				// Reset movement state
				player.IsMoving = false
				player.Velocity = 0.0

				// Set timestamp for this update
				player.Timestamp = now

				// Save back to player map
				m.state.Players[id] = player

				log.Printf("✅ AUTO-RESPAWN: Tank %s respawned with health=%d, destroyed=%v, status=%s at position (%f, %f, %f)",
					id,
					player.Health,
					player.IsDestroyed,
					player.Status,
					player.Position.X,
					player.Position.Y,
					player.Position.Z)
			}
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
