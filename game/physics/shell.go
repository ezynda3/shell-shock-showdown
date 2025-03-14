package physics

import (
	"math"
	"time"

	"github.com/charmbracelet/log"
	"tank-game/game"
)

// ShellPhysics handles shell trajectory and collision calculations
type ShellPhysics struct {
	// Shell constants
	GRAVITY          float64
	AIR_RESISTANCE   float64
	MAX_LIFETIME     int64 // milliseconds
	COLLISION_RADIUS float64

	// Wind effect - subtle drift to make shells less predictable
	WIND_X float64
	WIND_Z float64
}

// NewShellPhysics creates a new shell physics calculator
func NewShellPhysics() *ShellPhysics {
	// Create new physics object with appropriate collision radius for game scale (5000x5000 world)
	// Ensure consistency with client: client uses 0.2 * 100 = 20.0
	physics := &ShellPhysics{
		GRAVITY:          0.005,  // Gravity effect per update - matches client's 0.005
		AIR_RESISTANCE:   0.001,  // Air resistance coefficient - matches client's 0.001
		MAX_LIFETIME:     10000,  // 10 seconds maximum shell lifetime
		COLLISION_RADIUS: 0.5,    // Shell collision radius in world units
		WIND_X:           0.0001, // Very subtle wind effect in X direction
		WIND_Z:           0.0001, // Very subtle wind effect in Z direction
	}

	log.Debug("Shell physics initialized", 
		"gravity", physics.GRAVITY, 
		"airResistance", physics.AIR_RESISTANCE, 
		"maxLifetime", physics.MAX_LIFETIME,
		"collisionRadius", physics.COLLISION_RADIUS)

	return physics
}

// UpdateShells updates all shells in the game state
func (sp *ShellPhysics) UpdateShells(shells []game.ShellState) []game.ShellState {
	// Process each shell
	for i := range shells {
		// Make a copy to avoid issues with array references
		shell := &shells[i]

		// Skip shells that have hit something (Y < 0)
		if shell.Position.Y < 0 {
			continue
		}

		// Check if shell has expired based on timestamp
		currentTime := time.Now().UnixMilli()
		if currentTime-shell.Timestamp > sp.MAX_LIFETIME {
			log.Debug("Shell expired", "shellID", shell.ID, "age", currentTime-shell.Timestamp)
			shell.Position.Y = -1 // Mark as hit (below ground)
			continue
		}

		// Update the shell's position based on its direction and speed
		sp.UpdateShellPosition(shell)
	}

	// Return the updated shells
	return shells
}

// UpdateShellPosition updates the position of a single shell
func (sp *ShellPhysics) UpdateShellPosition(shell *game.ShellState) bool {
	// Apply gravity to Y component of velocity
	// Velocity = Direction * Speed
	velocityY := shell.Direction.Y * shell.Speed
	velocityY -= sp.GRAVITY

	// Apply wind effects (subtle random drift)
	velocityX := shell.Direction.X * shell.Speed
	velocityZ := shell.Direction.Z * shell.Speed

	// Add wind effects
	velocityX += sp.WIND_X
	velocityZ += sp.WIND_Z

	// Apply air resistance
	velocityX *= (1.0 - sp.AIR_RESISTANCE)
	velocityY *= (1.0 - sp.AIR_RESISTANCE)
	velocityZ *= (1.0 - sp.AIR_RESISTANCE)

	// Calculate new speed (magnitude of velocity)
	newSpeed := math.Sqrt(velocityX*velocityX + velocityY*velocityY + velocityZ*velocityZ)

	// Update shell direction (normalized velocity)
	if newSpeed > 0 {
		shell.Direction.X = velocityX / newSpeed
		shell.Direction.Y = velocityY / newSpeed
		shell.Direction.Z = velocityZ / newSpeed
		shell.Speed = newSpeed
	}

	// Log shell update occasionally to avoid spam
	if time.Now().UnixNano()%1000 == 0 {
		log.Debug("Shell physics update", 
			"shellID", shell.ID, 
			"position", shell.Position, 
			"speed", shell.Speed)
	}

	// Update position
	shell.Position.X += shell.Direction.X * shell.Speed
	shell.Position.Y += shell.Direction.Y * shell.Speed
	shell.Position.Z += shell.Direction.Z * shell.Speed

	// Check if shell hit the ground
	if shell.Position.Y <= 0 {
		shell.Position.Y = -1 // Mark as hit (below ground)
		log.Debug("Shell hit ground", "shellID", shell.ID, "position", shell.Position)
		return false
	}
	
	return true
}

// CheckShellCollisions checks for collisions between shells and obstacles
func (sp *ShellPhysics) CheckShellCollisions(shells []game.ShellState, obstacles []ObstacleData) []game.HitData {
	hits := make([]game.HitData, 0)

	// Process each shell
	for i := range shells {
		// Make a copy to avoid issues with array references
		shell := &shells[i]

		// Skip shells that have already hit something
		if shell.Position.Y < 0 {
			continue
		}

		// Create a collider for the shell
		shellCollider := Collider{
			Position: shell.Position,
			Radius:   sp.COLLISION_RADIUS,
			Type:     ColliderShell,
			ID:       shell.ID,
		}

		// Check for collisions with obstacles
		for _, obstacle := range obstacles {
			// Create a collider for the obstacle
			obstacleCollider := Collider{
				Position: obstacle.Position,
				Radius:   obstacle.Radius,
				Type:     obstacle.Type,
				ID:       obstacle.ID,
			}

			// Check for collision using extended collision function
			if ExtendedCheckCollision(&shellCollider, &obstacleCollider) {
				log.Debug("Shell collision detected", 
					"shellID", shell.ID, 
					"obstacleType", obstacle.Type, 
					"obstacleID", obstacle.ID)

				// Mark shell as hit
				shell.Position.Y = -1

				// If obstacle is a tank, register a hit
				if obstacle.Type == ColliderTank {
					// Determine hit data
					hitData := game.HitData{
						SourceID:     shell.PlayerID,
						TargetID:     obstacle.ID,
						HitLocation:  "body", // Default hit location
						DamageAmount: 30,     // Default damage
						Timestamp:    shell.Timestamp,
					}

					hits = append(hits, hitData)
					log.Info("Tank hit registered", 
						"shellID", shell.ID, 
						"sourceID", shell.PlayerID, 
						"targetID", obstacle.ID, 
						"damage", hitData.DamageAmount)
				}

				// Only register one hit per shell
				break
			}
		}
	}

	return hits
}

// ObstacleData represents an obstacle for collision detection
type ObstacleData struct {
	Position game.Position
	Radius   float64
	Type     ColliderType
	ID       string
}

// ExtendedCheckCollision checks if two colliders are intersecting with additional early-out
func ExtendedCheckCollision(a, b *Collider) bool {
	// Early out if either collider is marked as hit (Y < 0)
	if a.Position.Y < 0 || b.Position.Y < 0 {
		return false
	}

	// Use the base collision check
	isColliding := CheckCollision(a, b)

	if isColliding {
		log.Debug("Collision detected", 
			"distance", math.Sqrt(
				(a.Position.X-b.Position.X)*(a.Position.X-b.Position.X) + 
				(a.Position.Y-b.Position.Y)*(a.Position.Y-b.Position.Y) + 
				(a.Position.Z-b.Position.Z)*(a.Position.Z-b.Position.Z)), 
			"sumRadii", a.Radius+b.Radius, 
			"typeA", a.Type, 
			"typeB", b.Type)
	}

	return isColliding
}

// DetailedCollisionCheck provides detailed collision detection for shells hitting tanks
// Returns collision status, hit location (turret/body), and damage multiplier
func (sp *ShellPhysics) DetailedCollisionCheck(shell game.ShellState, tank game.PlayerState) (bool, string, float64) {
	// Tank collision radius (match with client) - 20.0 units
	const tankRadius = 20.0
	
	// Create colliders
	shellCollider := Collider{
		Position: shell.Position,
		Radius:   sp.COLLISION_RADIUS,
		Type:     ColliderShell,
		ID:       shell.ID,
	}
	
	tankCollider := Collider{
		Position: tank.Position,
		Radius:   tankRadius,
		Type:     ColliderTank,
		ID:       tank.ID,
	}
	
	// Check for collision
	collision := ExtendedCheckCollision(&shellCollider, &tankCollider)
	
	if collision {
		// Determine hit location and damage multiplier
		// For simplicity, assume body hit with standard damage
		hitLocation := "body"
		damageMultiplier := 1.0
		
		// Calculate height difference for turret hit detection
		heightDiff := shell.Position.Y - tank.Position.Y
		
		// If shell is higher than tank + some offset, it could be a turret hit
		if heightDiff > 10.0 {
			hitLocation = "turret"
			damageMultiplier = 1.5 // More damage for turret hits
		}
		
		// Log hit details
		log.Debug("Tank hit details", 
			"tankID", tank.ID,
			"shellID", shell.ID,
			"hitLocation", hitLocation,
			"damageMultiplier", damageMultiplier)
			
		return true, hitLocation, damageMultiplier
	}
	
	return false, "", 0.0
}