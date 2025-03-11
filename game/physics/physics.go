package physics

import (
	"log"
	
	"github.com/mark3labs/pro-saaskit/game"
)

// PhysicsManagerInstance is the singleton instance of the physics manager
var PhysicsManagerInstance *PhysicsManager

// Initialize initializes the physics package
func Initialize() {
	log.Println("\n==================================================")
	log.Println("🚀 PHYSICS: Initializing physics system...")
	log.Println("==================================================\n")
	
	// Explicitly initialize the game map first to ensure it's populated
	gameMap := game.InitGameMap()
	
	// Verify the game map has data
	treeCount := len(gameMap.Trees.Trees)
	rockCount := len(gameMap.Rocks.Rocks)
	
	log.Printf("🌲 PHYSICS: Loaded %d trees from game map", treeCount)
	log.Printf("🪨 PHYSICS: Loaded %d rocks from game map", rockCount)
	
	if treeCount == 0 || rockCount == 0 {
		log.Println("⚠️ PHYSICS WARNING: Game map has missing environment data!")
	}
	
	// Create physics manager
	PhysicsManagerInstance = NewPhysicsManager(gameMap)
	
	log.Println("\n==================================================")
	log.Printf("✅ PHYSICS: System initialized with %d trees and %d rocks", treeCount, rockCount)
	log.Println("==================================================\n")
}

// GetPhysicsManager returns the physics manager instance
func GetPhysicsManager() *PhysicsManager {
	if PhysicsManagerInstance == nil {
		Initialize()
	}
	return PhysicsManagerInstance
}