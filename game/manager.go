package game

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
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
	// Update player health in game state
	m.mutex.Lock()
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

		// Save to KV store
		m.mutex.Unlock()
		if err := m.saveState(); err != nil {
			log.Printf("Error saving game state after tank hit: %v", err)
		}

		return nil
	} else {
		m.mutex.Unlock()
		return fmt.Errorf("target player %s not found", hitData.TargetID)
	}
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
	m.mutex.RLock()
	stateJSON, err := json.Marshal(m.state)
	m.mutex.RUnlock()

	if err != nil {
		return fmt.Errorf("error marshaling game state: %v", err)
	}

	if _, err := m.kv.Put(m.ctx, "current", stateJSON); err != nil {
		return fmt.Errorf("error saving game state to KV: %v", err)
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

	// Clean up expired shells (older than 3 seconds)
	var activeShells []ShellState
	for _, shell := range m.state.Shells {
		if now-shell.Timestamp < 3000 {
			activeShells = append(activeShells, shell)
		} else {
			log.Printf("Removing expired shell: %s", shell.ID)
		}
	}

	// Limit total number of shells to avoid excessive processing
	if len(activeShells) > 50 {
		// Keep only the most recent 50 shells
		activeShells = activeShells[len(activeShells)-50:]
	}

	// Update shells in game state
	m.state.Shells = activeShells
}
