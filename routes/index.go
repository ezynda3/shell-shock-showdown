package routes

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"sync"
	"time"

	"github.com/mark3labs/pro-saaskit/middleware"
	"github.com/mark3labs/pro-saaskit/views"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	datastar "github.com/starfederation/datastar/sdk/go"
)

// Position represents a 3D position
type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

// PlayerState represents the state of a player in the game
type PlayerState struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	Position        Position `json:"position"`
	TankRotation    float64  `json:"tankRotation"`
	TurretRotation  float64  `json:"turretRotation"`
	BarrelElevation float64  `json:"barrelElevation"`
	Health          int      `json:"health"`
	IsMoving        bool     `json:"isMoving"`
	Velocity        float64  `json:"velocity"`
	Timestamp       int64    `json:"timestamp"`
	Color           string   `json:"color,omitempty"`
	IsDestroyed     bool     `json:"isDestroyed"`
}

// ShellState represents the state of a shell
type ShellState struct {
	ID        string   `json:"id"`
	PlayerID  string   `json:"playerId"`
	Position  Position `json:"position"`
	Direction Position `json:"direction"`
	Speed     float64  `json:"speed"`
	Timestamp int64    `json:"timestamp"`
}

// GameState represents the state of the entire game
type GameState struct {
	Players map[string]PlayerState `json:"players"`
	Shells  []ShellState           `json:"shells"`
}

// Signals struct for handling DataStar signals
type Signals struct {
	Update     string `json:"update"`
	ShellFired string `json:"shellFired"`
	GameState  string `json:"gameState"`
	TankHit    string `json:"tankHit"`     // New signal for tank being hit
	TankDeath  string `json:"tankDeath"`   // New signal for tank being destroyed
	TankRespawn string `json:"tankRespawn"` // New signal for tank respawning
}

var (
	// Global game state with player information
	gameState = GameState{
		Players: make(map[string]PlayerState),
		Shells:  []ShellState{},
	}
	gameStateMutex sync.RWMutex

	// Shell ID counter
	shellIDCounter = 0

	// Player colors for consistent player identification
	playerColors = []string{
		"#4a7c59", // Green (default)
		"#f44336", // Red
		"#2196f3", // Blue
		"#ff9800", // Orange
		"#9c27b0", // Purple
		"#ffeb3b", // Yellow
	}
)

// Get player color based on ID
func getPlayerColor(id string) string {
	// Simple hash of the ID to determine color index
	var sum int
	for _, char := range id {
		sum += int(char)
	}
	index := sum % len(playerColors)
	return playerColors[index]
}

// Cleanup inactive players and expired shells
func cleanupGameState() {
	gameStateMutex.Lock()
	defer gameStateMutex.Unlock()

	now := time.Now().UnixMilli()

	// Clean up inactive players
	for id, player := range gameState.Players {
		// If player hasn't updated in 10 seconds, remove them
		if now-player.Timestamp > 10000 {
			log.Printf("Removing inactive player: %s", id)
			delete(gameState.Players, id)
		}
	}

	// Clean up expired shells (older than 3 seconds)
	var activeShells []ShellState
	for _, shell := range gameState.Shells {
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
	gameState.Shells = activeShells
}

func setupIndexRoutes(router *router.Router[*core.RequestEvent], nc *nats.Conn, js jetstream.JetStream, kv jetstream.KeyValue) error {
	// Initialize random seed for spawn positions
	rand.Seed(time.Now().UnixNano())

	// Create a group for protected routes
	protected := router.Group("")
	protected.BindFunc(middleware.AuthGuard)

	// Load initial game state from KV store or initialize if not exists
	ctx := context.Background()
	entry, err := kv.Get(ctx, "current")
	if err == nil {
		// Game state exists, unmarshal it
		if err := json.Unmarshal(entry.Value(), &gameState); err != nil {
			log.Printf("Error unmarshaling game state from KV: %v, initializing new state", err)
			// Initialize gameState with defaults (already done in var declaration)
		}
		log.Printf("Loaded game state from KV store with %d players and %d shells", 
			len(gameState.Players), len(gameState.Shells))
	} else {
		log.Printf("No existing game state found in KV store, initializing new state")
		// Initialize gameState with defaults (already done in var declaration)
		
		// Save initial game state to KV
		stateJSON, _ := json.Marshal(gameState)
		if _, err := kv.Put(ctx, "current", stateJSON); err != nil {
			log.Printf("Error saving initial game state to KV: %v", err)
		}
	}

	// Start a goroutine to clean up inactive players and expired shells
	// and periodically save to KV store
	go func() {
		for {
			// Clean up game state
			cleanupGameState()
			
			// Save current game state to KV store
			gameStateMutex.RLock()
			stateJSON, err := json.Marshal(gameState)
			gameStateMutex.RUnlock()
			
			if err == nil {
				if _, err := kv.Put(ctx, "current", stateJSON); err != nil {
					log.Printf("Error saving game state to KV: %v", err)
				}
			} else {
				log.Printf("Error marshaling game state for KV: %v", err)
			}
			
			time.Sleep(2 * time.Second)
		}
	}()

	// POST route for update endpoint
	router.POST("/update", func(e *core.RequestEvent) error {
		signals := &Signals{}
		if err := datastar.ReadSignals(e.Request, signals); err != nil {
			log.Println("Error reading signals:", err)
			return e.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		}

		sse := datastar.NewSSE(e.Response, e.Request)

			// Handle tank hit events from frontend
			if signals.TankHit != "" {
				var hitData struct {
					TargetID     string `json:"targetId"`
					SourceID     string `json:"sourceId"`
					DamageAmount int    `json:"damageAmount"`
				}
				
				if err := json.Unmarshal([]byte(signals.TankHit), &hitData); err != nil {
					log.Println("Error unmarshaling tank hit data:", err)
					return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid tank hit data"})
				}
				
				// Update player health in game state
				gameStateMutex.Lock()
				if targetPlayer, exists := gameState.Players[hitData.TargetID]; exists {
					// Apply damage to tank
					targetPlayer.Health = targetPlayer.Health - hitData.DamageAmount
					
					// Check if destroyed
					if targetPlayer.Health <= 0 {
						targetPlayer.Health = 0
						targetPlayer.IsDestroyed = true
						
						// Publish tank death event to NATS
						deathData := map[string]interface{}{
							"targetId": hitData.TargetID,
							"sourceId": hitData.SourceID,
						}
						deathJSON, _ := json.Marshal(deathData)
						if err := nc.Publish("tanks.death", deathJSON); err != nil {
							log.Printf("Error publishing tank death event to NATS: %v", err)
						}
						
						log.Printf("Tank %s destroyed by %s", hitData.TargetID, hitData.SourceID)
					}
					
					// Save updated player back to game state
					gameState.Players[hitData.TargetID] = targetPlayer
					
					// Publish tank hit event to NATS
					hitJSON, _ := json.Marshal(map[string]interface{}{
						"targetId": hitData.TargetID,
						"sourceId": hitData.SourceID,
						"health": targetPlayer.Health,
					})
					if err := nc.Publish("tanks.hit", hitJSON); err != nil {
						log.Printf("Error publishing tank hit event to NATS: %v", err)
					}
				}
				gameStateMutex.Unlock()
			}
			
			// Handle tank respawn events from frontend
			if signals.TankRespawn != "" {
				var respawnData struct {
					PlayerID string   `json:"playerId"`
					Position Position `json:"position"`
				}
				
				if err := json.Unmarshal([]byte(signals.TankRespawn), &respawnData); err != nil {
					log.Println("Error unmarshaling tank respawn data:", err)
					return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid tank respawn data"})
				}
				
				// Update player in game state
				gameStateMutex.Lock()
				if player, exists := gameState.Players[respawnData.PlayerID]; exists {
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
					gameState.Players[respawnData.PlayerID] = player
					
					// Publish respawn event to NATS
					respawnJSON, _ := json.Marshal(player)
					if err := nc.Publish("tanks.respawn", respawnJSON); err != nil {
						log.Printf("Error publishing tank respawn event to NATS: %v", err)
					}
					
					log.Printf("Tank %s respawned at position (%f, %f, %f)", 
						respawnData.PlayerID, 
						player.Position.X, 
						player.Position.Y, 
						player.Position.Z)
				}
				gameStateMutex.Unlock()
			}
			
						// Handle shell firing events
					if signals.ShellFired != "" {
			var shellData struct {
				Position  Position `json:"position"`
				Direction Position `json:"direction"`
				Speed     float64  `json:"speed"`
			}

			if err := json.Unmarshal([]byte(signals.ShellFired), &shellData); err != nil {
				log.Println("Error unmarshaling shell data:", err)
				return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid shell data"})
			}

			// Get player ID
			playerID := "guest"
			authRecord := e.Auth
			if authRecord != nil {
				playerID = authRecord.Id
			}

			// Generate shell ID
			gameStateMutex.Lock()
			shellIDCounter++
			newShell := ShellState{
				ID:        fmt.Sprintf("shell_%d", shellIDCounter),
				PlayerID:  playerID,
				Position:  shellData.Position,
				Direction: shellData.Direction,
				Speed:     shellData.Speed,
				Timestamp: time.Now().UnixMilli(),
			}

			// Add shell to game state
			gameState.Shells = append(gameState.Shells, newShell)

			// Cap the number of shells to avoid memory issues
			if len(gameState.Shells) > 100 {
				gameState.Shells = gameState.Shells[len(gameState.Shells)-100:]
			}
			gameStateMutex.Unlock()

			// Publish shell fired event to NATS
			shellJSON, _ := json.Marshal(newShell)
			if err := nc.Publish("shells.fired", shellJSON); err != nil {
				log.Printf("Error publishing shell fired event to NATS: %v", err)
			}

			log.Printf("Added new shell %s from player %s", newShell.ID, playerID)
			sse.MergeSignals([]byte("{shellFired:''}"))
		}

		// Parse the player update from the update signal
		if signals.Update != "" {
			var playerUpdate PlayerState
			if err := json.Unmarshal([]byte(signals.Update), &playerUpdate); err != nil {
				log.Println("Error unmarshaling player update:", err)
				return e.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
			}

			// Get player ID from auth
			playerID := "guest"
			authRecord := e.Auth
			if authRecord != nil {
				playerID = authRecord.Id
			}

			// Get username from auth
			playerName := "Guest"
			if authRecord != nil {
				// Use Email() accessor method from the auth record
				email := authRecord.Email()
				if email != "" {
					playerName = email
				}
			}

			// Set ID and name in player update
			playerUpdate.ID = playerID
			playerUpdate.Name = playerName
			playerUpdate.Color = getPlayerColor(playerID)

			// Get current player state if exists
			gameStateMutex.RLock()
			currentPlayer, playerExists := gameState.Players[playerID]
			gameStateMutex.RUnlock()

			// Handle new player joining (not in game state yet)
			if !playerExists {
				// Random offset for spawn position (-20 to 20 range)
				offsetX := -20.0 + rand.Float64()*40.0
				offsetZ := -20.0 + rand.Float64()*40.0

				log.Printf("New player %s joined. Setting spawn position at center with offset (%f, %f)",
					playerID, offsetX, offsetZ)

				// Override position to spawn near center
				playerUpdate.Position = Position{
					X: offsetX,
					Y: 0,
					Z: offsetZ,
				}
				
				// Initialize health for new player
				playerUpdate.Health = 100
				playerUpdate.IsDestroyed = false
			} else {
				// If player exists, preserve their current health if not included in update
				if playerUpdate.Health == 0 {
					playerUpdate.Health = currentPlayer.Health
				}
				
				// Maintain destroyed state if already destroyed
				if currentPlayer.IsDestroyed {
					playerUpdate.IsDestroyed = true
				}
			}

			// Update player state in game state
			gameStateMutex.Lock()
			gameState.Players[playerID] = playerUpdate
			gameStateMutex.Unlock()

			// Publish player update to NATS
			playerJSON, _ := json.Marshal(playerUpdate)
			if err := nc.Publish("players.updated", playerJSON); err != nil {
				log.Printf("Error publishing player update to NATS: %v", err)
			}

			log.Printf("Updated player %s at position (%f, %f, %f)",
				playerID,
				playerUpdate.Position.X,
				playerUpdate.Position.Y,
				playerUpdate.Position.Z)
		}

		return e.JSON(http.StatusOK, map[string]bool{"success": true})
	})

	// GET route for gamestate endpoint
	router.GET("/gamestate", func(e *core.RequestEvent) error {
		sse := datastar.NewSSE(e.Response, e.Request)

		for {
			select {
			case <-e.Request.Context().Done():
				return nil
			default:
				// Get current game state
				gameStateMutex.RLock()
				stateJSON, err := json.Marshal(gameState)
				gameStateMutex.RUnlock()

				if err != nil {
					log.Println("Error marshaling game state:", err)
					stateJSON = []byte(`{"gameState": "error"}`)
				}

				// Log game state for debugging
				log.Printf("Broadcasting game state with %d players and %d shells",
					len(gameState.Players),
					len(gameState.Shells))

				// Send the game state directly as a string with proper escaping
				err = sse.MergeSignals([]byte(fmt.Sprintf(`{"gameState": %q}`, string(stateJSON))))
				if err != nil {
					log.Printf("Error sending game state: %v", err)
				}

				// Add a small delay to reduce CPU usage and network traffic
				time.Sleep(100 * time.Millisecond)
			}
		}
	})

	// Add routes to protected group
	protected.GET("/", func(e *core.RequestEvent) error {

		log.Println(e.Auth)

		ctx := context.WithValue(context.Background(), "user", e.Auth)

		return views.Index().Render(ctx, e.Response)
	})

	protected.GET("/sse", func(e *core.RequestEvent) error {
		sse := datastar.NewSSE(e.Response, e.Request)

		for {
			select {
			case <-e.Request.Context().Done():
				return nil
			default:
				hours, minutes, seconds := views.GetTimeComponents()
				_ = sse.ExecuteScript(fmt.Sprintf("console.log('%v:%v:%v')", hours, minutes, seconds))
				_ = sse.MergeFragmentTempl(views.Clock(hours, minutes, seconds))
			}

			time.Sleep(1 * time.Second)
		}
	})

	return nil
}
