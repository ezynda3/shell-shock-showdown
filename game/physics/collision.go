package physics

import (
	"github.com/mark3labs/pro-saaskit/game"
)

// ColliderType represents the type of collider
type ColliderType string

const (
	// ColliderTank is a tank collider
	ColliderTank ColliderType = "tank"
	// ColliderTree is a tree collider
	ColliderTree ColliderType = "tree"
	// ColliderRock is a rock collider
	ColliderRock ColliderType = "rock"
	// ColliderShell is a shell collider
	ColliderShell ColliderType = "shell"
)

// Collider represents a collision object
type Collider struct {
	Position game.Position
	Radius   float64
	Type     ColliderType
	ID       string // For identifying objects like specific tanks
}

// CheckCollision checks if two colliders are intersecting
func CheckCollision(a, b *Collider) bool {
	// Calculate distance between colliders
	dx := a.Position.X - b.Position.X
	dy := a.Position.Y - b.Position.Y
	dz := a.Position.Z - b.Position.Z
	distanceSquared := dx*dx + dy*dy + dz*dz

	// Check if distance is less than sum of radii
	sumRadii := a.Radius + b.Radius
	return distanceSquared < sumRadii*sumRadii
}

// GetTreeColliders creates colliders for all trees in the game map
func GetTreeColliders(gameMap *game.GameMap) []*Collider {
	colliders := make([]*Collider, 0, len(gameMap.Trees.Trees))

	for i, tree := range gameMap.Trees.Trees {
		colliders = append(colliders, &Collider{
			Position: tree.Position,
			Radius:   tree.Radius,
			Type:     ColliderTree,
			ID:       string(tree.Type) + "_" + string(rune(i)),
		})
	}

	return colliders
}

// GetRockColliders creates colliders for all rocks in the game map
func GetRockColliders(gameMap *game.GameMap) []*Collider {
	colliders := make([]*Collider, 0, len(gameMap.Rocks.Rocks))

	for i, rock := range gameMap.Rocks.Rocks {
		colliders = append(colliders, &Collider{
			Position: rock.Position,
			Radius:   rock.Radius,
			Type:     ColliderRock,
			ID:       string(rock.Type) + "_" + string(rune(i)),
		})
	}

	return colliders
}

// GetTankCollider creates a collider for a tank
func GetTankCollider(tank *game.PlayerState) *Collider {
	return &Collider{
		Position: tank.Position,
		Radius:   20.0, // Tank radius to match the 100x scale (client uses 2.0)
		Type:     ColliderTank,
		ID:       tank.ID,
	}
}
