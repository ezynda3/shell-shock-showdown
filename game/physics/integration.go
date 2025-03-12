package physics

import (
	"context"
	"encoding/json"
	"log"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/mark3labs/pro-saaskit/game"
	"github.com/nats-io/nats.go/jetstream"
)

// PhysicsIntegration connects the physics manager with the game manager
type PhysicsIntegration struct {
	physicsManager PhysicsEngine // Can be either PhysicsManager or VuPhysicsManager
	gameManager    *game.Manager
	gameMap        *game.GameMap
	mutex          sync.RWMutex
	isRunning      bool
	watcher        jetstream.KeyWatcher
	ctx            context.Context
	cancelFunc     context.CancelFunc

	// Map to track previous tank positions for detecting movement
	previousPositions map[string]game.Position
}

// NewPhysicsIntegration creates a new physics integration
func NewPhysicsIntegration(gameManager *game.Manager) *PhysicsIntegration {
	// Get game map initialized
	gameMap := game.GetGameMap()

	// Create physics manager with reference to game manager for callbacks
	// Note: We don't create a physics manager here anymore
	// It should be set to PhysicsManagerInstance which is created in main.go

	// Create context with cancel function
	ctx, cancel := context.WithCancel(context.Background())

	return &PhysicsIntegration{
		physicsManager:    PhysicsManagerInstance, // Use the global physics manager instance
		gameManager:       gameManager,
		gameMap:           gameMap,
		mutex:             sync.RWMutex{},
		isRunning:         false,
		ctx:               ctx,
		cancelFunc:        cancel,
		previousPositions: make(map[string]game.Position),
	}
}

// Start begins the physics simulation
func (pi *PhysicsIntegration) Start() {
	pi.mutex.Lock()
	if pi.isRunning {
		pi.mutex.Unlock()
		return
	}
	pi.isRunning = true
	pi.mutex.Unlock()

	// Get initial game state for debugging
	initialState := pi.gameManager.GetState()
	log.Printf("Initial game state has %d players and %d shells",
		len(initialState.Players), len(initialState.Shells))

	// Debug: Verify the game map has trees and rocks loaded
	if pi.gameMap == nil {
		log.Println("❌❌❌ CRITICAL ERROR: Game map is nil! Initializing now...")
		pi.gameMap = game.GetGameMap()
	}

	// Log tree info
	treeCount := len(pi.gameMap.Trees.Trees)
	log.Printf("🌲 PHYSICS DEBUG: Found %d trees in game map", treeCount)
	if treeCount > 0 {
		log.Println("\n==================================================")
		log.Println("🌲 TREE DATA SAMPLE:")
		for i := 0; i < 5 && i < treeCount; i++ {
			tree := pi.gameMap.Trees.Trees[i]
			log.Printf("  - Tree #%d: Type=%s, Position=(%.2f, %.2f, %.2f), Radius=%.2f",
				i, tree.Type, tree.Position.X, tree.Position.Y, tree.Position.Z, tree.Radius)
		}
		log.Println("==================================================\n")
	} else {
		log.Println("❌ PHYSICS ERROR: No trees found in game map!")
		// Attempt to reinitialize game map
		log.Println("Attempting to initialize game map...")
		game.InitGameMap()
		pi.gameMap = game.GetGameMap()
		log.Printf("After reinitialization: Trees=%d, Rocks=%d",
			len(pi.gameMap.Trees.Trees), len(pi.gameMap.Rocks.Rocks))
	}

	// Log rock info
	rockCount := len(pi.gameMap.Rocks.Rocks)
	log.Printf("🪨 PHYSICS DEBUG: Found %d rocks in game map", rockCount)
	if rockCount > 0 {
		log.Println("\n==================================================")
		log.Println("🪨 ROCK DATA SAMPLE:")
		for i := 0; i < 5 && i < rockCount; i++ {
			rock := pi.gameMap.Rocks.Rocks[i]
			log.Printf("  - Rock #%d: Type=%s, Position=(%.2f, %.2f, %.2f), Radius=%.2f",
				i, rock.Type, rock.Position.X, rock.Position.Y, rock.Position.Z, rock.Radius)
		}
		log.Println("==================================================\n")
	} else {
		log.Println("❌ PHYSICS ERROR: No rocks found in game map!")
	}

	// Create watcher to listen for game state changes
	var err error
	log.Println("Creating KV watcher for game state changes...")
	pi.watcher, err = pi.gameManager.WatchState(pi.ctx)
	if err != nil {
		log.Printf("Error creating KV watcher: %v", err)
		return
	}
	log.Println("KV watcher created successfully")

	// Run watcher loop in background
	go pi.watchLoop()

	// Run physics updates in a separate goroutine
	go pi.runPhysicsLoop()

	log.Println("\n\n==================================================")
	log.Println("✅ PHYSICS SYSTEM STARTED SUCCESSFULLY")
	log.Println("==================================================")
	log.Println("🌲 Monitoring Trees:", len(pi.gameMap.Trees.Trees))
	log.Println("🪨 Monitoring Rocks:", len(pi.gameMap.Rocks.Rocks))
	log.Println("👋 Tank collision radius: 2.5 units (⬆️ INCREASED FROM 1.5)")
	log.Println("🎮 Movement detection threshold:", 0.01)
	log.Println("🔍 Now detecting collisions up to 0.5 units away")
	log.Println("==================================================\n\n")
}

// Stop stops the physics simulation
func (pi *PhysicsIntegration) Stop() {
	pi.mutex.Lock()
	defer pi.mutex.Unlock()

	if !pi.isRunning {
		return
	}

	pi.isRunning = false
	pi.cancelFunc() // Cancel context to stop watcher

	if pi.watcher != nil {
		pi.watcher.Stop()
	}

	log.Println("Physics integration stopped")
}

// watchLoop processes game state updates from the KV store
func (pi *PhysicsIntegration) watchLoop() {
	log.Println("\n\n==================================================")
	log.Println("🔄 PHYSICS: Starting physics watch loop for game state changes")
	log.Println("==================================================\n")

	// Read the first few updates to handle initial nil or empty states
	log.Println("⏳ PHYSICS: Waiting for initial update from KV watcher...")

	// Try up to 3 times to get a non-nil update
	var gotValidUpdate bool
	for i := 0; i < 3; i++ {
		log.Printf("🔄 PHYSICS: Waiting for update %d/3...", i+1)
		initialUpdate := <-pi.watcher.Updates()

		if initialUpdate == nil {
			log.Println("⚠️ PHYSICS: Got nil update, continuing...")
			continue
		}

		log.Println("\n\n==================================================")
		log.Printf("✅ PHYSICS: Received initial game state update #%d!", i+1)
		log.Println("==================================================\n")

		// Check the payload size
		payloadSize := len(initialUpdate.Value())
		log.Printf("📦 PHYSICS: Update payload size: %d bytes", payloadSize)

		if payloadSize == 0 {
			log.Println("⚠️ PHYSICS: Empty payload received, continuing...")
			continue
		}

		var initialState game.GameState
		if err := json.Unmarshal(initialUpdate.Value(), &initialState); err != nil {
			log.Printf("❌ PHYSICS: Error unmarshaling initial state: %v", err)
			continue
		}

		log.Printf("📊 PHYSICS: Initial state has %d players", len(initialState.Players))

		// Store initial positions without triggering collision checks
		pi.mutex.Lock()
		for id, player := range initialState.Players {
			pi.previousPositions[id] = player.Position
			log.Printf("📍 PHYSICS: Saved initial position for tank %s (%s): (%.2f, %.2f, %.2f)",
				id, player.Name, player.Position.X, player.Position.Y, player.Position.Z)
		}
		pi.mutex.Unlock()

		gotValidUpdate = true
		break
	}

	if !gotValidUpdate {
		log.Println("⚠️ PHYSICS: No valid initial update received after 3 attempts!")
	}

	log.Println("\n==================================================")
	log.Println("🚀 PHYSICS: Watch loop ready to process state changes")
	log.Println("==================================================\n")

	updateCount := 0

	for update := range pi.watcher.Updates() {
		updateCount++

		log.Println("\n\n==================================================")
		log.Printf("🔔 PHYSICS: UPDATE #%d RECEIVED", updateCount)
		log.Println("==================================================\n")

		if update == nil {
			log.Println("⚠️ PHYSICS: Received nil update from KV watcher, skipping")
			continue
		}

		log.Printf("📝 PHYSICS: Received game state update (revision: %d)", update.Revision())
		log.Printf("🔍 PHYSICS: Update payload size: %d bytes", len(update.Value()))

		// Parse game state
		var gameState game.GameState
		err := json.Unmarshal(update.Value(), &gameState)
		if err != nil {
			log.Printf("❌ PHYSICS: Error unmarshaling game state: %v", err)
			continue
		}

		log.Printf("🎮 PHYSICS: Processing game state with %d players and %d shells",
			len(gameState.Players), len(gameState.Shells))

		// Log all player positions for debugging
		if len(gameState.Players) > 0 {
			log.Println("\n📍 PHYSICS: Current player positions:")
			for id, player := range gameState.Players {
				log.Printf("  - Tank %s (%s): (%.2f, %.2f, %.2f) Health: %d Destroyed: %v, Status: %s",
					id, player.Name,
					player.Position.X, player.Position.Y, player.Position.Z,
					player.Health, player.IsDestroyed)
			}
			log.Println()

			// Get tank positions for proximity checks
			var tankPositions []game.Position
			for _, player := range gameState.Players {
				if !player.IsDestroyed {
					tankPositions = append(tankPositions, player.Position)
				}
			}

			// Check all trees and rocks for proximity to tanks
			pi.logEnvironmentProximity(tankPositions)

			// Check for collisions on every update regardless of movement
			log.Println("🔍 PHYSICS: Checking all tanks for collisions on update...")
			for _, player := range gameState.Players {
				if !player.IsDestroyed {
					pi.checkCollisionsForced(&player)
				}
			}
		}

		// Process tank updates for movement detection
		pi.processUpdatedState(gameState)
	}

	log.Println("\n\n==================================================")
	log.Println("⛔ PHYSICS: Watch loop exited")
	log.Println("==================================================\n")
}

// processUpdatedState handles updates to the game state
func (pi *PhysicsIntegration) processUpdatedState(state game.GameState) {
	pi.mutex.Lock()
	defer pi.mutex.Unlock()

	movingTanks := 0
	totalTanks := 0

	log.Println("\n🔍 PHYSICS: Checking for tank movements and collisions...")

	// Check each player for position changes
	for id, player := range state.Players {
		totalTanks++

		if player.IsDestroyed {
			log.Printf("💀 PHYSICS: Skipping destroyed tank %s (%s)", id, player.Name)
			continue
		}

		// Get previous position if it exists
		prevPos, hasPrevious := pi.previousPositions[id]

		// Skip if this is the first time we've seen this player
		if !hasPrevious {
			log.Printf("🆕 PHYSICS: New tank detected: %s (%s) at position (%.2f, %.2f, %.2f)",
				id, player.Name, player.Position.X, player.Position.Y, player.Position.Z)
			pi.previousPositions[id] = player.Position
			continue
		}

		// Check if the tank has moved
		if hasMoved(prevPos, player.Position) {
			movingTanks++
			// Calculate movement distance for logging
			dx := prevPos.X - player.Position.X
			dz := prevPos.Z - player.Position.Z
			moveDistance := math.Sqrt(dx*dx + dz*dz)

			log.Println("\n--------------------------------------------------")
			log.Printf("🚚 PHYSICS: TANK MOVED: %s (%s)", id, player.Name)
			log.Printf("   From: (%.2f, %.2f, %.2f)", prevPos.X, prevPos.Y, prevPos.Z)
			log.Printf("   To:   (%.2f, %.2f, %.2f)", player.Position.X, player.Position.Y, player.Position.Z)
			log.Printf("   Distance: %.2f units", moveDistance)
			log.Println("--------------------------------------------------\n")

			// Check for collisions with environment
			pi.checkTankCollisions(&player)

			// Store the current position for next time (only after processing movement)
			pi.previousPositions[id] = player.Position
		} else {
			// Store the current position even if no significant movement
			pi.previousPositions[id] = player.Position
		}
	}

	if totalTanks > 0 {
		if movingTanks > 0 {
			log.Printf("✅ PHYSICS: Processed %d moving tanks out of %d total tanks", movingTanks, totalTanks)
		} else {
			log.Printf("ℹ️ PHYSICS: No tank movement detected (total tanks: %d)", totalTanks)
		}
	} else {
		log.Println("⚠️ PHYSICS: No tanks in game state!")
	}
}

// hasMoved determines if a tank has significantly moved
func hasMoved(prev, current game.Position) bool {
	// Define a threshold for movement detection (lower value = more sensitive)
	const moveThreshold = 0.01

	// Calculate distance between positions
	dx := prev.X - current.X
	dz := prev.Z - current.Z

	// Check if movement exceeds threshold (ignoring Y-axis)
	return (dx*dx + dz*dz) > moveThreshold*moveThreshold
}

// checkTankCollisions checks for collisions when tank movement is detected
func (pi *PhysicsIntegration) checkTankCollisions(tank *game.PlayerState) {
	log.Printf("🔎 PHYSICS: Checking collisions for tank %s (%s) at (%.2f, %.2f, %.2f)",
		tank.ID, tank.Name, tank.Position.X, tank.Position.Y, tank.Position.Z)

	collisionsFound := 0

	// Function to check collision based on physics manager type
	checkCollision := func(pos1 game.Position, radius1 float64, pos2 game.Position, radius2 float64) bool {
		// Create colliders for the spheres
		a := &Collider{
			Position: pos1,
			Radius:   radius1,
			Type:     ColliderTank,
			ID:       tank.ID,
		}

		b := &Collider{
			Position: pos2,
			Radius:   radius2,
			Type:     ColliderTree,
			ID:       "environment",
		}

		return CheckCollision(a, b)
	}

	// Check for collisions with trees (using a larger radius of 2.5)
	for _, tree := range pi.gameMap.Trees.Trees {
		if checkCollision(tank.Position, 2.5, tree.Position, tree.Radius) {
			collisionsFound++

			// Calculate collision point (average of positions)
			collisionX := (tank.Position.X + tree.Position.X) / 2
			collisionZ := (tank.Position.Z + tree.Position.Z) / 2

			log.Println("\n\n==================================================")
			log.Printf("💥 PHYSICS: COLLISION DETECTED! 💥")
			log.Println("==================================================")
			log.Printf("🚜 Tank: %s (%s)", tank.ID, tank.Name)
			log.Printf("🌲 Tree: %s (%.2f scale)", tree.Type, tree.Scale)
			log.Printf("📍 Collision at approximately: (%.2f, %.2f)", collisionX, collisionZ)
			log.Printf("🔄 Tank radius: 1.5, Tree radius: %.2f", tree.Radius)
			log.Println("==================================================\n")
		}
	}

	// Check for collisions with rocks (using a larger radius of 2.5)
	for _, rock := range pi.gameMap.Rocks.Rocks {
		if checkCollision(tank.Position, 2.5, rock.Position, rock.Radius) {
			collisionsFound++

			// Calculate collision point (average of positions)
			collisionX := (tank.Position.X + rock.Position.X) / 2
			collisionZ := (tank.Position.Z + rock.Position.Z) / 2

			log.Println("\n\n==================================================")
			log.Printf("💥 PHYSICS: COLLISION DETECTED! 💥")
			log.Println("==================================================")
			log.Printf("🚜 Tank: %s (%s)", tank.ID, tank.Name)
			log.Printf("🪨 Rock: %s (size %.2f)", rock.Type, rock.Size)
			log.Printf("📍 Collision at approximately: (%.2f, %.2f)", collisionX, collisionZ)
			log.Printf("🔄 Tank radius: 1.5, Rock radius: %.2f", rock.Radius)
			log.Println("==================================================\n")
		}
	}

	if collisionsFound == 0 {
		log.Printf("✅ PHYSICS: No collisions detected for tank %s", tank.Name)
	} else {
		log.Printf("⚠️ PHYSICS: Found %d collisions for tank %s", collisionsFound, tank.Name)
	}

	// Check for collisions with other tanks is done in the runPhysicsLoop
}

// checkCollisionsForced checks for collisions on every update regardless of movement
func (pi *PhysicsIntegration) checkCollisionsForced(tank *game.PlayerState) {
	// Log detailed tank position for debugging
	log.Printf("🔎 PHYSICS: Checking tank %s at (%.2f, %.2f, %.2f) with radius 1.5",
		tank.Name, tank.Position.X, tank.Position.Y, tank.Position.Z)

	// Function to check collision based on physics manager type
	checkCollision := func(pos1 game.Position, radius1 float64, pos2 game.Position, radius2 float64) bool {
		// Create colliders for the spheres
		a := &Collider{
			Position: pos1,
			Radius:   radius1,
			Type:     ColliderTank,
			ID:       tank.ID,
		}

		b := &Collider{
			Position: pos2,
			Radius:   radius2,
			Type:     ColliderTree,
			ID:       "environment",
		}

		return CheckCollision(a, b)
	}

	closestTreeDist := 1000.0
	closestTreeIndex := -1

	// First check all trees and find the closest one
	for i, tree := range pi.gameMap.Trees.Trees {
		// Calculate distance
		dist := math.Sqrt(
			math.Pow(tank.Position.X-tree.Position.X, 2) +
				math.Pow(tank.Position.Z-tree.Position.Z, 2))

		// Track closest tree
		if dist < closestTreeDist {
			closestTreeDist = dist
			closestTreeIndex = i
		}

		// Check for collision with a larger detection radius (2.5 instead of 1.5)
		if checkCollision(tank.Position, 2.5, tree.Position, tree.Radius) {
			// Calculate collision point
			collisionX := (tank.Position.X + tree.Position.X) / 2
			collisionZ := (tank.Position.Z + tree.Position.Z) / 2

			// Super prominent collision alert
			log.Println("\n\n==================================================")
			log.Println("🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴")
			log.Println("💥💥💥 TREE COLLISION DETECTED 💥💥💥")
			log.Println("🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴")
			log.Println("==================================================")
			log.Printf("🚜 Tank: %s (%s) at (%.2f, %.2f, %.2f)",
				tank.ID, tank.Name, tank.Position.X, tank.Position.Y, tank.Position.Z)
			log.Printf("🌲 Tree: %s (scale: %.2f) at (%.2f, %.2f, %.2f)",
				tree.Type, tree.Scale, tree.Position.X, tree.Position.Y, tree.Position.Z)
			log.Printf("📍 Collision at: (%.2f, %.2f)", collisionX, collisionZ)
			log.Printf("📏 Distance: %.2f, Combined radius: %.2f",
				dist, 1.5+tree.Radius)
			log.Printf("⚠️ Distance < Combined radius: %.2f < %.2f",
				dist, 1.5+tree.Radius)
			log.Println("🚨 TREE COLLISION CONFIRMED 🚨")
			log.Println("==================================================")
			log.Println("🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴")
			log.Println("==================================================\n\n")

			// Only report one collision at a time to avoid log spam
			return
		}
	}

	// If we didn't find a collision but have trees, report the closest tree
	if closestTreeIndex >= 0 {
		tree := pi.gameMap.Trees.Trees[closestTreeIndex]
		combinedRadius := 1.5 + tree.Radius
		log.Printf("ℹ️ PHYSICS: Closest tree: %.2f units away (combined radius: %.2f)",
			closestTreeDist, combinedRadius)
		log.Printf("   Tree #%d: Type=%s at (%.2f, %.2f, %.2f) with radius %.2f",
			closestTreeIndex, tree.Type, tree.Position.X, tree.Position.Y, tree.Position.Z, tree.Radius)
		log.Printf("   No collision detected: %.2f > %.2f", closestTreeDist, combinedRadius)
	}

	closestRockDist := 1000.0
	closestRockIndex := -1

	// Then check all rocks and find the closest one
	for i, rock := range pi.gameMap.Rocks.Rocks {
		// Calculate distance
		dist := math.Sqrt(
			math.Pow(tank.Position.X-rock.Position.X, 2) +
				math.Pow(tank.Position.Z-rock.Position.Z, 2))

		// Track closest rock
		if dist < closestRockDist {
			closestRockDist = dist
			closestRockIndex = i
		}

		// Check for collision with a larger detection radius (2.5 instead of 1.5)
		if checkCollision(tank.Position, 2.5, rock.Position, rock.Radius) {
			// Calculate collision point
			collisionX := (tank.Position.X + rock.Position.X) / 2
			collisionZ := (tank.Position.Z + rock.Position.Z) / 2

			// Super prominent collision alert
			log.Println("\n\n==================================================")
			log.Println("🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴")
			log.Println("💥💥💥 ROCK COLLISION DETECTED 💥💥💥")
			log.Println("🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴")
			log.Println("==================================================")
			log.Printf("🚜 Tank: %s (%s) at (%.2f, %.2f, %.2f)",
				tank.ID, tank.Name, tank.Position.X, tank.Position.Y, tank.Position.Z)
			log.Printf("🪨 Rock: %s (size: %.2f) at (%.2f, %.2f, %.2f)",
				rock.Type, rock.Size, rock.Position.X, rock.Position.Y, rock.Position.Z)
			log.Printf("📍 Collision at: (%.2f, %.2f)", collisionX, collisionZ)
			log.Printf("📏 Distance: %.2f, Combined radius: %.2f",
				dist, 1.5+rock.Radius)
			log.Printf("⚠️ Distance < Combined radius: %.2f < %.2f",
				dist, 1.5+rock.Radius)
			log.Println("🚨 ROCK COLLISION CONFIRMED 🚨")
			log.Println("==================================================")
			log.Println("🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴")
			log.Println("==================================================\n\n")

			// Only report one collision at a time to avoid log spam
			return
		}
	}

	// If we didn't find a collision but have rocks, report the closest rock
	if closestRockIndex >= 0 {
		rock := pi.gameMap.Rocks.Rocks[closestRockIndex]
		combinedRadius := 1.5 + rock.Radius
		log.Printf("ℹ️ PHYSICS: Closest rock: %.2f units away (combined radius: %.2f)",
			closestRockDist, combinedRadius)
		log.Printf("   Rock #%d: Type=%s at (%.2f, %.2f, %.2f) with radius %.2f",
			closestRockIndex, rock.Type, rock.Position.X, rock.Position.Y, rock.Position.Z, rock.Radius)
		log.Printf("   No collision detected: %.2f > %.2f", closestRockDist, combinedRadius)
	}
}

// logEnvironmentProximity logs the proximity of tanks to environment objects
func (pi *PhysicsIntegration) logEnvironmentProximity(tankPositions []game.Position) {
	if len(tankPositions) == 0 {
		return
	}

	log.Println("\n🔭 PHYSICS: ENVIRONMENT PROXIMITY REPORT 🔭")

	// Find the 5 closest trees to any tank
	type proximityInfo struct {
		objType    string
		objIndex   int
		tankIndex  int
		distance   float64
		objPos     game.Position
		tankPos    game.Position
		objRadius  float64
		tankRadius float64
	}

	// Track all environment-tank pairs
	allProximities := []proximityInfo{}

	// Check trees
	for i, tree := range pi.gameMap.Trees.Trees {
		for j, tankPos := range tankPositions {
			// Calculate distance
			dx := tree.Position.X - tankPos.X
			dz := tree.Position.Z - tankPos.Z
			dist := math.Sqrt(dx*dx + dz*dz)

			allProximities = append(allProximities, proximityInfo{
				objType:    "tree",
				objIndex:   i,
				tankIndex:  j,
				distance:   dist,
				objPos:     tree.Position,
				tankPos:    tankPos,
				objRadius:  tree.Radius,
				tankRadius: 2.5, // Increased from 1.5
			})
		}
	}

	// Check rocks
	for i, rock := range pi.gameMap.Rocks.Rocks {
		for j, tankPos := range tankPositions {
			// Calculate distance
			dx := rock.Position.X - tankPos.X
			dz := rock.Position.Z - tankPos.Z
			dist := math.Sqrt(dx*dx + dz*dz)

			allProximities = append(allProximities, proximityInfo{
				objType:    "rock",
				objIndex:   i,
				tankIndex:  j,
				distance:   dist,
				objPos:     rock.Position,
				tankPos:    tankPos,
				objRadius:  rock.Radius,
				tankRadius: 2.5, // Increased from 1.5
			})
		}
	}

	// Sort by distance
	sort.Slice(allProximities, func(i, j int) bool {
		return allProximities[i].distance < allProximities[j].distance
	})

	// Log the 10 closest pairs
	count := 10
	if len(allProximities) < count {
		count = len(allProximities)
	}

	log.Printf("🏆 TOP %d CLOSEST TANK-ENVIRONMENT PAIRS:", count)
	for i := 0; i < count; i++ {
		p := allProximities[i]
		combinedRadius := p.objRadius + p.tankRadius
		log.Printf("  %d. %s #%d to Tank #%d: Distance=%.2f, Combined radius=%.2f, Difference=%.2f",
			i+1,
			p.objType,
			p.objIndex,
			p.tankIndex,
			p.distance,
			combinedRadius,
			p.distance-combinedRadius)

		// If there's a potential collision, highlight it
		if p.distance <= combinedRadius {
			log.Printf("   ⚠️⚠️⚠️ POTENTIAL COLLISION: Tank at (%.2f, %.2f) with %s at (%.2f, %.2f) ⚠️⚠️⚠️",
				p.tankPos.X, p.tankPos.Z,
				p.objType,
				p.objPos.X, p.objPos.Z)
		}
	}
	log.Println()
}

// runPhysicsLoop is the main physics update loop
func (pi *PhysicsIntegration) runPhysicsLoop() {
	log.Println("\n==================================================")
	log.Println("⚙️ PHYSICS: Tank-to-tank collision detection loop started")
	log.Println("==================================================\n")

	updateCount := 0

	for {
		pi.mutex.RLock()
		running := pi.isRunning
		pi.mutex.RUnlock()

		if !running {
			log.Println("\n==================================================")
			log.Println("⛔ PHYSICS: Physics simulation stopped")
			log.Println("==================================================\n")
			return
		}

		updateCount++
		if updateCount%50 == 0 {
			log.Printf("⏱️ PHYSICS: Tank collision loop heartbeat - %d updates processed", updateCount)
		}

		// Update physics
		pi.updatePhysics()

		// Sleep to limit updates to a reasonable rate
		time.Sleep(100 * time.Millisecond)
	}
}

// updatePhysics performs a single physics update
func (pi *PhysicsIntegration) updatePhysics() {
	// Get current game state
	gameState := pi.gameManager.GetState()

	// Register/update all tanks with physics manager
	for _, player := range gameState.Players {
		if !player.IsDestroyed {
			// Make a copy of the player to pass to physics manager
			playerCopy := player

			// Use the interface directly
			pi.physicsManager.RegisterTank(&playerCopy)
		}
	}

	// Process shell collisions
	if len(gameState.Shells) > 0 {
		// Only log occasionally to reduce spam
		if time.Now().UnixNano()%50 == 0 {
			log.Printf("🚀 PHYSICS: Processing %d shells for collisions", len(gameState.Shells))
		}

		// Make a copy of shells to avoid modifying the original state
		shellsCopy := make([]game.ShellState, len(gameState.Shells))
		copy(shellsCopy, gameState.Shells)

		// Log shell positions before physics update
		if len(shellsCopy) > 0 {
			log.Printf("📷 BEFORE PHYSICS: First shell %s at (%.2f,%.2f,%.2f)",
				shellsCopy[0].ID,
				shellsCopy[0].Position.X,
				shellsCopy[0].Position.Y,
				shellsCopy[0].Position.Z)
		}

		// Update shells with physics simulation
		pi.physicsManager.UpdateShells(shellsCopy)

		// Log shell positions after physics update to see if they changed
		if len(shellsCopy) > 0 {
			log.Printf("📷 AFTER PHYSICS: First shell %s at (%.2f,%.2f,%.2f)",
				shellsCopy[0].ID,
				shellsCopy[0].Position.X,
				shellsCopy[0].Position.Y,
				shellsCopy[0].Position.Z)
		}

		// Check if any shells were modified by physics (hit ground or expired)
		// and need to be removed from game state
		shellsToRemove := []string{}
		for i, shell := range shellsCopy {
			// Check if the shell hit ground (Y <= 0) or was marked as collided (Y < 0)
			if shell.Position.Y <= 0 {
				shellsToRemove = append(shellsToRemove, shell.ID)
				log.Printf("💥 PHYSICS: Shell %s marked for removal (hit ground or collision)", shell.ID)
			} else {
				// Update the shell position in game state for next frame
				gameState.Shells[i] = shell
			}
		}

		// Ask game manager to remove expired/hit shells
		if len(shellsToRemove) > 0 && pi.gameManager != nil {
			pi.gameManager.RemoveShells(shellsToRemove)
		}

		// Log the results of processing shells
		log.Printf("📊 PHYSICS CYCLE: Processed %d shells - %d removed, %d active",
			len(gameState.Shells), len(shellsToRemove), len(gameState.Shells)-len(shellsToRemove))
	}

	// Run physics update for tank-to-tank collisions
	pi.physicsManager.Update()
}
