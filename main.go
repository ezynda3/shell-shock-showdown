package main

import (
	"context"
	"log"
	"math/rand"
	"os"
	"strconv"
	"strings"
	"time"

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
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
)

func main() {
	// Initialize a new random source for better randomness
	// This is the proper way to initialize random in older Go versions
	rand.Seed(time.Now().UnixNano())

	app := pocketbase.New()

	// Migrations
	// loosely check if it was executed using "go run"
	isGoRun := strings.HasPrefix(os.Args[0], "tmp/bin")

	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		// enable auto creation of migration files when making collection changes in the Dashboard
		// (the isGoRun check is to enable it only during development)
		Automigrate: isGoRun,
	})

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

	// Create all the required components in the correct order
	gameMap := game.GetGameMap() // Use GetGameMap instead of InitGameMap to avoid redeclaration

	// Use the new Vu physics-based manager instead of the old one
	physics.PhysicsManagerInstance = physics.NewVuPhysicsManager(gameMap, gameManager)
	physicsIntegration := physics.NewPhysicsIntegration(gameManager)
	physicsIntegration.Start()

	// Initialize NPC controller
	log.Println("\n==================================================")
	log.Println("🤖 INITIALIZING NPC CONTROLLER")
	log.Println("==================================================\n")

	// Reuse the gameMap variable from above
	// Pass the physics manager to provide NPC tanks with targeting capabilities
	npcController := game.NewNPCController(gameManager, gameMap, physics.PhysicsManagerInstance)
	npcController.Start()

	// Set the number of NPC tanks to spawn
	// Read from environment variable or default to 10
	numNPCsStr := os.Getenv("NUM_NPCS")
	numNPCs := 10 // Default to 10 NPCs for more exciting gameplay
	if numNPCsStr != "" {
		if val, err := strconv.Atoi(numNPCsStr); err == nil && val > 0 {
			numNPCs = val
			// Cap the number of NPCs to prevent performance issues
			const MAX_NPCS = 10
			if numNPCs > MAX_NPCS {
				log.Printf("WARNING: Requested %d NPCs exceeds maximum of %d. Limiting to %d NPCs",
					numNPCs, MAX_NPCS, MAX_NPCS)
				numNPCs = MAX_NPCS
			}
		}
	}

	// Spawn NPCs in a loop
	for i := 0; i < numNPCs; i++ {
		// Choose a random movement pattern for each NPC
		movementPatterns := []game.MovementPattern{
			game.CircleMovement,
			game.ZigzagMovement,
			game.PatrolMovement,
			game.RandomMovement,
		}
		movementPattern := movementPatterns[rand.Intn(len(movementPatterns))]

		// Spawn the NPC with a random pattern
		npcController.SpawnNPC("Bot", movementPattern)
		log.Printf("Spawned NPC %d/%d with movement pattern: %s", i+1, numNPCs, movementPattern)
	}
	log.Printf("Spawned %d NPC tanks in total (default is now 10, can be changed with NUM_NPCS environment variable)", numNPCs)

	log.Println("\n==================================================")
	log.Println("📊 SYSTEM STATUS:")
	log.Println("  - NATS Server: Running ✅")
	log.Println("  - JetStream: Ready ✅")
	log.Println("  - KV Store: Connected ✅")
	log.Println("  - Game Manager: Initialized ✅")
	log.Println("  - Physics System: Running ✅")
	log.Println("  - NPC Controller: Running ✅")
	log.Printf("  - Active NPCs: %d ✅", numNPCs)
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
