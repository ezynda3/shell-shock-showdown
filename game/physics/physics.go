package physics

import (
	"github.com/charmbracelet/log"
	"github.com/mark3labs/pro-saaskit/game"
	"github.com/mark3labs/pro-saaskit/game/shared"
)

// PhysicsEngine is an interface that all physics managers must implement
type PhysicsEngine interface {
	RegisterTank(tank *game.PlayerState)
	UnregisterTank(tankID string)
	UpdateTank(tank *game.PlayerState)
	UpdateShells(shells []game.ShellState)
	Update()
	GetHits() []game.HitData
	CheckLineOfSight(fromPos, toPos shared.Position) bool
}

// PhysicsManagerInstance is the singleton instance of the physics manager
var PhysicsManagerInstance PhysicsEngine

// Initialize initializes the physics package
// DEPRECATED: Use NewPhysicsManager and NewPhysicsIntegration directly instead
func Initialize() {
	log.Info("Initializing physics system")

	// Explicitly initialize the game map first to ensure it's populated
	gameMap := game.InitGameMap()

	// Verify the game map has data
	treeCount := len(gameMap.Trees.Trees)
	rockCount := len(gameMap.Rocks.Rocks)

	log.Info("Game map loaded", "trees", treeCount, "rocks", rockCount)

	if treeCount == 0 || rockCount == 0 {
		log.Warn("Game map has missing environment data")
	}

	// NOTE: We don't create a physics manager here anymore
	// It should be created in main.go with the game manager
	log.Warn("Physics initialization using Initialize() is deprecated")

	log.Info("Map validation complete", "trees", treeCount, "rocks", rockCount)
}

// GetPhysicsManager returns the physics manager instance
func GetPhysicsManager() PhysicsEngine {
	if PhysicsManagerInstance == nil {
		// Just log a warning but don't initialize - this should be done in main.go
		log.Warn("Physics manager not initialized. Call Initialize() first or create it directly.")
	}
	return PhysicsManagerInstance
}