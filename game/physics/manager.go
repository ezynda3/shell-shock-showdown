package physics

import (
	"fmt"
	"log"
	"math"
	"time"

	"github.com/mark3labs/pro-saaskit/game"
	"github.com/mark3labs/pro-saaskit/game/shared"
)

// We now use the shared.PhysicsManagerInterface defined in game/shared

// PhysicsManager handles collision detection and physics calculations
type PhysicsManager struct {
	gameMap      *game.GameMap
	tanks        map[string]*game.PlayerState
	shells       []game.ShellState // Active shells for collision detection
	hits         []game.HitData    // Shell hits to process
	manager      *game.Manager     // Reference to game manager for callbacks
	shellPhysics *ShellPhysics     // Shell physics calculator
}

// NewPhysicsManager creates a new physics manager
func NewPhysicsManager(gameMap *game.GameMap, gameManager *game.Manager) *PhysicsManager {
	return &PhysicsManager{
		gameMap:      gameMap,
		tanks:        make(map[string]*game.PlayerState),
		shells:       make([]game.ShellState, 0),
		hits:         make([]game.HitData, 0),
		manager:      gameManager,
		shellPhysics: NewShellPhysics(), // Initialize shell physics
	}
}

// RegisterTank registers a tank for collision detection
func (pm *PhysicsManager) RegisterTank(tank *game.PlayerState) {
	pm.tanks[tank.ID] = tank
}

// UnregisterTank removes a tank from collision detection
func (pm *PhysicsManager) UnregisterTank(tankID string) {
	delete(pm.tanks, tankID)
}

// UpdateTank updates a tank's position and checks for collisions with other tanks
func (pm *PhysicsManager) UpdateTank(tank *game.PlayerState) {
	// Skip collision detection if tank is destroyed
	if tank.IsDestroyed {
		return
	}

	// Check for collisions with other tanks
	for id, otherTank := range pm.tanks {
		if id != tank.ID && !otherTank.IsDestroyed {
			if pm.checkCollision(tank.Position, 5.0, otherTank.Position, 5.0) {
				log.Printf("COLLISION: Tank %s (%s) collided with tank %s (%s)",
					tank.ID, tank.Name, id, otherTank.Name)
			}
		}
	}
}

// checkCollision checks if two spheres are colliding
// Parameters:
// - pos1: Position of the first object
// - radius1: Radius of the first object
// - pos2: Position of the second object
// - radius2: Radius of the second object
func (pm *PhysicsManager) checkCollision(pos1 game.Position, radius1 float64, pos2 game.Position, radius2 float64) bool {
	// Calculate distance between two objects
	dx := pos1.X - pos2.X
	dy := pos1.Y - pos2.Y
	dz := pos1.Z - pos2.Z

	// Usually we can ignore Y (height) for ground-based objects
	// Uncomment this if you want to ignore height in collision detection
	// dy = 0.0

	// Calculate the squared distance
	distanceSquared := dx*dx + dy*dy + dz*dz

	// Calculate the sum of radii
	sumRadii := radius1 + radius2
	sumRadiiSquared := sumRadii * sumRadii

	// Uncomment for detailed collision debugging
	// log.Printf("DEBUG COLLISION: Distance²=%.2f vs (Radius1+Radius2)²=%.2f",
	//    distanceSquared, sumRadiiSquared)

	// Check if the distance is less than the sum of radii
	return distanceSquared < sumRadiiSquared
}

// UpdateShells updates the shells in the physics manager
func (pm *PhysicsManager) UpdateShells(shells []game.ShellState) {
	// Log details about the shells we received
	log.Printf("🔄 PHYSICS: UpdateShells called with %d shells", len(shells))

	// Print detailed info for up to 3 shells
	maxShellsToLog := 3
	if len(shells) > 0 {
		log.Println("📋 SHELL SNAPSHOTS: (sample of incoming shells)")
		for i, shell := range shells {
			if i >= maxShellsToLog {
				log.Printf("... and %d more shells", len(shells)-maxShellsToLog)
				break
			}
			// Log shell details
			log.Printf("  Shell %d/%d: ID=%s, Player=%s, Pos=(%.2f,%.2f,%.2f), Age=%dms",
				i+1, len(shells), shell.ID, shell.PlayerID,
				shell.Position.X, shell.Position.Y, shell.Position.Z,
				time.Now().UnixMilli()-shell.Timestamp)
		}
	}

	// Replace current shells with new shell data
	pm.shells = shells

	// Check for collisions with tanks
	pm.checkShellCollisions()
}

// checkShellCollisions detects collisions between shells and tanks
func (pm *PhysicsManager) checkShellCollisions() {
	// Base damage amount
	const baseDamage = 25 // Base damage per hit
	const tankRadius = 20.0 // Tank radius increased for better hit detection

	// Clear previous hits
	pm.hits = pm.hits[:0]

	// Log tank count for collision detection
	log.Printf("🔍 PHYSICS: Checking %d shells against %d tanks", len(pm.shells), len(pm.tanks))

	// Check each shell against each tank
	for i := range pm.shells {
		shell := pm.shells[i] // Use a copy to avoid modifying the slice elements during iteration

		log.Printf("🔄 PHYSICS: Processing shell %s from player %s", shell.ID, shell.PlayerID)

		// First update the shell position based on physics
		// This simulates the shell's trajectory on the server
		// to ensure more accurate collision detection
		stillActive := pm.shellPhysics.UpdateShellPosition(&shell)
		if !stillActive {
			// Shell hit ground or expired - update it in the original array
			// Mark for removal by the game manager
			pm.shells[i].Position.Y = 0 // Force to ground level as an indicator it should be removed
			log.Printf("💥 PHYSICS: Shell %s marked for removal (hit ground or expired)", shell.ID)
			continue
		}

		// Update the original shell position
		pm.shells[i] = shell

		// Log that we're starting collision checks for this shell
		log.Printf("👉 PHYSICS: Checking shell %s for collisions with tanks", shell.ID)

		// Now check for collisions with this updated position
		for tankID, tank := range pm.tanks {
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

				// Log hit detection with more details
				log.Printf("🎯 Shell hit detected: Shell %s from player %s hit tank %s (%s) on %s for %d damage",
					shell.ID, shell.PlayerID, tankID, tank.Name, hitLocation, damageAmount)

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
						// Log error but don't stop processing - it might be an NPC tank
						// that's not properly registered with the game manager
						log.Printf("Error processing tank hit: %v", err)
						
						// Attempt to register the tank with the game manager if it's not found
						if tankID == hit.TargetID {
							// Create a new player state for this tank if it doesn't exist
							if tank != nil {
								// Set health to maximum - damage
								tankHealth := 100 - hit.DamageAmount
								if tankHealth < 0 {
									tankHealth = 0
								}
								
								// Try to update tank to game manager to fix the issue
								logTankData := fmt.Sprintf("ID: %s, Name: %s, Health: %d, Position: (%.2f,%.2f,%.2f)",
									tankID, tank.Name, tankHealth, 
									tank.Position.X, tank.Position.Y, tank.Position.Z)
								log.Printf("🔄 RECOVERY: Attempting to register tank: %s", logTankData)
							}
						}
					} else {
						log.Printf("✅ PHYSICS: Successfully processed hit on tank %s", hit.TargetID)
					}
				}

				// Mark shell as hit (will be removed next update)
				// Update it in the original slice
				pm.shells[i].Position.Y = -1 // Special value to indicate collision hit

				// Shell can only hit one tank, so break after processing a hit
				break
			}
		}
	}
}

// Update updates all registered tanks and processes collisions
func (pm *PhysicsManager) Update() {
	// First update tank-to-tank collisions
	for _, tank := range pm.tanks {
		pm.UpdateTank(tank)
	}

	// Then check for shell collisions - this is now done in UpdateShells
	// but we could re-check here if needed
}

// GetHits returns the detected hits since the last update
func (pm *PhysicsManager) GetHits() []game.HitData {
	return pm.hits
}

// CheckLineOfSight determines if there is a clear line of sight between two positions
// Used by NPCs to determine if they can see and shoot at a target
func (pm *PhysicsManager) CheckLineOfSight(fromPos, toPos shared.Position) bool {
	// Calculate direction vector
	dx := toPos.X - fromPos.X
	dy := toPos.Y - fromPos.Y
	dz := toPos.Z - fromPos.Z
	
	// Calculate distance
	distance := math.Sqrt(dx*dx + dy*dy + dz*dz)
	
	// Normalize direction vector
	if distance > 0 {
		dx /= distance
		dy /= distance
		dz /= distance
	}
	
	// Check for obstacles along the line of sight
	// This is a simplified ray-casting approach
	stepSize := 5.0 // Step size for checks along the ray
	maxSteps := int(distance / stepSize) + 1
	
	// We'll sample at several points along the line
	for step := 1; step < maxSteps; step++ {
		// Calculate the point to check
		checkDist := float64(step) * stepSize
		if checkDist > distance {
			checkDist = distance
		}
		
		// Create check position (currently unused, but will be used in future enhancements)
		// We're calculating this but not using it yet since we don't have obstacle data
		_ = shared.Position{
			X: fromPos.X + dx*checkDist,
			Y: fromPos.Y + dy*checkDist,
			Z: fromPos.Z + dz*checkDist,
		}
		
		// Check for collisions with environment objects
		// For simplicity, only check for terrain height or fixed obstacles
		
		// TODO: Add more sophisticated obstacle checks if needed
		
		// For now, return true as a basic implementation
		// In a full implementation, we would check for terrain and obstacles
	}
	
	// No obstacles found, there is line of sight
	return true
}
