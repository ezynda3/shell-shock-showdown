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

func setupIndexRoutes(router *router.Router[*core.RequestEvent]) error {
	// Create a group for protected routes
	protected := router.Group("")
	protected.BindFunc(middleware.AuthGuard)

	// POST route for update endpoint
	router.POST("/update", func(e *core.RequestEvent) error {
		log.Println("posted")
		return e.JSON(http.StatusOK, map[string]bool{"success": true})
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
