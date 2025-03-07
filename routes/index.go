package routes

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/mark3labs/pro-saaskit/middleware"
	"github.com/mark3labs/pro-saaskit/views"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	datastar "github.com/starfederation/datastar/sdk/go"
)

type Signals struct {
	Update    string `json:"update"`
	GameState string `json:"gameState"`
}

func setupIndexRoutes(router *router.Router[*core.RequestEvent]) error {
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

		log.Println("Received update:", signals.Update)
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
				currentTime := time.Now().Format("15:04:05")
				stateJSON := fmt.Sprintf(`{"gameState": "%s"}`, currentTime)
				_ = sse.MergeSignals([]byte(stateJSON))

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
