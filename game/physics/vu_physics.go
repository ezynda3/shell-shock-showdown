package physics

import (
	"log"
	"math"

	"github.com/gazed/vu/math/lin"
	vuphysics "github.com/gazed/vu/physics"
	"github.com/mark3labs/pro-saaskit/game"
	"github.com/mark3labs/pro-saaskit/game/shared"
)

// VuPhysicsManager is a physics manager that uses the vu/physics engine
type VuPhysicsManager struct {
	gameMap      *game.GameMap
	tanks        map[string]*TankBody
	shells       map[string]*ShellBody
	obstacles    []*ObstacleBody // Trees, rocks, and other static objects
	hits         []game.HitData  // Shell hits to process
	manager      *game.Manager   // Reference to game manager for callbacks
	shellPhysics *ShellPhysics   // Shell physics calculator
	bodies       []vuphysics.Body // All physics bodies for simulation
}

// TankBody represents a tank physics body
type TankBody struct {
	Body      *vuphysics.Body
	State     *game.PlayerState
	Collider  *Collider
}

// ShellBody represents a shell physics body
type ShellBody struct {
	Body      *vuphysics.Body
	State     game.ShellState
	Collider  *Collider
}

// ObstacleBody represents a static obstacle physics body (tree, rock)
type ObstacleBody struct {
	Body      *vuphysics.Body
	Position  game.Position
	Radius    float64
	Type      ColliderType
	ID        string
}

// NewVuPhysicsManager creates a new physics manager using vu/physics
func NewVuPhysicsManager(gameMap *game.GameMap, gameManager *game.Manager) *VuPhysicsManager {
	pm := &VuPhysicsManager{
		gameMap:      gameMap,
		tanks:        make(map[string]*TankBody),
		shells:       make(map[string]*ShellBody),
		obstacles:    make([]*ObstacleBody, 0),
		hits:         make([]game.HitData, 0),
		manager:      gameManager,
		shellPhysics: NewShellPhysics(),
		bodies:       make([]vuphysics.Body, 0),
	}

	// Initialize obstacles (trees and rocks)
	pm.initializeObstacles()

	return pm
}

// initializeObstacles creates physics bodies for all static obstacles
func (pm *VuPhysicsManager) initializeObstacles() {
	// Add trees
	for i, tree := range pm.gameMap.Trees.Trees {
		treeBody := vuphysics.NewSphere(tree.Radius, true) // Static body
		
		// Convert position to vu/physics format
		pos := lin.NewV3()
		pos.SetS(tree.Position.X, tree.Position.Y, tree.Position.Z)
		treeBody.SetPosition(*pos)
		
		// Create obstacle record
		obstacle := &ObstacleBody{
			Body:     treeBody,
			Position: tree.Position,
			Radius:   tree.Radius,
			Type:     ColliderTree,
			ID:       string(tree.Type) + "_" + string(rune(i)),
		}
		
		pm.obstacles = append(pm.obstacles, obstacle)
		pm.bodies = append(pm.bodies, *treeBody)
	}
	
	// Add rocks
	for i, rock := range pm.gameMap.Rocks.Rocks {
		rockBody := vuphysics.NewSphere(rock.Radius, true) // Static body
		
		// Convert position to vu/physics format
		pos := lin.NewV3()
		pos.SetS(rock.Position.X, rock.Position.Y, rock.Position.Z)
		rockBody.SetPosition(*pos)
		
		// Create obstacle record
		obstacle := &ObstacleBody{
			Body:     rockBody,
			Position: rock.Position,
			Radius:   rock.Radius,
			Type:     ColliderRock,
			ID:       string(rock.Type) + "_" + string(rune(i)),
		}
		
		pm.obstacles = append(pm.obstacles, obstacle)
		pm.bodies = append(pm.bodies, *rockBody)
	}
	
	log.Printf("🔄 PHYSICS: Initialized %d obstacle bodies", len(pm.obstacles))
}

// RegisterTank registers a tank for physics simulation
func (pm *VuPhysicsManager) RegisterTank(tank *game.PlayerState) {
	// Create physics body
	tankBody := vuphysics.NewSphere(1.5, false) // 1.5 = tank radius, not static
	
	// Convert position to vu/physics format
	pos := lin.NewV3()
	pos.SetS(tank.Position.X, tank.Position.Y, tank.Position.Z)
	tankBody.SetPosition(*pos)
	
	// Create collider
	collider := GetTankCollider(tank)
	
	// Create tank record
	tankRecord := &TankBody{
		Body:     tankBody,
		State:    tank,
		Collider: collider,
	}
	
	// Add to tanks map
	pm.tanks[tank.ID] = tankRecord
	pm.bodies = append(pm.bodies, *tankBody)
	
	log.Printf("✅ PHYSICS: Registered tank %s (%s)", tank.ID, tank.Name)
}

// UnregisterTank removes a tank from physics simulation
func (pm *VuPhysicsManager) UnregisterTank(tankID string) {
	// Find the tank
	_, exists := pm.tanks[tankID]
	if !exists {
		return
	}
	
	// For simplicity, rebuild the bodies list instead of trying to remove just one
	// This avoids the need to compare body structs which can't be compared directly
	newBodies := make([]vuphysics.Body, 0, len(pm.bodies)-1)
	
	// Rebuild list excluding the tank being removed
	for id, t := range pm.tanks {
		if id != tankID { // Skip the tank we're removing
			newBodies = append(newBodies, *t.Body)
		}
	}
	
	// Add all obstacle bodies
	for _, obs := range pm.obstacles {
		newBodies = append(newBodies, *obs.Body)
	}
	
	// Add all shell bodies
	for _, s := range pm.shells {
		newBodies = append(newBodies, *s.Body)
	}
	
	// Replace bodies list
	pm.bodies = newBodies
	
	// Remove from tanks map
	delete(pm.tanks, tankID)
	
	log.Printf("🔄 PHYSICS: Unregistered tank %s", tankID)
}

// UpdateTank updates a tank's position and checks for collisions
func (pm *VuPhysicsManager) UpdateTank(tank *game.PlayerState) {
	// Skip collision detection if tank is destroyed
	if tank.IsDestroyed {
		return
	}
	
	// Find the tank body
	tankBody, exists := pm.tanks[tank.ID]
	if !exists {
		log.Printf("⚠️ PHYSICS WARNING: Tried to update unregistered tank %s", tank.ID)
		return
	}
	
	// Update the body's position with tank's latest position
	pos := lin.NewV3()
	pos.SetS(tank.Position.X, tank.Position.Y, tank.Position.Z)
	tankBody.Body.SetPosition(*pos)
	
	// If tank is moving, apply velocity
	if tank.IsMoving && tank.Velocity > 0 {
		// Calculate direction based on tank rotation
		dirX := math.Sin(tank.TankRotation * math.Pi / 180)
		dirZ := math.Cos(tank.TankRotation * math.Pi / 180)
		
		// Apply force in that direction
		force := tank.Velocity * 5.0 // Scale factor for reasonable force
		tankBody.Body.Push(dirX*force, 0, dirZ*force)
	}
	
	// Update the collider's position to match
	tankBody.Collider.Position = tank.Position
}

// UpdateShells updates the shells in the physics manager
func (pm *VuPhysicsManager) UpdateShells(shells []game.ShellState) {
	log.Printf("🔄 PHYSICS: UpdateShells called with %d shells", len(shells))
	
	// Track current shell IDs for cleanup
	currentShellIDs := make(map[string]bool)
	
	// Process incoming shells
	for _, shell := range shells {
		currentShellIDs[shell.ID] = true
		
		// Check if shell already exists
		shellBody, exists := pm.shells[shell.ID]
		if !exists {
			// Create new shell body
			newShellBody := vuphysics.NewSphere(0.5, false) // 0.5 = shell radius, not static
			
			// Set position
			pos := lin.NewV3()
			pos.SetS(shell.Position.X, shell.Position.Y, shell.Position.Z)
			newShellBody.SetPosition(*pos)
			
			// Create collider
			collider := &Collider{
				Position: shell.Position,
				Radius:   0.5,
				Type:     ColliderShell,
				ID:       shell.ID,
			}
			
			// Create shell record
			shellBody = &ShellBody{
				Body:     newShellBody,
				State:    shell,
				Collider: collider,
			}
			
			// Add to shells map
			pm.shells[shell.ID] = shellBody
			pm.bodies = append(pm.bodies, *newShellBody)
			
			// Apply initial velocity
			speed := shell.Speed
			newShellBody.Push(
				shell.Direction.X * speed,
				shell.Direction.Y * speed,
				shell.Direction.Z * speed,
			)
		} else {
			// Update existing shell
			shellBody.State = shell
			
			// Update position with correct lin.V3 usage
			pos := lin.NewV3()
			pos.SetS(shell.Position.X, shell.Position.Y, shell.Position.Z)
			shellBody.Body.SetPosition(*pos)
			
			shellBody.Collider.Position = shell.Position
		}
	}
	
	// Remove shells that no longer exist
	for id, _ := range pm.shells {
		if !currentShellIDs[id] {
			// Rebuild bodies list excluding this shell
			newBodies := make([]vuphysics.Body, 0, len(pm.bodies)-1)
			
			// Add all tanks
			for _, t := range pm.tanks {
				newBodies = append(newBodies, *t.Body)
			}
			
			// Add all obstacles
			for _, obs := range pm.obstacles {
				newBodies = append(newBodies, *obs.Body)
			}
			
			// Add all shells except the one being removed
			for shellID, s := range pm.shells {
				if shellID != id {
					newBodies = append(newBodies, *s.Body)
				}
			}
			
			// Replace bodies list
			pm.bodies = newBodies
			
			// Remove from shells map
			delete(pm.shells, id)
		}
	}
	
	// Check for collisions with tanks
	pm.checkShellCollisions()
}

// checkShellCollisions detects collisions between shells and tanks
func (pm *VuPhysicsManager) checkShellCollisions() {
	// Base damage amount
	const baseDamage = 25 // Base damage per hit
	
	// Clear previous hits
	pm.hits = pm.hits[:0]
	
	// Log shell and tank counts
	log.Printf("🔍 PHYSICS: Checking %d shells against %d tanks", len(pm.shells), len(pm.tanks))
	
	// Check each shell against each tank
	for shellID, shellBody := range pm.shells {
		shell := shellBody.State
		
		// Update shell position based on physics
		stillActive := pm.shellPhysics.UpdateShellPosition(&shell)
		if !stillActive {
			// Shell hit ground or expired
			shellBody.State.Position.Y = 0 // Force to ground level
			continue
		}
		
		// Update the shell position
		shellBody.State = shell
		
		// Update physics body position
		pos := lin.NewV3()
		pos.SetS(shell.Position.X, shell.Position.Y, shell.Position.Z)
		shellBody.Body.SetPosition(*pos)
		
		shellBody.Collider.Position = shell.Position
		
		// Check for collisions with tanks
		for tankID, tankBody := range pm.tanks {
			tank := tankBody.State
			
			// Skip destroyed tanks
			if tank.IsDestroyed {
				continue
			}
			
			// Skip shells fired by this tank (can't hit yourself)
			if shell.PlayerID == tankID {
				continue
			}
			
			// Use detailed collision detection
			collision, hitLocation, damageMultiplier := pm.shellPhysics.DetailedCollisionCheck(shell, *tank)
			
			if collision {
				// Calculate final damage based on multiplier
				damageAmount := int(float64(baseDamage) * damageMultiplier)
				
				// Log hit detection
				log.Printf("🎯 Shell hit detected: Shell %s from player %s hit tank %s (%s) on %s for %d damage",
					shellID, shell.PlayerID, tankID, tank.Name, hitLocation, damageAmount)
				
				// Create a hit record
				hit := game.HitData{
					TargetID:     tankID,
					SourceID:     shell.PlayerID,
					DamageAmount: damageAmount,
				}
				
				// Add to hits list
				pm.hits = append(pm.hits, hit)
				
				// Process hit immediately if game manager is available
				if pm.manager != nil {
					err := pm.manager.ProcessTankHit(hit)
					if err != nil {
						log.Printf("Error processing tank hit: %v", err)
					} else {
						log.Printf("✅ PHYSICS: Successfully processed hit on tank %s", hit.TargetID)
					}
				}
				
				// Mark shell for removal
				shellBody.State.Position.Y = -1
				
				// Shell can only hit one tank, so break after processing a hit
				break
			}
		}
	}
}

// Update performs a physics simulation step
func (pm *VuPhysicsManager) Update() {
	// Update tank-to-tank collisions
	for _, tank := range pm.tanks {
		pm.UpdateTank(tank.State)
	}
	
	// Run the vu/physics simulation
	if len(pm.bodies) > 0 {
		log.Printf("🔧 PHYSICS: Running vu/physics simulation with %d bodies", len(pm.bodies))
		vuphysics.Simulate(pm.bodies, 1.0/60.0) // Assuming 60 FPS
	}
	
	// Update game objects with physics results
	pm.syncPhysicsToGameObjects()
}

// syncPhysicsToGameObjects updates game objects with the results of physics simulation
func (pm *VuPhysicsManager) syncPhysicsToGameObjects() {
	// Update tanks
	for _, tankBody := range pm.tanks {
		// Skip destroyed tanks
		if tankBody.State.IsDestroyed {
			continue
		}
		
		// Get position from physics body
		pos := tankBody.Body.Position()
		
		// Update tank state
		tankBody.State.Position.X = pos.X
		tankBody.State.Position.Y = pos.Y
		tankBody.State.Position.Z = pos.Z
		
		// Update collider
		tankBody.Collider.Position = tankBody.State.Position
		
		// Get velocity
		vel := tankBody.Body.Velocity()
		
		// Update tank velocity (magnitude)
		tankBody.State.Velocity = math.Sqrt(vel.X*vel.X + vel.Y*vel.Y + vel.Z*vel.Z)
		
		// Update tank moving state
		tankBody.State.IsMoving = tankBody.State.Velocity > 0.1
	}
	
	// Update shells
	for _, shellBody := range pm.shells {
		// Get position from physics body
		pos := shellBody.Body.Position()
		
		// Update shell state
		shellBody.State.Position.X = pos.X
		shellBody.State.Position.Y = pos.Y
		shellBody.State.Position.Z = pos.Z
		
		// Update collider
		shellBody.Collider.Position = shellBody.State.Position
	}
}

// GetHits returns the detected hits since the last update
func (pm *VuPhysicsManager) GetHits() []game.HitData {
	return pm.hits
}

// CheckLineOfSight determines if there is a clear line of sight between two positions
func (pm *VuPhysicsManager) CheckLineOfSight(fromPos, toPos shared.Position) bool {
	// Convert shared.Position to game.Position
	from := game.Position{X: fromPos.X, Y: fromPos.Y, Z: fromPos.Z}
	to := game.Position{X: toPos.X, Y: toPos.Y, Z: toPos.Z}
	
	// Calculate direction vector
	dx := to.X - from.X
	dy := to.Y - from.Y
	dz := to.Z - from.Z
	
	// Calculate distance
	distance := math.Sqrt(dx*dx + dy*dy + dz*dz)
	
	// Normalize direction vector
	if distance > 0 {
		dx /= distance
		dy /= distance
		dz /= distance
	}
	
	// Check for obstacles along the line of sight
	stepSize := 5.0
	maxSteps := int(distance / stepSize) + 1
	
	for step := 1; step < maxSteps; step++ {
		checkDist := float64(step) * stepSize
		if checkDist > distance {
			checkDist = distance
		}
		
		// Calculate check position
		checkPos := game.Position{
			X: from.X + dx*checkDist,
			Y: from.Y + dy*checkDist,
			Z: from.Z + dz*checkDist,
		}
		
		// Check for collisions with obstacles
		for _, obstacle := range pm.obstacles {
			obstaclePos := obstacle.Position
			
			// Calculate distance to obstacle
			obsDx := checkPos.X - obstaclePos.X
			obsDy := checkPos.Y - obstaclePos.Y
			obsDz := checkPos.Z - obstaclePos.Z
			obsDistSquared := obsDx*obsDx + obsDy*obsDy + obsDz*obsDz
			
			// Check if ray intersects with obstacle
			if obsDistSquared < obstacle.Radius*obstacle.Radius {
				// Obstacle blocks line of sight
				return false
			}
		}
	}
	
	// No obstacles found, there is line of sight
	return true
}