package physics

import (
	"log"
	"math"
	"time"

	"github.com/mark3labs/pro-saaskit/game"
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
	// Create new physics object with extremely large collision radius to match game scale
	physics := &ShellPhysics{
		GRAVITY:          0.005,  // Gravity effect per update
		AIR_RESISTANCE:   0.001,  // Air resistance coefficient
		MAX_LIFETIME:     20000,  // 20 seconds
		COLLISION_RADIUS: 50.0,   // Extremely large radius based on observed world distances
		WIND_X:           0.0005,
		WIND_Z:           0.0005,
	}

	// Log the collision parameters
	log.Printf("🔧 PHYSICS: Initialized shell physics with: Shell radius=%.2f, Tank radius=1.5, Combined=%.2f",
		physics.COLLISION_RADIUS, physics.COLLISION_RADIUS+1.5)

	return physics
}

// updateShellPosition calculates the new position of a shell based on physics
func (sp *ShellPhysics) UpdateShellPosition(shell *game.ShellState) bool {
	// Check if shell has expired
	lifetime := time.Now().UnixMilli() - shell.Timestamp
	if lifetime > sp.MAX_LIFETIME {
		// Shell expired
		log.Printf("🕒 SHELL EXPIRED: Shell %s age %dms exceeded max lifetime %dms",
			shell.ID, lifetime, sp.MAX_LIFETIME)
		return false
	}

	// Log the current shell state before update
	log.Printf("🚀 SHELL UPDATE: Shell %s at (%.2f,%.2f,%.2f) dir=(%.2f,%.2f,%.2f) speed=%.2f",
		shell.ID,
		shell.Position.X, shell.Position.Y, shell.Position.Z,
		shell.Direction.X, shell.Direction.Y, shell.Direction.Z,
		shell.Speed)

	// Convert direction to a velocity vector (normalize and multiply by speed)
	dirNorm := math.Sqrt(shell.Direction.X*shell.Direction.X +
		shell.Direction.Y*shell.Direction.Y +
		shell.Direction.Z*shell.Direction.Z)

	// Avoid division by zero
	if dirNorm == 0 {
		dirNorm = 1
		log.Printf("⚠️ WARNING: Shell %s has zero direction norm, correcting", shell.ID)
	}

	// Create velocity from direction and speed
	velX := shell.Direction.X / dirNorm * shell.Speed
	velY := shell.Direction.Y / dirNorm * shell.Speed
	velZ := shell.Direction.Z / dirNorm * shell.Speed

	// Apply gravity with more realistic effects (increases with velocity)
	// Gravity increases slightly with velocity for more realistic arcs
	velY -= sp.GRAVITY * (1 + math.Sqrt(velX*velX+velY*velY+velZ*velZ)*0.01)

	// Apply air resistance proportional to velocity squared (realistic drag)
	speedSquared := velX*velX + velY*velY + velZ*velZ
	dragFactor := -sp.AIR_RESISTANCE * speedSquared

	// Calculate normalized direction for drag
	if speedSquared > 0 {
		dragVelX := velX / math.Sqrt(speedSquared) * dragFactor
		dragVelY := velY / math.Sqrt(speedSquared) * dragFactor
		dragVelZ := velZ / math.Sqrt(speedSquared) * dragFactor

		// Apply drag to velocity
		velX += dragVelX
		velY += dragVelY
		velZ += dragVelZ
	}

	// Apply subtle wind effects
	velX += sp.WIND_X
	velZ += sp.WIND_Z

	// Update position based on velocity
	shell.Position.X += velX
	shell.Position.Y += velY
	shell.Position.Z += velZ

	// Update direction in shell state (normalized)
	totalVel := math.Sqrt(velX*velX + velY*velY + velZ*velZ)
	if totalVel > 0 {
		shell.Direction.X = velX / totalVel
		shell.Direction.Y = velY / totalVel
		shell.Direction.Z = velZ / totalVel
	}

	// Update speed
	shell.Speed = totalVel

	// Check if shell hit the ground (y <= 0)
	if shell.Position.Y <= 0 {
		shell.Position.Y = 0 // Clamp to ground
		log.Printf("💥 GROUND HIT: Shell %s hit ground at (%.2f,%.2f,%.2f)",
			shell.ID, shell.Position.X, 0.0, shell.Position.Z)
		return false // Shell hit the ground, remove it
	}

	// Log the updated position
	log.Printf("📍 SHELL MOVED: Shell %s now at (%.2f,%.2f,%.2f) speed=%.2f",
		shell.ID, shell.Position.X, shell.Position.Y, shell.Position.Z, shell.Speed)

	return true // Shell is still active
}

// DetailedCollisionCheck checks for detailed collision between a shell and a tank
// Returns if there was a collision and additional info for damage calculation
func (sp *ShellPhysics) DetailedCollisionCheck(shell game.ShellState, tank game.PlayerState) (bool, string, float64) {
	// Basic collision check
	dx := shell.Position.X - tank.Position.X
	dy := shell.Position.Y - tank.Position.Y
	dz := shell.Position.Z - tank.Position.Z

	// Calculate actual distance for logging
	distance := math.Sqrt(dx*dx + dy*dy + dz*dz)

	// Use squared distance for efficiency in collision check
	distanceSquared := dx*dx + dy*dy + dz*dz

	// Increased tank collision radius to match game scale
	tankRadius := 50.0

	// Calculate the squared sum of radii
	sumRadiiSquared := (sp.COLLISION_RADIUS + tankRadius) * (sp.COLLISION_RADIUS + tankRadius)
	sumRadii := sp.COLLISION_RADIUS + tankRadius

	// Log detailed position info for debugging regardless of collision
	log.Printf("🎯 VECTOR CHECK: Shell(%.2f,%.2f,%.2f) -> Tank %s(%.2f,%.2f,%.2f) = Distance: %.2f, Required: %.2f",
		shell.Position.X, shell.Position.Y, shell.Position.Z,
		tank.ID, tank.Position.X, tank.Position.Y, tank.Position.Z,
		distance, sumRadii)

	// Check for collision and log result
	hasCollision := distanceSquared < sumRadiiSquared

	// Log the collision decision with full details
	if hasCollision {
		log.Printf("✅ COLLISION DETECTED: Shell %s and Tank %s - Distance=%.2f (Required < %.2f)",
			shell.ID, tank.ID, distance, sumRadii)
	} else {
		log.Printf("❌ NO COLLISION: Shell %s and Tank %s - Distance=%.2f (Required < %.2f)",
			shell.ID, tank.ID, distance, sumRadii)

		// No collision
		return false, "", 0.0
	}

	// Determine hit location based on position relative to tank
	// Use simplified collision model for hit location determination

	// Normalize the hit position relative to tank center
	hitHeight := shell.Position.Y - tank.Position.Y

	// Default damage multiplier
	damageMultiplier := 1.0
	hitLocation := "body"

	// Simple hit location detection
	if hitHeight > 1.2 {
		// Hit the turret - critical hit
		hitLocation = "turret"
		damageMultiplier = 1.5
	} else if hitHeight < 0.5 {
		// Hit the tracks - reduced damage
		hitLocation = "tracks"
		damageMultiplier = 0.75
	} else {
		// Hit the body - normal damage
		hitLocation = "body"
		damageMultiplier = 1.0
	}

	// Log detailed collision info
	log.Printf("🎯 PHYSICS: Detailed collision - Shell vs Tank %s, hit on %s, damage multiplier: %.2f",
		tank.ID, hitLocation, damageMultiplier)

	return true, hitLocation, damageMultiplier
}
