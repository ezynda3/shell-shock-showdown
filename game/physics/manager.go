package physics

import (
	"log"

	"github.com/mark3labs/pro-saaskit/game"
)

// PhysicsManager handles collision detection and physics calculations
type PhysicsManager struct {
	gameMap *game.GameMap
	tanks   map[string]*game.PlayerState
}

// NewPhysicsManager creates a new physics manager
func NewPhysicsManager(gameMap *game.GameMap) *PhysicsManager {
	return &PhysicsManager{
		gameMap: gameMap,
		tanks:   make(map[string]*game.PlayerState),
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
			if pm.checkCollision(tank.Position, 1.5, otherTank.Position, 1.5) {
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

// Update updates all registered tanks
func (pm *PhysicsManager) Update() {
	for _, tank := range pm.tanks {
		pm.UpdateTank(tank)
	}
}