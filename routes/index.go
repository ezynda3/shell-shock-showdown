package routes

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/charmbracelet/log"
	"github.com/mark3labs/pro-saaskit/game"
	"github.com/mark3labs/pro-saaskit/middleware"
	"github.com/mark3labs/pro-saaskit/views"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	datastar "github.com/starfederation/datastar/sdk/go"
)

// Signals struct for handling DataStar signals
type Signals struct {
	GameEvent    string `json:"gameEvent"`    // Consolidated game event
	GameState    string `json:"gameState"`    // Game state for the client
	Notification string `json:"notification"` // Kill notifications
}

func setupIndexRoutes(router *router.Router[*core.RequestEvent], gameManager *game.Manager) error {
	// Create a group for protected routes
	protected := router.Group("")
	protected.BindFunc(middleware.AuthGuard)
	protected.Bind(apis.Gzip())

	// POST route for update endpoint
	router.POST("/update", func(e *core.RequestEvent) error {
		signals := &Signals{}
		if err := datastar.ReadSignals(e.Request, signals); err != nil {
			log.Error("Error reading signals", "error", err)
			return e.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		}

		// Handle the consolidated game event
		if signals.GameEvent != "" {
			var gameEvent game.GameEvent

			if err := json.Unmarshal([]byte(signals.GameEvent), &gameEvent); err != nil {
				log.Error("Error unmarshaling game event", "error", err)
				return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid game event data"})
			}

			// Get player ID from auth
			playerName := "Guest"
			playerID := "none"
			authRecord := e.Auth
			if authRecord != nil {
				playerName = authRecord.GetString("callsign")
				playerID = authRecord.Id
			}

			// Process based on event type
			switch gameEvent.Type {
			case game.EventPlayerUpdate:
				// Handle player update event
				var playerUpdate game.PlayerState
				playerData, err := json.Marshal(gameEvent.Data)
				if err != nil {
					log.Error("Error marshaling player data", "error", err)
					return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid player data"})
				}

				if err := json.Unmarshal(playerData, &playerUpdate); err != nil {
					log.Error("Error unmarshaling player update", "error", err)
					return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid player update data"})
				}

				// Check if player is destroyed in current game state
				currentState := gameManager.GetState()
				if currentPlayer, exists := currentState.Players[playerID]; exists && currentPlayer.IsDestroyed {
					// Player is dead, ignore position updates from client
					log.Warn("Ignoring position update from destroyed player", "playerID", playerID)
					break
				}

				// always set health to 0 because server should update this
				playerUpdate.Health = 0

				// Update player with game manager
				if err := gameManager.UpdatePlayer(playerUpdate, playerID, playerName); err != nil {
					log.Error("Error updating player", "error", err)
				}

			case game.EventShellFired:
				// Handle shell fired event
				var shellData game.ShellData
				shellDataJson, err := json.Marshal(gameEvent.Data)
				if err != nil {
					log.Error("Error marshaling shell data", "error", err)
					return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid shell data"})
				}

				if err := json.Unmarshal(shellDataJson, &shellData); err != nil {
					log.Error("Error unmarshaling shell data", "error", err)
					return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid shell data"})
				}

				// Fire shell with game manager and track it
				shell, err := gameManager.FireShell(shellData, playerID)
				if err != nil {
					log.Error("Error firing shell", "error", err)
				} else {
					// Log detailed shell information
					log.Info("New shell registered", 
						"shellID", shell.ID, 
						"playerID", playerID)
					log.Debug("Shell data", 
						"position", fmt.Sprintf("(%.2f,%.2f,%.2f)", shell.Position.X, shell.Position.Y, shell.Position.Z),
						"direction", fmt.Sprintf("(%.2f,%.2f,%.2f)", shell.Direction.X, shell.Direction.Y, shell.Direction.Z),
						"speed", shell.Speed)

					// Add more context about the shell for debugging
					log.Debug("Shell timestamp", 
						"timestamp", shell.Timestamp, 
						"current", time.Now().UnixMilli(),
						"diff", time.Now().UnixMilli()-shell.Timestamp)
				}

			case game.EventTankHit:
				// Handle tank hit event
				var hitData game.HitData
				hitDataJson, err := json.Marshal(gameEvent.Data)
				if err != nil {
					log.Error("Error marshaling hit data", "error", err)
					return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid hit data"})
				}

				if err := json.Unmarshal(hitDataJson, &hitData); err != nil {
					log.Error("Error unmarshaling tank hit data", "error", err)
					return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid tank hit data"})
				}

				// Process tank hit with game manager
				if err := gameManager.ProcessTankHit(hitData); err != nil {
					log.Error("Error processing tank hit", "error", err)
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
					log.Error("Error marshaling respawn data", "error", err)
					return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid respawn data"})
				}

				if err := json.Unmarshal(respawnDataJson, &respawnData); err != nil {
					log.Error("Error unmarshaling tank respawn data", "error", err)
					return e.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid tank respawn data"})
				}

				// Process tank respawn with game manager
				if err := gameManager.RespawnTank(respawnData); err != nil {
					log.Error("Error processing tank respawn", "error", err)
				}

			default:
				log.Warn("Unknown game event type", "type", gameEvent.Type)
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
			log.Error("Error creating gamestate watcher", "error", err)
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to watch game state"})
		}
		defer watcher.Stop()

		// Get the latest state to send to the client immediately
		latestState := gameManager.GetState()
		latestStateJSON, err := json.Marshal(latestState)
		if err == nil {
			err = sse.MergeSignals([]byte(fmt.Sprintf(`{"gameState": %q}`, string(latestStateJSON))))
			if err != nil {
				log.Error("Error sending initial game state", "error", err)
			} else {
				log.Info("Sent initial game state", 
					"players", len(latestState.Players), 
					"shells", len(latestState.Shells))
			}
		}

		// Process new updates from the watcher
		for {
			select {
			case <-ctx.Done():
				// Get player ID from auth (we can assume e.Auth is not nil due to auth guard)
				playerID := e.Auth.Id
				// Remove player from game state
				if err := gameManager.RemovePlayer(playerID); err != nil {
					log.Error("Error removing player from game state", "playerID", playerID, "error", err)
				} else {
					log.Info("Player removed from game state on connection close", "playerID", playerID)
				}
				return nil
			case entry := <-watcher.Updates():
				// Skip nil entries or deleted keys
				if entry == nil {
					continue
				}

				// Unmarshal the game state
				var state game.GameState
				if err := json.Unmarshal(entry.Value(), &state); err != nil {
					log.Error("Error unmarshaling game state", "error", err)
					continue
				}

				// Log game state for debugging
				log.Debug("Broadcasting game state update", 
					"players", len(state.Players),
					"shells", len(state.Shells),
					"revision", entry.Revision())

				// Check for notifications in player states
				var notification string
				for _, player := range state.Players {
					if player.Notification != "" {
						notification = player.Notification
						// Only take the first notification found
						break
					}
				}

				// Send the game state to the client
				stateJSON, err := json.Marshal(state)
				if err != nil {
					log.Error("Error marshaling game state", "error", err)
					continue
				}

				// Build signals JSON string
				var signalsJSON string
				if notification != "" {
					signalsJSON = fmt.Sprintf(`{"gameState": %q, "notification": %q}`, string(stateJSON), notification)
					log.Info("Sending notification", "message", notification)
				} else {
					signalsJSON = fmt.Sprintf(`{"gameState": %q}`, string(stateJSON))
				}

				err = sse.MergeSignals([]byte(signalsJSON))
				if err != nil {
					log.Error("Error sending game state", "error", err)
				}
			}
		}
	})

	// Add routes to protected group
	protected.GET("/", func(e *core.RequestEvent) error {
		log.Debug("Auth record", "auth", e.Auth)
		ctx := context.WithValue(context.Background(), "user", e.Auth)
		ctx = context.WithValue(ctx, "app", e.App)
		return views.Index().Render(ctx, e.Response)
	})

	protected.GET("/settings", func(e *core.RequestEvent) error {
		ctx := context.WithValue(context.Background(), "user", e.Auth)
		ctx = context.WithValue(ctx, "app", e.App)
		return views.Settings().Render(ctx, e.Response)
	})

	// POST route for updating user callsign
	protected.POST("/callsign", func(e *core.RequestEvent) error {
		// Verify user is authenticated
		if e.Auth == nil {
			return e.JSON(http.StatusUnauthorized, map[string]string{"error": "Authentication required"})
		}

		// Read callsign from signal
		var callsignSignal struct {
			Callsign string `json:"callsign"`
		}

		if err := datastar.ReadSignals(e.Request, &callsignSignal); err != nil {
			log.Error("Error reading callsign signal", "error", err)
			return e.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		}

		// Validate callsign
		if callsignSignal.Callsign == "" {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": "Callsign cannot be empty"})
		}

		// Update user record with new callsign
		e.Auth.Set("callsign", callsignSignal.Callsign)

		// Validate and persist the record
		if err := e.App.Save(e.Auth); err != nil {
			log.Error("Error saving user record", "error", err)
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update callsign"})
		}

		// Create a new SSE connection
		sse := datastar.NewSSE(e.Response, e.Request)

		// Redirect to the homepage on successful save
		return sse.Redirect("/")
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