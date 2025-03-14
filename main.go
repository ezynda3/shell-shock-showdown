package main

import (
	"context"
	"fmt"
	"math/rand"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/charmbracelet/log"
	"github.com/delaneyj/toolbelt/embeddednats"
	"github.com/mark3labs/pro-saaskit/game"
	"github.com/mark3labs/pro-saaskit/game/physics"
	"github.com/mark3labs/pro-saaskit/middleware"
	_ "github.com/mark3labs/pro-saaskit/migrations"
	"github.com/mark3labs/pro-saaskit/routes"
	"github.com/mark3labs/pro-saaskit/utils"
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

	// Add hook for setting user callsigns on creation
	app.OnRecordCreate("users").BindFunc(func(e *core.RecordEvent) error {
		// Generate and set callsign if it's empty
		if e.Record.Get("callsign") == "" {
			callsign := utils.GenerateCallsign()
			e.Record.Set("callsign", callsign)
			log.Info("Generated callsign for new user", "callsign", callsign)
		}
		return e.Next()
	})

	// Migrations
	// loosely check if it was executed using "go run"
	isGoRun := strings.HasPrefix(os.Args[0], "tmp/bin")

	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		// enable auto creation of migration files when making collection changes in the Dashboard
		// (the isGoRun check is to enable it only during development)
		Automigrate: isGoRun,
	})

	// Setup embedded NATS server
	log.Info("Starting embedded NATS server")

	ns, err := embeddednats.New(
		context.Background(),
		embeddednats.WithDirectory(app.DataDir()+"/nats"),
		embeddednats.WithNATSServerOptions(&server.Options{
			JetStream: true,
		}),
	)
	if err != nil {
		log.Fatal("Failed to create NATS server", "error", err)
	}
	ns.NatsServer.Start()
	ns.WaitForServer()
	log.Info("NATS server started")

	// Connect to the embedded NATS server
	clientOpts := []nats.Option{
		nats.Name("shell-shock-client"),
		nats.InProcessServer(ns.NatsServer),
	}

	nc, err := nats.Connect(ns.NatsServer.ClientURL(), clientOpts...)
	if err != nil {
		log.Fatal("Failed to connect to NATS", "error", err)
	}
	defer nc.Drain()
	log.Info("Connected to NATS server", "url", ns.NatsServer.ClientURL())

	// Initialize JetStream
	js, err := jetstream.New(nc)
	if err != nil {
		log.Fatal("Failed to create JetStream context", "error", err)
	}
	log.Info("JetStream initialized")

	// Create KV bucket for game state
	ctx := context.Background()
	kv, err := js.CreateOrUpdateKeyValue(ctx, jetstream.KeyValueConfig{
		Bucket: "gamestate",
	})
	if err != nil {
		log.Fatal("Failed to get KV bucket", "error", err)
	}
	err = kv.Purge(context.Background(), "current")
	if err != nil {
		log.Fatal("Failed to purge KV bucket", "error", err)
	}
	log.Info("KV store initialized")

	// Initialize game manager
	gameManager, err := game.NewManager(ctx, kv)
	if err != nil {
		log.Fatal("Failed to initialize game manager", "error", err)
	}
	log.Info("Game manager initialized")

	// Initialize physics system
	log.Info("Initializing physics collision detection system")

	// Create all the required components in the correct order
	gameMap := game.GetGameMap() // Use GetGameMap instead of InitGameMap to avoid redeclaration

	// Use the new Vu physics-based manager instead of the old one
	physics.PhysicsManagerInstance = physics.NewVuPhysicsManager(gameMap, gameManager)
	physicsIntegration := physics.NewPhysicsIntegration(gameManager)
	physicsIntegration.Start()

	// Initialize NPC controller
	log.Info("Initializing NPC controller")

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
				log.Warn("Requested NPCs exceeds maximum limit",
					"requested", numNPCs, "max", MAX_NPCS, "using", MAX_NPCS)
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
		log.Debug("Spawned NPC", "count", fmt.Sprintf("%d/%d", i+1, numNPCs), "pattern", movementPattern)
	}
	log.Info("NPC tanks spawned", "count", numNPCs, "note", "can be changed with NUM_NPCS env var")

	log.Info("System status", 
		"nats", "Running",
		"jetstream", "Ready",
		"kvstore", "Connected",
		"gamemanager", "Initialized",
		"physics", "Running",
		"npccontroller", "Running",
		"activeNPCs", numNPCs)

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
		log.Fatal("Application failed to start", "error", err)
	}
}
