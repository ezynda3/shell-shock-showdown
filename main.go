package main

import (
	"context"
	"log"
	"os"

	"github.com/mark3labs/pro-saaskit/middleware"
	"github.com/mark3labs/pro-saaskit/routes"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

func main() {
	app := pocketbase.New()

	middleware.AddCookieSessionMiddleware(*app)

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// Setup our custom routes first
		err := routes.SetupRoutes(context.Background(), se.Router)
		if err != nil {
			return err
		}

		// Serve static files
		se.Router.GET("/static/{path...}", apis.Static(os.DirFS("./static"), false))

		return se.Next()
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
