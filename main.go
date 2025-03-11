package main

import (
	"context"
	"log"
	"os"

	"github.com/delaneyj/toolbelt/embeddednats"
	"github.com/mark3labs/pro-saaskit/game"
	"github.com/mark3labs/pro-saaskit/game/physics"
	"github.com/mark3labs/pro-saaskit/middleware"
	"github.com/mark3labs/pro-saaskit/routes"
	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

func main() {
	app := pocketbase.New()

	// Setup embedded NATS server
	log.Println("Starting embedded NATS server...")

	ns, err := embeddednats.New(
		context.Background(),
		embeddednats.WithDirectory(app.DataDir()+"/nats"),
		embeddednats.WithNATSServerOptions(&server.Options{
			JetStream: true,
		}),
	)
	if err != nil {
		log.Fatalf("Failed to create NATS server: %v", err)
	}
	ns.NatsServer.Start()
	ns.WaitForServer()
	log.Println("NATS server started")

	// Connect to the embedded NATS server
	clientOpts := []nats.Option{
		nats.Name("shell-shock-client"),
		nats.InProcessServer(ns.NatsServer),
	}

	nc, err := nats.Connect(ns.NatsServer.ClientURL(), clientOpts...)
	if err != nil {
		log.Fatalf("Failed to connect to NATS: %v", err)
	}
	defer nc.Drain()
	log.Println("Connected to NATS server at", ns.NatsServer.ClientURL())

	// Initialize JetStream
	js, err := jetstream.New(nc)
	if err != nil {
		log.Fatalf("Failed to create JetStream context: %v", err)
	}
	log.Println("JetStream initialized")

	// Create KV bucket for game state
	ctx := context.Background()
	kv, err := js.CreateKeyValue(ctx, jetstream.KeyValueConfig{
		Bucket: "gamestate",
	})
	if err != nil {
		// If bucket already exists, just get it
		kv, err = js.KeyValue(ctx, "gamestate")
		if err != nil {
			log.Fatalf("Failed to get KV bucket: %v", err)
		}
	}
	log.Println("KV store initialized")

	// Initialize game manager
	gameManager, err := game.NewManager(ctx, kv)
	if err != nil {
		log.Fatalf("Failed to initialize game manager: %v", err)
	}
	log.Println("Game manager initialized")
	
	// Initialize physics system
	log.Println("\n\n==================================================")
	log.Println("⚙️ INITIALIZING PHYSICS COLLISION DETECTION SYSTEM")
	log.Println("==================================================\n")
	
	physics.Initialize()
	physicsIntegration := physics.NewPhysicsIntegration(gameManager)
	physicsIntegration.Start()
	
	log.Println("\n==================================================")
	log.Println("📊 SYSTEM STATUS:")
	log.Println("  - NATS Server: Running ✅")
	log.Println("  - JetStream: Ready ✅")
	log.Println("  - KV Store: Connected ✅")
	log.Println("  - Game Manager: Initialized ✅")
	log.Println("  - Physics System: Running ✅")
	log.Println("==================================================\n")

	middleware.AddCookieSessionMiddleware(*app)

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// Setup our custom routes first with game manager
		err := routes.SetupRoutes(ctx, se.Router, gameManager)
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
