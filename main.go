package main

import (
	"context"
	"log"

	"github.com/mark3labs/pro-saaskit/middleware"
	"github.com/mark3labs/pro-saaskit/routes"
	"github.com/pocketbase/pocketbase"
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

		return se.Next()
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
