package routes

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/mark3labs/pro-saaskit/game"
	"github.com/mark3labs/pro-saaskit/middleware"
	"github.com/mark3labs/pro-saaskit/views"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	datastar "github.com/starfederation/datastar/sdk/go"
)

// Signals struct for handling DataStar signals
type Signals struct {
	Update      string `json:"update"`
	ShellFired  string `json:"shellFired"`
	GameState   string `json:"gameState"`
	TankHit     string `json:"tankHit"`     // New signal for tank being hit
	TankDeath   string `json:"tankDeath"`   // New signal for tank being destroyed
	TankRespawn string `json:"tankRespawn"` // New signal for tank respawning
}

func setupIndexRoutes(router *router.Router[*core.RequestEvent], gameManager *game.Manager) error {
	// Create a group for protected routes
	protected := router.Group("")
	protected.BindFunc(middleware.AuthGuard)

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
			var hitData game.HitData

			if err := json.Unmarshal([]byte(signals.TankHit), &hitData); err != nil {
				log.Println("Error unmarshaling tank hit data:", err)
				return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid tank hit data"})
			}

			// Process tank hit with game manager
			if err := gameManager.ProcessTankHit(hitData); err != nil {
				log.Println("Error processing tank hit:", err)
			}
		}

		// Handle tank respawn events from frontend
		if signals.TankRespawn != "" {
			var respawnData game.RespawnData

			if err := json.Unmarshal([]byte(signals.TankRespawn), &respawnData); err != nil {
				log.Println("Error unmarshaling tank respawn data:", err)
				return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid tank respawn data"})
			}

			// Process tank respawn with game manager
			if err := gameManager.RespawnTank(respawnData); err != nil {
				log.Println("Error processing tank respawn:", err)
			}
		}

		// Handle shell firing events
		if signals.ShellFired != "" {
			var shellData game.ShellData

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

			// Fire shell with game manager
			if _, err := gameManager.FireShell(shellData, playerID); err != nil {
				log.Println("Error firing shell:", err)
			}

			sse.MergeSignals([]byte("{shellFired:''}"))
		}

		// Parse the player update from the update signal
		if signals.Update != "" {
			var playerUpdate game.PlayerState
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

			// Get username from player ID
			playerName := "Guest"
			if authRecord != nil {
				// Use player ID instead of email
				playerName = "Player: " + playerID
			}

			// Update player with game manager
			if err := gameManager.UpdatePlayer(playerUpdate, playerID, playerName); err != nil {
				log.Println("Error updating player:", err)
			}
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
				// Get current game state from game manager
				state := gameManager.GetState()
				stateJSON, err := json.Marshal(state)

				if err != nil {
					log.Println("Error marshaling game state:", err)
					stateJSON = []byte(`{"gameState": "error"}`)
				}

				// Log game state for debugging
				log.Printf("Broadcasting game state with %d players and %d shells",
					len(state.Players),
					len(state.Shells))

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
