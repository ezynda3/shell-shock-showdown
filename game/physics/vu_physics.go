package physics

import (
	"math"

	"github.com/charmbracelet/log"
	"tank-game/game"
	"tank-game/game/shared"
)

// Global physics manager instance is defined in physics.go

// VuPhysicsManager is a physics manager that uses a simplified physics engine
type VuPhysicsManager struct {
	gameMap      *game.GameMap
	tanks        map[string]*TankBody
	shells       map[string]*ShellBody
	obstacles    []*ObstacleBody  // Trees, rocks, and other static objects
	hits         []game.HitData   // Shell hits to process
	manager      *game.Manager    // Reference to game manager for callbacks
	shellPhysics *ShellPhysics    // Shell physics calculator
}

// TankBody represents a tank physics body
type TankBody struct {
	State    *game.PlayerState
	Collider *Collider
}

// ShellBody represents a shell physics body
type ShellBody struct {
	State    game.ShellState
	Collider *Collider
}

// ObstacleBody represents a static obstacle physics body (tree, rock)
type ObstacleBody struct {
	Position game.Position
	Radius   float64
	Type     ColliderType
	ID       string
}

// NewVuPhysicsManager creates a new physics manager using a simplified physics engine
func NewVuPhysicsManager(gameMap *game.GameMap, gameManager *game.Manager) *VuPhysicsManager {
	pm := &VuPhysicsManager{
		gameMap:      gameMap,
		tanks:        make(map[string]*TankBody),
		shells:       make(map[string]*ShellBody),
		obstacles:    make([]*ObstacleBody, 0),
		hits:         make([]game.HitData, 0),
		manager:      gameManager,
		shellPhysics: NewShellPhysics(),
	}

	// Initialize obstacle bodies for trees
	for _, tree := range gameMap.Trees.Trees {
		// Increased collision radius for trees to 1.5x the visual size
		collisionRadius := tree.Radius * 1.2

		// Add body to the list of obstacle bodies
		pm.obstacles = append(pm.obstacles, &ObstacleBody{
			Position: tree.Position,
			Radius:   collisionRadius,
			Type:     ColliderTree,
			ID:       string(tree.Type),
		})
	}

	// Initialize obstacle bodies for rocks
	for _, rock := range gameMap.Rocks.Rocks {
		// Increased collision radius for rocks
		collisionRadius := rock.Radius * 1.2

		// Add body to the list of obstacle bodies
		pm.obstacles = append(pm.obstacles, &ObstacleBody{
			Position: rock.Position,
			Radius:   collisionRadius,
			Type:     ColliderRock,
			ID:       string(rock.Type),
		})
	}

	log.Debug("Physics: Initialized obstacle bodies", "count", len(pm.obstacles))

	// Set as global instance (using the one defined in physics.go)
	PhysicsManagerInstance = pm

	return pm
}

// RegisterTank registers a tank with the physics manager
func (pm *VuPhysicsManager) RegisterTank(tank *game.PlayerState) {
	// If tank already exists, just update the state
	if existingTank, ok := pm.tanks[tank.ID]; ok {
		existingTank.State = tank
		return
	}

	// Create a collider
	collider := &Collider{
		Position: tank.Position,
		Radius:   2.5, // increased from 1.5 for more forgiving collision detection
		Type:     ColliderTank,
		ID:       tank.ID,
	}

	// Create the tank body
	tankBody := &TankBody{
		State:    tank,
		Collider: collider,
	}

	// Add to tanks map
	pm.tanks[tank.ID] = tankBody

	log.Info("Registered tank", "id", tank.ID, "name", tank.Name)
}

// UnregisterTank removes a tank from the physics manager
func (pm *VuPhysicsManager) UnregisterTank(tankID string) {
	if _, ok := pm.tanks[tankID]; !ok {
		return
	}

	// Remove from tanks map
	delete(pm.tanks, tankID)

	log.Info("Unregistered tank", "id", tankID)
}

// UpdateTank updates the physics state of a tank
func (pm *VuPhysicsManager) UpdateTank(tank *game.PlayerState) {
	// If tank doesn't exist, register it
	if _, ok := pm.tanks[tank.ID]; !ok {
		log.Warn("Tried to update unregistered tank", "id", tank.ID)
		pm.RegisterTank(tank)
		return
	}

	// Update tank state
	pm.tanks[tank.ID].State = tank

	// Update collider
	pm.tanks[tank.ID].Collider.Position = tank.Position
}

// UpdateShells updates the physics state of shells
func (pm *VuPhysicsManager) UpdateShells(shells []game.ShellState) {
	log.Debug("UpdateShells called", "count", len(shells))

	// Clear the existing shells map and recreate it
	pm.shells = make(map[string]*ShellBody)

	// Add all the shells from the update
	for i := range shells {
		// Make a copy of the shell to avoid issues with array references
		shell := shells[i]

		// Create a collider
		collider := &Collider{
			Position: shell.Position,
			Radius:   0.25, // 25cm radius
			Type:     ColliderShell,
			ID:       shell.ID,
		}

		// Create the shell body
		shellBody := &ShellBody{
			State:    shell,
			Collider: collider,
		}

		// Add to shells map
		pm.shells[shell.ID] = shellBody

		// Update shells in input array for feedback to game state
		shells[i] = shell
	}
}

// Update runs the physics simulation for one step
func (pm *VuPhysicsManager) Update() {
	// Clear previous hits
	pm.hits = make([]game.HitData, 0)

	// Check for tank-shell collisions
	pm.checkShellCollisions()

	// Apply gravity and other forces
	// Run the physics simulation
	pm.applyGravityToShells()
}

// GetHits returns the hits detected during the last update
func (pm *VuPhysicsManager) GetHits() []game.HitData {
	return pm.hits
}

// CheckLineOfSight implements the PhysicsEngine interface for AI targeting
func (pm *VuPhysicsManager) CheckLineOfSight(from, to shared.Position) bool {
	// Convert to game.Position
	fromPos := game.Position{X: from.X, Y: from.Y, Z: from.Z}
	toPos := game.Position{X: to.X, Y: to.Y, Z: to.Z}

	// Check if there's a clear line of sight between two positions
	// by checking if the line intersects with any obstacles
	// Simple implementation using direct ray to obstacles
	for _, obstacle := range pm.obstacles {
		// Check if the line from-to intersects with the obstacle
		if lineSphereIntersection(fromPos, toPos, obstacle.Position, obstacle.Radius) {
			return false
		}
	}

	return true
}

// checkShellCollisions checks for collisions between shells and tanks
func (pm *VuPhysicsManager) checkShellCollisions() {
	log.Debug("Checking shells against tanks", "shells", len(pm.shells), "tanks", len(pm.tanks))

	// Check each shell against each tank
	for shellID, shell := range pm.shells {
		shellPos := shell.State.Position

		// Skip shells that are below ground level (already hit ground)
		if shellPos.Y < 0 {
			continue
		}

		for tankID, tank := range pm.tanks {
			// Skip if the shell belongs to this tank (don't hit self)
			if shell.State.PlayerID == tankID {
				continue
			}

			// Skip if tank is already destroyed
			if tank.State.IsDestroyed {
				continue
			}

			tankPos := tank.State.Position

			// Check for collision
			if CheckCollision(shell.Collider, tank.Collider) {
				// Determine hit location (front, side, rear, top)
				hitLocation := determineHitLocation(shellPos, tankPos, tank.State.TankRotation)

				// Calculate damage based on hit location and shell properties
				damageAmount := calculateDamage(hitLocation)

				log.Info("Shell hit detected", 
					"shellID", shellID,
					"sourceID", shell.State.PlayerID,
					"targetID", tankID,
					"targetName", tank.State.Name,
					"hitLocation", hitLocation,
					"damage", damageAmount)

				// Create hit data
				hit := game.HitData{
					SourceID:     shell.State.PlayerID,
					TargetID:     tankID,
					HitLocation:  hitLocation,
					DamageAmount: damageAmount,
					Timestamp:    shell.State.Timestamp,
				}

				// Immediately process the hit if we have a manager
				if pm.manager != nil {
					err := pm.manager.ProcessTankHit(hit)
					if err != nil {
						log.Error("Error processing tank hit", "error", err)
					} else {
						log.Debug("Successfully processed hit on tank", "targetID", hit.TargetID)
					}
				} else {
					// Add to hits for later processing
					pm.hits = append(pm.hits, hit)
				}

				// Mark the shell as hit by setting its Y position negative
				shell.State.Position.Y = -1
				shell.Collider.Position.Y = -1
				break
			}
		}
	}
}

// applyGravityToShells applies gravity to all shells
func (pm *VuPhysicsManager) applyGravityToShells() {
	for _, shell := range pm.shells {
		// Skip shells that have already hit something
		if shell.State.Position.Y < 0 {
			continue
		}

		// Apply gravity - shells fall over time
		const GRAVITY = 9.8 // m/s^2

		// Adjust speed and direction based on gravity for 100ms
		// In a real simulation, we'd use time delta
		velocityY := shell.State.Direction.Y * shell.State.Speed
		velocityY -= GRAVITY * 0.1 // Apply gravity for 100ms

		// Calculate new speed (magnitude of velocity)
		velocityX := shell.State.Direction.X * shell.State.Speed
		velocityZ := shell.State.Direction.Z * shell.State.Speed
		newSpeed := math.Sqrt(velocityX*velocityX + velocityY*velocityY + velocityZ*velocityZ)

		// Calculate new normalized direction
		if newSpeed > 0 {
			shell.State.Direction.X = velocityX / newSpeed
			shell.State.Direction.Y = velocityY / newSpeed
			shell.State.Direction.Z = velocityZ / newSpeed
			shell.State.Speed = newSpeed
		}

		// Update position based on velocity for 100ms
		shell.State.Position.X += shell.State.Direction.X * shell.State.Speed * 0.1
		shell.State.Position.Y += shell.State.Direction.Y * shell.State.Speed * 0.1
		shell.State.Position.Z += shell.State.Direction.Z * shell.State.Speed * 0.1

		// Check if shell hit the ground
		if shell.State.Position.Y <= 0 {
			shell.State.Position.Y = 0 // Clamp to ground
			// Shell hit the ground, mark it as hit
			shell.Collider.Position = shell.State.Position
		} else {
			// Update shell collider position
			shell.Collider.Position = shell.State.Position
		}
	}
}

// determineHitLocation determines where on the tank the shell hit
func determineHitLocation(shellPos, tankPos game.Position, tankRotation float64) string {
	// Convert tank rotation to radians
	tankRotationRad := tankRotation * math.Pi / 180.0

	// Calculate direction vector from tank to shell
	dx := shellPos.X - tankPos.X
	dz := shellPos.Z - tankPos.Z

	// Calculate angle between tank forward direction and hit direction
	tankDirX := math.Sin(tankRotationRad)
	tankDirZ := math.Cos(tankRotationRad)

	// Calculate dot product
	dotProduct := tankDirX*dx + tankDirZ*dz

	// Calculate magnitude of vectors
	tankDirMag := math.Sqrt(tankDirX*tankDirX + tankDirZ*tankDirZ)
	hitDirMag := math.Sqrt(dx*dx + dz*dz)

	// Calculate angle
	angleCos := dotProduct / (tankDirMag * hitDirMag)
	angleRad := math.Acos(angleCos)
	angleDeg := angleRad * 180.0 / math.Pi

	// Special case for top hit
	if shellPos.Y > tankPos.Y+1.0 {
		return "top"
	}

	// Determine location based on angle
	if angleDeg < 45 {
		return "front"
	} else if angleDeg > 135 {
		return "rear"
	} else {
		return "side"
	}
}

// calculateDamage calculates damage based on hit location
func calculateDamage(hitLocation string) int {
	// Different damage based on where the tank is hit
	switch hitLocation {
	case "rear":
		return 40 // Most damage on rear hit (weak spot)
	case "side":
		return 30
	case "top":
		return 35 // Substantial damage on top hit
	case "front":
		return 25 // Least damage on front hit (armored)
	default:
		return 30 // Default damage
	}
}

// lineSphereIntersection checks if a line intersects with a sphere
func lineSphereIntersection(start, end, center game.Position, radius float64) bool {
	// Convert to a ray intersection problem
	// Direction vector of the ray
	dx := end.X - start.X
	dy := end.Y - start.Y
	dz := end.Z - start.Z

	// Length of the ray
	rayLength := math.Sqrt(dx*dx + dy*dy + dz*dz)
	if rayLength < 0.001 {
		// The ray has zero length, just check if start is inside the sphere
		sx := start.X - center.X
		sy := start.Y - center.Y
		sz := start.Z - center.Z
		return sx*sx+sy*sy+sz*sz <= radius*radius
	}

	// Normalize the direction vector
	dx /= rayLength
	dy /= rayLength
	dz /= rayLength

	// Vector from ray origin to sphere center
	ox := start.X - center.X
	oy := start.Y - center.Y
	oz := start.Z - center.Z

	// Calculate coefficients for quadratic equation
	a := dx*dx + dy*dy + dz*dz // Always 1 for normalized ray
	b := 2 * (ox*dx + oy*dy + oz*dz)
	c := ox*ox + oy*oy + oz*oz - radius*radius

	// Calculate discriminant
	discriminant := b*b - 4*a*c

	// If discriminant is negative, the ray doesn't intersect the sphere
	if discriminant < 0 {
		return false
	}

	// Calculate intersection points
	t1 := (-b - math.Sqrt(discriminant)) / (2 * a)
	t2 := (-b + math.Sqrt(discriminant)) / (2 * a)

	// Check if any intersection point is within the line segment
	return (t1 >= 0 && t1 <= rayLength) || (t2 >= 0 && t2 <= rayLength)
}