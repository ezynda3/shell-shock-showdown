package physics

import (
	"fmt"
	"log"
	"math"
	"time"

	"tank-game/game"
	"tank-game/game/shared"
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

	// Filter out shells that have already hit something (Y = -1)
	// This prevents shells from causing damage more than once
	var activeShells []game.ShellState
	var filteredCount int
	for _, shell := range shells {
		if shell.Position.Y != -1 {
			activeShells = append(activeShells, shell)
		} else {
			filteredCount++
		}
	}

	if filteredCount > 0 {
		log.Printf("🧹 PHYSICS: Filtered out %d shells that already hit something", filteredCount)
	}

	// Replace current shells with filtered shell data
	pm.shells = activeShells

	// Check for collisions with tanks
	pm.checkShellCollisions()
}

// checkShellCollisions detects collisions between shells and tanks
func (pm *PhysicsManager) checkShellCollisions() {
	// Base damage amount - reduced to prevent one-shot kills
	const baseDamage = 20 // Base damage per hit (reduced from 25)
	// Note: tankRadius is now defined in GetTankCollider and DetailedCollisionCheck as 20.0 consistently

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
				// Check if this shell has already been processed for a hit
				// by looking at its Y position (-1 indicates already processed)
				if pm.shells[i].Position.Y == -1 {
					log.Printf("🛑 DUPLICATE HIT PREVENTED: Shell %s already processed for a hit", shell.ID)
					break
				}

				// Calculate final damage based on multiplier
				// Calculate final damage based on multiplier, but with a maximum cap
				damageAmount := int(float64(baseDamage) * damageMultiplier)

				// Cap maximum damage to prevent one-shot kills (no more than 50% of health in one hit)
				if damageAmount > 50 {
					log.Printf("⚠️ DAMAGE CAPPED: Reducing damage from %d to 50 to prevent one-shot kills", damageAmount)
					damageAmount = 50
				}

				// Log hit detection with more details
				log.Printf("🎯 Shell hit detected: Shell %s from player %s hit tank %s (%s) on %s for %d damage",
					shell.ID, shell.PlayerID, tankID, tank.Name, hitLocation, damageAmount)

				// IMPORTANT: Mark shell as hit IMMEDIATELY to prevent multiple hits
				// Update it in the original slice
				pm.shells[i].Position.Y = -1 // Special value to indicate collision hit

				// Create a hit record with complete data for the server to process
				hit := game.HitData{
					TargetID:     tankID,
					SourceID:     shell.PlayerID,
					DamageAmount: damageAmount,
					HitLocation:  hitLocation,
					Timestamp:    time.Now().UnixMilli(),
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
// Note: This currently always returns true to avoid hit registration issues at long distances
func (pm *PhysicsManager) CheckLineOfSight(fromPos, toPos shared.Position) bool {
	// Calculate direction vector
	dx := toPos.X - fromPos.X
	dy := toPos.Y - fromPos.Y
	dz := toPos.Z - fromPos.Z

	// Calculate distance
	distance := math.Sqrt(dx*dx + dy*dy + dz*dz)

	// Log the distance for debugging
	log.Printf("🔍 LINE OF SIGHT CHECK: Distance between positions = %.2f", distance)

	// Always return true to ensure shells fired at long distance will hit their targets
	// This avoids the issue where shells don't register hits when the player is far away
	return true

	/*
		// This code is disabled but preserved for future enhancement
		// Normalize direction vector
		if distance > 0 {
			dx /= distance
			dy /= distance
			dz /= distance
		}

		// Check for obstacles along the line of sight
		// This is a simplified ray-casting approach
		stepSize := 5.0 // Step size for checks along the ray
		maxSteps := int(distance/stepSize) + 1

		// We'll sample at several points along the line
		for step := 1; step < maxSteps; step++ {
			// Calculate the point to check
			checkDist := float64(step) * stepSize
			if checkDist > distance {
				checkDist = distance
			}

			// Create check position
			checkPos := shared.Position{
				X: fromPos.X + dx*checkDist,
				Y: fromPos.Y + dy*checkDist,
				Z: fromPos.Z + dz*checkDist,
			}

			// Check for collisions with environment objects
			// For future implementation: check for terrain heights or fixed obstacles
		}
	*/
}
