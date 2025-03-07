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

// Cleanup inactive players
func cleanupInactivePlayers() {
	gameStateMutex.Lock()
	defer gameStateMutex.Unlock()

	now := time.Now().UnixMilli()
	for id, player := range gameState.Players {
		// If player hasn't updated in 10 seconds, remove them
		if now-player.Timestamp > 10000 {
			log.Printf("Removing inactive player: %s", id)
			delete(gameState.Players, id)
		}
	}
}

func setupIndexRoutes(router *router.Router[*core.RequestEvent]) error {
	// Initialize random seed for spawn positions
	rand.Seed(time.Now().UnixNano())

	// Create a group for protected routes
	protected := router.Group("")
	protected.BindFunc(middleware.AuthGuard)

	// Start a goroutine to clean up inactive players
	go func() {
		for {
			cleanupInactivePlayers()
			time.Sleep(5 * time.Second)
		}
	}()

	// POST route for update endpoint
	router.POST("/update", func(e *core.RequestEvent) error {
		signals := &Signals{}
		if err := datastar.ReadSignals(e.Request, signals); err != nil {
			log.Println("Error reading signals:", err)
			return e.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
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

			log.Printf("Added new shell %s from player %s", newShell.ID, playerID)
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

			// Check if this is a new player (not in game state yet)
			gameStateMutex.RLock()
			_, playerExists := gameState.Players[playerID]
			gameStateMutex.RUnlock()

			// If new player, set spawn position at center with random offset
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
			}

			// Update player state in game state
			gameStateMutex.Lock()
			gameState.Players[playerID] = playerUpdate
			gameStateMutex.Unlock()

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
				log.Printf("Broadcasting game state with %d players", len(gameState.Players))
				for id, player := range gameState.Players {
					log.Printf("Player %s at position (%f, %f, %f)",
						id,
						player.Position.X,
						player.Position.Y,
						player.Position.Z)
				}

				// Debug game state before sending
				log.Printf("About to send game state JSON: %s", string(stateJSON))
				
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
