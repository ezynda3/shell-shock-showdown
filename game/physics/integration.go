package physics

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/charmbracelet/log"
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
	log.Debug("Initial game state", 
		"players", len(initialState.Players), 
		"shells", len(initialState.Shells))

	// Debug: Verify the game map has trees and rocks loaded
	if pi.gameMap == nil {
		log.Error("Critical error: Game map is nil, initializing now")
		pi.gameMap = game.GetGameMap()
	}

	// Log tree info
	treeCount := len(pi.gameMap.Trees.Trees)
	log.Debug("Physics: trees in game map", "count", treeCount)
	if treeCount > 0 {
		for i := 0; i < 5 && i < treeCount; i++ {
			tree := pi.gameMap.Trees.Trees[i]
			log.Debug("Tree data sample", 
				"index", i, 
				"type", tree.Type, 
				"position", fmt.Sprintf("(%.2f, %.2f, %.2f)", tree.Position.X, tree.Position.Y, tree.Position.Z), 
				"radius", tree.Radius)
		}
	} else {
		log.Error("Physics: No trees found in game map")
		// Attempt to reinitialize game map
		log.Info("Attempting to initialize game map")
		game.InitGameMap()
		pi.gameMap = game.GetGameMap()
		log.Info("Game map reinitialized", 
			"trees", len(pi.gameMap.Trees.Trees), 
			"rocks", len(pi.gameMap.Rocks.Rocks))
	}

	// Log rock info
	rockCount := len(pi.gameMap.Rocks.Rocks)
	log.Debug("Physics: rocks in game map", "count", rockCount)
	if rockCount > 0 {
		for i := 0; i < 5 && i < rockCount; i++ {
			rock := pi.gameMap.Rocks.Rocks[i]
			log.Debug("Rock data sample", 
				"index", i, 
				"type", rock.Type, 
				"position", fmt.Sprintf("(%.2f, %.2f, %.2f)", rock.Position.X, rock.Position.Y, rock.Position.Z), 
				"radius", rock.Radius)
		}
	} else {
		log.Error("Physics: No rocks found in game map")
	}

	// Create watcher to listen for game state changes
	var err error
	log.Info("Creating KV watcher for game state changes")
	pi.watcher, err = pi.gameManager.WatchState(pi.ctx)
	if err != nil {
		log.Error("Failed to create KV watcher", "error", err)
		return
	}
	log.Info("KV watcher created successfully")

	// Run watcher loop in background
	go pi.watchLoop()

	// Run physics updates in a separate goroutine
	go pi.runPhysicsLoop()

	log.Info("Physics system started successfully", 
		"trees", len(pi.gameMap.Trees.Trees),
		"rocks", len(pi.gameMap.Rocks.Rocks),
		"tankCollisionRadius", 2.5,
		"movementThreshold", 0.01,
		"collisionDistance", 0.5)
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

	log.Info("Physics integration stopped")
}

// watchLoop processes game state updates from the KV store
func (pi *PhysicsIntegration) watchLoop() {
	log.Info("Starting physics watch loop for game state changes")

	// Read the first few updates to handle initial nil or empty states
	log.Info("Waiting for initial update from KV watcher")

	// Try up to 3 times to get a non-nil update
	var gotValidUpdate bool
	for i := 0; i < 3; i++ {
		log.Info("Waiting for physics update", "attempt", fmt.Sprintf("%d/3", i+1))
		initialUpdate := <-pi.watcher.Updates()

		if initialUpdate == nil {
			log.Warn("Got nil update, continuing")
			continue
		}

		log.Info("Received initial game state update", "attempt", i+1)

		// Check the payload size
		payloadSize := len(initialUpdate.Value())
		log.Debug("Update payload size", "bytes", payloadSize)

		if payloadSize == 0 {
			log.Warn("Empty payload received, continuing")
			continue
		}

		var initialState game.GameState
		if err := json.Unmarshal(initialUpdate.Value(), &initialState); err != nil {
			log.Error("Error unmarshaling initial state", "error", err)
			continue
		}

		log.Debug("Initial state players", "count", len(initialState.Players))

		// Store initial positions without triggering collision checks
		pi.mutex.Lock()
		for id, player := range initialState.Players {
			pi.previousPositions[id] = player.Position
			log.Debug("Saved initial position for tank", 
				"id", id, 
				"name", player.Name, 
				"position", fmt.Sprintf("(%.2f, %.2f, %.2f)", player.Position.X, player.Position.Y, player.Position.Z))
		}
		pi.mutex.Unlock()

		gotValidUpdate = true
		break
	}

	if !gotValidUpdate {
		log.Warn("No valid initial update received after 3 attempts")
	}

	log.Info("Watch loop ready to process state changes")

	updateCount := 0

	for update := range pi.watcher.Updates() {
		updateCount++

		log.Debug("Update received", "number", updateCount)

		if update == nil {
			log.Warn("Received nil update from KV watcher, skipping")
			continue
		}

		log.Debug("Game state update details", 
			"revision", update.Revision(), 
			"size", len(update.Value()))

		// Parse game state
		var gameState game.GameState
		err := json.Unmarshal(update.Value(), &gameState)
		if err != nil {
			log.Error("Error unmarshaling game state", "error", err)
			continue
		}

		log.Debug("Processing game state", 
			"players", len(gameState.Players), 
			"shells", len(gameState.Shells))

		// Log all player positions for debugging
		if len(gameState.Players) > 0 {
			log.Debug("Current player positions:")
			for id, player := range gameState.Players {
				log.Debug("Tank position", 
					"id", id, 
					"name", player.Name,
					"position", fmt.Sprintf("(%.2f, %.2f, %.2f)", player.Position.X, player.Position.Y, player.Position.Z),
					"health", player.Health, 
					"destroyed", player.IsDestroyed,
					"status", player.Status)
			}

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
			log.Debug("Checking all tanks for collisions on update")
			for _, player := range gameState.Players {
				if !player.IsDestroyed {
					pi.checkCollisionsForced(&player)
				}
			}
		}

		// Process tank updates for movement detection
		pi.processUpdatedState(gameState)
	}

	log.Info("Watch loop exited")
}

// processUpdatedState handles updates to the game state
func (pi *PhysicsIntegration) processUpdatedState(state game.GameState) {
	pi.mutex.Lock()
	defer pi.mutex.Unlock()

	movingTanks := 0
	totalTanks := 0

	log.Debug("Checking for tank movements and collisions")

	// Check each player for position changes
	for id, player := range state.Players {
		totalTanks++

		if player.IsDestroyed {
			log.Debug("Skipping destroyed tank", "id", id, "name", player.Name)
			continue
		}

		// Get previous position if it exists
		prevPos, hasPrevious := pi.previousPositions[id]

		// Skip if this is the first time we've seen this player
		if !hasPrevious {
			log.Info("New tank detected", 
				"id", id, 
				"name", player.Name, 
				"position", fmt.Sprintf("(%.2f, %.2f, %.2f)", player.Position.X, player.Position.Y, player.Position.Z))
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

			log.Debug("Tank moved", 
				"id", id, 
				"name", player.Name,
				"from", fmt.Sprintf("(%.2f, %.2f, %.2f)", prevPos.X, prevPos.Y, prevPos.Z),
				"to", fmt.Sprintf("(%.2f, %.2f, %.2f)", player.Position.X, player.Position.Y, player.Position.Z),
				"distance", fmt.Sprintf("%.2f units", moveDistance))

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
			log.Debug("Processed moving tanks", "moving", movingTanks, "total", totalTanks)
		} else {
			log.Debug("No tank movement detected", "total", totalTanks)
		}
	} else {
		log.Warn("No tanks in game state")
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
	log.Debug("Checking collisions for tank", 
		"id", tank.ID, 
		"name", tank.Name, 
		"position", fmt.Sprintf("(%.2f, %.2f, %.2f)", tank.Position.X, tank.Position.Y, tank.Position.Z))

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

			log.Info("Tree collision detected", 
				"tank", fmt.Sprintf("%s (%s)", tank.ID, tank.Name),
				"tree", fmt.Sprintf("%s (scale: %.2f)", tree.Type, tree.Scale),
				"collisionPoint", fmt.Sprintf("(%.2f, %.2f)", collisionX, collisionZ),
				"tankRadius", 1.5,
				"treeRadius", tree.Radius)
		}
	}

	// Check for collisions with rocks (using a larger radius of 2.5)
	for _, rock := range pi.gameMap.Rocks.Rocks {
		if checkCollision(tank.Position, 2.5, rock.Position, rock.Radius) {
			collisionsFound++

			// Calculate collision point (average of positions)
			collisionX := (tank.Position.X + rock.Position.X) / 2
			collisionZ := (tank.Position.Z + rock.Position.Z) / 2

			log.Info("Rock collision detected", 
				"tank", fmt.Sprintf("%s (%s)", tank.ID, tank.Name),
				"rock", fmt.Sprintf("%s (size: %.2f)", rock.Type, rock.Size),
				"collisionPoint", fmt.Sprintf("(%.2f, %.2f)", collisionX, collisionZ),
				"tankRadius", 1.5,
				"rockRadius", rock.Radius)
		}
	}

	if collisionsFound == 0 {
		log.Debug("No collisions detected", "tank", tank.Name)
	} else {
		log.Debug("Collisions found", "count", collisionsFound, "tank", tank.Name)
	}

	// Check for collisions with other tanks is done in the runPhysicsLoop
}

// checkCollisionsForced checks for collisions on every update regardless of movement
func (pi *PhysicsIntegration) checkCollisionsForced(tank *game.PlayerState) {
	// Log detailed tank position for debugging
	log.Debug("Checking tank position", 
		"name", tank.Name, 
		"position", fmt.Sprintf("(%.2f, %.2f, %.2f)", tank.Position.X, tank.Position.Y, tank.Position.Z), 
		"radius", 1.5)

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
			log.Warn("Tree collision detected", 
				"tank", fmt.Sprintf("%s (%s) at (%.2f, %.2f, %.2f)", tank.ID, tank.Name, tank.Position.X, tank.Position.Y, tank.Position.Z),
				"tree", fmt.Sprintf("%s (scale: %.2f) at (%.2f, %.2f, %.2f)", tree.Type, tree.Scale, tree.Position.X, tree.Position.Y, tree.Position.Z),
				"collisionPoint", fmt.Sprintf("(%.2f, %.2f)", collisionX, collisionZ),
				"distance", dist,
				"combinedRadius", 1.5+tree.Radius)

			// Only report one collision at a time to avoid log spam
			return
		}
	}

	// If we didn't find a collision but have trees, report the closest tree
	if closestTreeIndex >= 0 {
		tree := pi.gameMap.Trees.Trees[closestTreeIndex]
		combinedRadius := 1.5 + tree.Radius
		log.Debug("Closest tree info", 
			"distance", fmt.Sprintf("%.2f units", closestTreeDist), 
			"combinedRadius", combinedRadius,
			"tree", fmt.Sprintf("#%d: Type=%s at (%.2f, %.2f, %.2f) with radius %.2f",
				closestTreeIndex, tree.Type, tree.Position.X, tree.Position.Y, tree.Position.Z, tree.Radius),
			"noCollision", fmt.Sprintf("%.2f > %.2f", closestTreeDist, combinedRadius))
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
			log.Warn("Rock collision detected", 
				"tank", fmt.Sprintf("%s (%s) at (%.2f, %.2f, %.2f)", tank.ID, tank.Name, tank.Position.X, tank.Position.Y, tank.Position.Z),
				"rock", fmt.Sprintf("%s (size: %.2f) at (%.2f, %.2f, %.2f)", rock.Type, rock.Size, rock.Position.X, rock.Position.Y, rock.Position.Z),
				"collisionPoint", fmt.Sprintf("(%.2f, %.2f)", collisionX, collisionZ),
				"distance", dist,
				"combinedRadius", 1.5+rock.Radius)

			// Only report one collision at a time to avoid log spam
			return
		}
	}

	// If we didn't find a collision but have rocks, report the closest rock
	if closestRockIndex >= 0 {
		rock := pi.gameMap.Rocks.Rocks[closestRockIndex]
		combinedRadius := 1.5 + rock.Radius
		log.Debug("Closest rock info", 
			"distance", fmt.Sprintf("%.2f units", closestRockDist), 
			"combinedRadius", combinedRadius,
			"rock", fmt.Sprintf("#%d: Type=%s at (%.2f, %.2f, %.2f) with radius %.2f",
				closestRockIndex, rock.Type, rock.Position.X, rock.Position.Y, rock.Position.Z, rock.Radius),
			"noCollision", fmt.Sprintf("%.2f > %.2f", closestRockDist, combinedRadius))
	}
}

// logEnvironmentProximity logs the proximity of tanks to environment objects
func (pi *PhysicsIntegration) logEnvironmentProximity(tankPositions []game.Position) {
	if len(tankPositions) == 0 {
		return
	}

	log.Debug("Environment proximity report")

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

	log.Debug("Top closest tank-environment pairs", "count", count)
	for i := 0; i < count; i++ {
		p := allProximities[i]
		combinedRadius := p.objRadius + p.tankRadius
		log.Debug("Proximity data", 
			"rank", i+1,
			"objectType", p.objType,
			"objectIndex", p.objIndex,
			"tankIndex", p.tankIndex,
			"distance", p.distance,
			"combinedRadius", combinedRadius,
			"difference", p.distance-combinedRadius)

		// If there's a potential collision, highlight it
		if p.distance <= combinedRadius {
			log.Warn("Potential collision detected", 
				"tank", fmt.Sprintf("(%.2f, %.2f)", p.tankPos.X, p.tankPos.Z),
				"object", p.objType,
				"objectPos", fmt.Sprintf("(%.2f, %.2f)", p.objPos.X, p.objPos.Z))
		}
	}
}

// runPhysicsLoop is the main physics update loop
func (pi *PhysicsIntegration) runPhysicsLoop() {
	log.Info("Tank-to-tank collision detection loop started")

	updateCount := 0

	for {
		pi.mutex.RLock()
		running := pi.isRunning
		pi.mutex.RUnlock()

		if !running {
			log.Info("Physics simulation stopped")
			return
		}

		updateCount++
		if updateCount%50 == 0 {
			log.Debug("Physics loop heartbeat", "updates", updateCount)
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
			log.Debug("Processing shells for collisions", "count", len(gameState.Shells))
		}

		// Make a copy of shells to avoid modifying the original state
		shellsCopy := make([]game.ShellState, len(gameState.Shells))
		copy(shellsCopy, gameState.Shells)

		// Log shell positions before physics update
		if len(shellsCopy) > 0 {
			log.Debug("Shell position before physics", 
				"shellID", shellsCopy[0].ID, 
				"position", fmt.Sprintf("(%.2f,%.2f,%.2f)", 
					shellsCopy[0].Position.X, 
					shellsCopy[0].Position.Y, 
					shellsCopy[0].Position.Z))
		}

		// Update shells with physics simulation
		pi.physicsManager.UpdateShells(shellsCopy)

		// Log shell positions after physics update to see if they changed
		if len(shellsCopy) > 0 {
			log.Debug("Shell position after physics", 
				"shellID", shellsCopy[0].ID, 
				"position", fmt.Sprintf("(%.2f,%.2f,%.2f)", 
					shellsCopy[0].Position.X, 
					shellsCopy[0].Position.Y, 
					shellsCopy[0].Position.Z))
		}

		// Check if any shells were modified by physics (hit ground or expired)
		// and need to be removed from game state
		shellsToRemove := []string{}
		for i, shell := range shellsCopy {
			// Check if the shell hit ground (Y <= 0) or was marked as collided (Y < 0)
			if shell.Position.Y <= 0 {
				shellsToRemove = append(shellsToRemove, shell.ID)
				log.Debug("Shell marked for removal", "shellID", shell.ID, "reason", "hit ground or collision")
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
		log.Debug("Physics cycle results", 
			"total", len(gameState.Shells), 
			"removed", len(shellsToRemove), 
			"active", len(gameState.Shells)-len(shellsToRemove))
	}

	// Run physics update for tank-to-tank collisions
	pi.physicsManager.Update()
}