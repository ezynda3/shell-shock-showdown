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
	GameEvent string `json:"gameEvent"` // Consolidated game event
	GameState string `json:"gameState"` // Game state for the client
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

		// Handle the consolidated game event
		if signals.GameEvent != "" {
			var gameEvent game.GameEvent

			if err := json.Unmarshal([]byte(signals.GameEvent), &gameEvent); err != nil {
				log.Println("Error unmarshaling game event:", err)
				return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid game event data"})
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

			// Process based on event type
			switch gameEvent.Type {
			case game.EventPlayerUpdate:
				// Handle player update event
				var playerUpdate game.PlayerState
				playerData, err := json.Marshal(gameEvent.Data)
				if err != nil {
					log.Println("Error marshaling player data:", err)
					return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid player data"})
				}

				if err := json.Unmarshal(playerData, &playerUpdate); err != nil {
					log.Println("Error unmarshaling player update:", err)
					return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid player update data"})
				}

				// Update player with game manager
				if err := gameManager.UpdatePlayer(playerUpdate, playerID, playerName); err != nil {
					log.Println("Error updating player:", err)
				}

			case game.EventShellFired:
				// Handle shell fired event
				var shellData game.ShellData
				shellDataJson, err := json.Marshal(gameEvent.Data)
				if err != nil {
					log.Println("Error marshaling shell data:", err)
					return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid shell data"})
				}

				if err := json.Unmarshal(shellDataJson, &shellData); err != nil {
					log.Println("Error unmarshaling shell data:", err)
					return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid shell data"})
				}

				// Fire shell with game manager
				if _, err := gameManager.FireShell(shellData, playerID); err != nil {
					log.Println("Error firing shell:", err)
				}

			case game.EventTankHit:
				// Handle tank hit event
				var hitData game.HitData
				hitDataJson, err := json.Marshal(gameEvent.Data)
				if err != nil {
					log.Println("Error marshaling hit data:", err)
					return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid hit data"})
				}

				if err := json.Unmarshal(hitDataJson, &hitData); err != nil {
					log.Println("Error unmarshaling tank hit data:", err)
					return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid tank hit data"})
				}

				// Process tank hit with game manager
				if err := gameManager.ProcessTankHit(hitData); err != nil {
					log.Println("Error processing tank hit:", err)
				}

			case game.EventTankDeath:
				// Handle tank death event
				// Currently, the tank death is tracked through hits that reduce health to 0
				// Any additional death processing can be added here

			case game.EventTankRespawn:
				// Handle tank respawn event
				var respawnData game.RespawnData
				respawnDataJson, err := json.Marshal(gameEvent.Data)
				if err != nil {
					log.Println("Error marshaling respawn data:", err)
					return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid respawn data"})
				}

				if err := json.Unmarshal(respawnDataJson, &respawnData); err != nil {
					log.Println("Error unmarshaling tank respawn data:", err)
					return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid tank respawn data"})
				}

				// Process tank respawn with game manager
				if err := gameManager.RespawnTank(respawnData); err != nil {
					log.Println("Error processing tank respawn:", err)
				}

			default:
				log.Printf("Unknown game event type: %s", gameEvent.Type)
			}
		}

		return e.JSON(http.StatusOK, map[string]bool{"success": true})
	})

	// GET route for gamestate endpoint
	router.GET("/gamestate", func(e *core.RequestEvent) error {
		sse := datastar.NewSSE(e.Response, e.Request)
		ctx := e.Request.Context()

		// Create a watcher for the gamestate KV
		watcher, err := gameManager.WatchState(ctx)
		if err != nil {
			log.Printf("Error creating gamestate watcher: %v", err)
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to watch game state"})
		}
		defer watcher.Stop()

		// Skip the initial nil value which indicates the watcher is ready
		<-watcher.Updates()

		// Process updates from the watcher
		for {
			select {
			case <-ctx.Done():
				return nil
			case entry := <-watcher.Updates():
				// Skip nil entries or deleted keys
				if entry == nil {
					continue
				}

				// Unmarshal the game state
				var state game.GameState
				if err := json.Unmarshal(entry.Value(), &state); err != nil {
					log.Printf("Error unmarshaling game state: %v", err)
					continue
				}

				// Log game state for debugging
				log.Printf("Broadcasting game state update with %d players and %d shells (revision: %d)",
					len(state.Players),
					len(state.Shells),
					entry.Revision())

				// Send the game state to the client
				stateJSON, err := json.Marshal(state)
				if err != nil {
					log.Println("Error marshaling game state:", err)
					continue
				}

				err = sse.MergeSignals([]byte(fmt.Sprintf(`{"gameState": %q}`, string(stateJSON))))
				if err != nil {
					log.Printf("Error sending game state: %v", err)
				}
			}
		}
	})

	// Add routes to protected group
	protected.GET("/", func(e *core.RequestEvent) error {
		log.Println(e.Auth)
		ctx := context.WithValue(context.Background(), "user", e.Auth)
		ctx = context.WithValue(ctx, "app", e.App)
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
