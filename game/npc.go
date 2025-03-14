package game

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/log"
	"tank-game/game/shared"
	"github.com/nats-io/nats.go/jetstream"
)

// NPCController manages NPC tanks
type NPCController struct {
	manager        *Manager
	npcs           map[string]*NPCTank
	mutex          sync.RWMutex
	gameMap        *GameMap
	isRunning      bool
	quit           chan struct{}                  // Channel to signal shutdown
	physicsManager shared.PhysicsManagerInterface // Reference to physics manager for targeting
	watcher        jetstream.KeyWatcher           // KV watcher for game state changes
}

// Movement patterns
type MovementPattern string

const (
	CircleMovement MovementPattern = "circle"
	ZigzagMovement MovementPattern = "zigzag"
	PatrolMovement MovementPattern = "patrol"
	RandomMovement MovementPattern = "random"
)

// NPCTank represents an NPC tank
type NPCTank struct {
	ID              string
	Name            string
	State           PlayerState
	MovementPattern MovementPattern
	TargetID        string    // ID of player this NPC is targeting
	LastAttackerID  string    // ID of player who last attacked this NPC (for grudge tracking)
	LastAttackTime  time.Time // When the NPC was last attacked
	PatrolPoints    []Position
	CurrentPoint    int
	LastUpdate      time.Time
	LastFire        time.Time
	FireCooldown    time.Duration
	ScanRadius      float64
	IsActive        bool
	AimingAt        *shared.Position // Current position the NPC is aiming at (using shared.Position)
	CanSeeTarget    bool             // Whether NPC has line of sight to target
	TargetRotation  float64          // Target rotation for smooth turning (matches client behavior)
	MovingBackward  bool             // Whether the tank is currently moving backward

	// NPC personality traits (0.0 to 1.0 scale)
	FiringAccuracy float64 // How accurate this NPC's shots are (higher is more accurate)
	MoveSpeed      float64 // Movement speed multiplier (higher is faster)
	Aggressiveness float64 // How aggressively it pursues targets (higher is more aggressive)
	FireRate       float64 // How frequently it fires (higher means more frequent firing)
	TacticalIQ     float64 // How smart it is tactically (higher means smarter decisions)
	GrudgeFactor   float64 // How likely to pursue tanks that attack it (auto-generated from personality)

	// Visual traits
	TankColor   string // Color of the tank
	TurretStyle string // Style of the turret
}

// NewNPCController creates a new NPC controller
func NewNPCController(manager *Manager, gameMap *GameMap, physicsManager shared.PhysicsManagerInterface) *NPCController {
	return &NPCController{
		manager:        manager,
		npcs:           make(map[string]*NPCTank),
		mutex:          sync.RWMutex{},
		gameMap:        gameMap,
		isRunning:      false,
		quit:           make(chan struct{}),
		physicsManager: physicsManager,
	}
}

// Start begins the NPC simulation
func (c *NPCController) Start() {
	c.mutex.Lock()
	if c.isRunning {
		c.mutex.Unlock()
		return
	}
	c.isRunning = true
	c.mutex.Unlock()

	// Set up KV watcher for game state changes
	var err error
	ctx := context.Background()
	c.watcher, err = c.manager.WatchState(ctx)
	if err != nil {
		log.Error("Failed to create KV watcher for NPCs", "error", err)
		c.mutex.Lock()
		c.isRunning = false
		c.mutex.Unlock()
		return
	}

	// Start the main NPC simulation loop
	go c.runSimulation()

	log.Info("NPC Controller started with KV watcher")
}

// Stop halts the NPC simulation
func (c *NPCController) Stop() {
	c.mutex.Lock()
	defer c.mutex.Unlock()

	if !c.isRunning {
		return
	}

	// Close watcher if it exists
	if c.watcher != nil {
		c.watcher.Stop()
	}

	close(c.quit)
	c.isRunning = false
	log.Info("NPC Controller stopped")
}

// NPCPersonality defines a set of personality parameters for an NPC tank
type NPCPersonality struct {
	MoveSpeed      float64       // How fast the NPC moves (0.0-1.0)
	Accuracy       float64       // How accurate the NPC's shots are (0.0-1.0)
	Aggressiveness float64       // How aggressively it pursues targets (0.0-1.0)
	FireRate       float64       // How frequently it fires (0.0-1.0)
	TacticalIQ     float64       // How smart it is tactically (0.0-1.0)
	Cooldown       time.Duration // Base fire cooldown
}

// NPCColorScheme defines a color scheme for an NPC tank
type NPCColorScheme struct {
	PrimaryColor   string // Primary color (body)
	SecondaryColor string // Secondary color (turret)
	Style          string // Visual style identifier
}

// DefaultNPCColorSchemes provides predefined color schemes
var DefaultNPCColorSchemes = []NPCColorScheme{
	{PrimaryColor: "#4a7c59", SecondaryColor: "#386646", Style: "standard"},
	{PrimaryColor: "#f44336", SecondaryColor: "#d32f2f", Style: "aggressive"},
	{PrimaryColor: "#2196f3", SecondaryColor: "#1976d2", Style: "tactical"},
	{PrimaryColor: "#ff9800", SecondaryColor: "#f57c00", Style: "speedy"},
	{PrimaryColor: "#9c27b0", SecondaryColor: "#7b1fa2", Style: "stealth"},
	{PrimaryColor: "#607d8b", SecondaryColor: "#455a64", Style: "heavy"},
}

// GetRandomizedPersonality creates a random personality with optional bias parameters
func GetRandomizedPersonality(difficultyLevel float64) NPCPersonality {
	// difficultyLevel is 0.0-1.0, affects overall NPC effectiveness

	// Base randomness function that creates a normal distribution around a mean
	// Returns values primarily in the 0.0-1.0 range but can exceed it slightly
	randomNormal := func(mean, stdDev float64) float64 {
		// Box-Muller transform for normal distribution
		u1 := rand.Float64()
		u2 := rand.Float64()
		z := math.Sqrt(-2.0*math.Log(u1)) * math.Cos(2.0*math.Pi*u2)

		// Convert to desired mean and standard deviation
		return math.Max(0.0, math.Min(1.0, mean+z*stdDev))
	}

	// Create personality with scaled difficulty
	personality := NPCPersonality{
		// At higher difficulty, NPCs tend to be more accurate
		Accuracy: randomNormal(0.3+difficultyLevel*0.4, 0.2),

		// Speed must match player tank's base speed of 0.2 from tank.ts, with only subtle variations
		MoveSpeed: math.Min(0.25, randomNormal(0.2, 0.05)),

		// Aggressiveness increases with difficulty
		Aggressiveness: randomNormal(0.3+difficultyLevel*0.4, 0.25),

		// Fire rate (frequency) increases with difficulty
		FireRate: randomNormal(0.3+difficultyLevel*0.5, 0.2),

		// Tactical intelligence increases with difficulty
		TacticalIQ: randomNormal(0.2+difficultyLevel*0.6, 0.2),
	}

	// Calculate cooldown from fire rate: higher fire rate = lower cooldown
	// Modified base range: 1.5 second (max fire rate) to 5 seconds (min fire rate)
	// This ensures NPCs can't fire too rapidly
	baseCooldown := 5.0 - (personality.FireRate * 3.5)

	// Add some randomness to cooldown
	cooldownWithJitter := baseCooldown + (rand.Float64() - 0.5)

	// Enforce minimum cooldown of 1.5 seconds to prevent rapid firing
	minCooldown := 1.5
	personality.Cooldown = time.Duration(math.Max(minCooldown, cooldownWithJitter) * float64(time.Second))

	return personality
}

// Adjectives and Verbs for NPC name generation
var npcAdjectives = []string{"Sneaky", "Rusty", "Furious", "Clever", "Angry", "Brave", "Cunning", "Drunken", "Silent", "Swift", "Calm", "Mighty", "Savage", "Stealth", "Chaotic", "Precise", "Nimble", "Tactical", "Hulking", "Deadly", "Raging", "Fearless", "Relentless", "Vengeful"}

var npcVerbs = []string{"Tiger", "Dragon", "Hawk", "Fox", "Panther", "Wolf", "Eagle", "Lion", "Viper", "Shark", "Hunter", "Cobra", "Rhino", "Bear", "Falcon", "Scorpion", "Mantis", "Jaguar", "Sentinel", "Stalker", "Crusher", "Phantom", "Assassin", "Guardian"}

// generateNPCName generates a name in the format "Adjective Verb"
func generateNPCName() string {
	adjective := npcAdjectives[rand.Intn(len(npcAdjectives))]
	verb := npcVerbs[rand.Intn(len(npcVerbs))]
	return adjective + " " + verb
}

// SpawnNPC creates a new NPC tank with randomized characteristics
func (c *NPCController) SpawnNPC(name string, movementPattern MovementPattern) *NPCTank {
	// Generate a proper NPC name in the "Adjective Verb" format
	npcName := generateNPCName()
	return c.SpawnCustomNPC(npcName, movementPattern, 0.5) // Default medium difficulty
}

// SpawnCustomNPC creates a new NPC tank with specified difficulty level
func (c *NPCController) SpawnCustomNPC(name string, movementPattern MovementPattern, difficultyLevel float64) *NPCTank {
	c.mutex.Lock()
	defer c.mutex.Unlock()

	// Generate an NPC ID without NPC prefix but still distinguishable from players
	npcID := fmt.Sprintf("bot_%d", time.Now().UnixNano())

	// Bias NPC spawning toward center, within 1000 unit radius
	// Use polar coordinates to ensure even distribution within circle
	radius := rand.Float64() * 1000.0     // Random radius up to 1000 units
	angle := rand.Float64() * 2 * math.Pi // Random angle 0-2π

	// Convert polar to cartesian coordinates
	offsetX := math.Cos(angle) * radius
	offsetZ := math.Sin(angle) * radius

	// Select a random color scheme
	colorScheme := DefaultNPCColorSchemes[rand.Intn(len(DefaultNPCColorSchemes))]

	// Create initial state - use the name directly without NPC prefix
	state := PlayerState{
		ID:             npcID,
		Name:           name, // Use clean name format without NPC prefix
		Position:       Position{X: offsetX, Y: 0, Z: offsetZ},
		TankRotation:   rand.Float64() * 2 * math.Pi,
		TurretRotation: rand.Float64() * 2 * math.Pi,
		Health:         100,
		IsMoving:       true, // Start moving immediately
		Velocity:       0.2,  // Match player tank speed from tank.ts
		Timestamp:      time.Now().UnixMilli(),
		Color:          colorScheme.PrimaryColor, // Use color from scheme
		IsDestroyed:    false,
	}

	// Create patrol points if using patrol pattern
	var patrolPoints []Position
	if movementPattern == PatrolMovement {
		// Calculate distance from center
		distFromCenter := math.Sqrt(offsetX*offsetX + offsetZ*offsetZ)

		// For spawns very far from center, make one patrol point near center
		if distFromCenter > 1000 {
			// Calculate angle toward center
			centerAngle := math.Atan2(-offsetZ, -offsetX)

			// Create patrol points with one near center and others around spawn
			size := 100.0 + rand.Float64()*200.0

			// Calculate a point that's closer to the center
			moveTowardCenterDist := distFromCenter * 0.6 // Move 60% toward center
			centerX := offsetX + math.Cos(centerAngle)*moveTowardCenterDist
			centerZ := offsetZ + math.Sin(centerAngle)*moveTowardCenterDist

			patrolPoints = []Position{
				{X: offsetX + size, Y: 0, Z: offsetZ + size},
				{X: centerX, Y: 0, Z: centerZ}, // This point is closer to center
				{X: offsetX - size, Y: 0, Z: offsetZ - size},
				{X: offsetX - size, Y: 0, Z: offsetZ + size},
			}
		} else {
			// Regular patrol route for tanks already near center
			size := 100.0 + rand.Float64()*200.0
			patrolPoints = []Position{
				{X: offsetX + size, Y: 0, Z: offsetZ + size},
				{X: offsetX + size, Y: 0, Z: offsetZ - size},
				{X: offsetX - size, Y: 0, Z: offsetZ - size},
				{X: offsetX - size, Y: 0, Z: offsetZ + size},
			}
		}
	}

	// Generate randomized personality based on difficulty level
	personality := GetRandomizedPersonality(difficultyLevel)

	// Log the NPC's personality traits
	log.Info("Bot personality",
		"name", name,
		"accuracy", personality.Accuracy,
		"moveSpeed", personality.MoveSpeed,
		"aggressiveness", personality.Aggressiveness,
		"fireRate", personality.FireRate,
		"tacticalIQ", personality.TacticalIQ,
		"cooldown", personality.Cooldown)

	// Calculate grudge factor - how likely to remember and pursue attackers
	// Based on aggressiveness and tactical IQ
	grudgeFactor := personality.Aggressiveness*0.7 + personality.TacticalIQ*0.3

	npc := &NPCTank{
		ID:              npcID,
		Name:            name,
		State:           state,
		MovementPattern: movementPattern,
		PatrolPoints:    patrolPoints,
		CurrentPoint:    0,
		LastUpdate:      time.Now(),
		LastFire:        time.Now(),
		LastAttackerID:  "",          // No attacker initially
		LastAttackTime:  time.Time{}, // Zero time
		FireCooldown:    personality.Cooldown,
		ScanRadius:      500.0 + (personality.Aggressiveness * 250.0), // More aggressive = larger scan radius - increased for larger map
		IsActive:        true,
		AimingAt:        nil, // No target initially
		CanSeeTarget:    false,
		MovingBackward:  false, // Start moving forward

		// Personality traits
		FiringAccuracy: personality.Accuracy,
		MoveSpeed:      personality.MoveSpeed,
		Aggressiveness: personality.Aggressiveness,
		FireRate:       personality.FireRate,
		TacticalIQ:     personality.TacticalIQ,
		GrudgeFactor:   grudgeFactor,

		// Visual traits
		TankColor:   colorScheme.PrimaryColor,
		TurretStyle: colorScheme.Style,
	}

	// Add to NPC map
	c.npcs[npcID] = npc

	// Register with game manager
	if err := c.manager.UpdatePlayer(state, npcID, name); err != nil {
		log.Error("Error registering bot tank", "error", err)
	}

	log.Info("Spawned bot tank",
		"name", npc.Name,
		"id", npcID,
		"posX", offsetX,
		"posZ", offsetZ,
		"posY", 0.0)

	return npc
}

// runSimulation is the main NPC simulation loop
func (c *NPCController) runSimulation() {
	// Create a fallback ticker that runs occasionally to ensure NPCs stay responsive
	// even if KV updates are infrequent
	fallbackTicker := time.NewTicker(1 * time.Second)
	defer fallbackTicker.Stop()

	// Process state updates using KV watcher
	updates := c.watcher.Updates()
	lastProcessed := time.Now()

	// Only update NPCs if they have real targets or it's been a while
	minUpdateInterval := 100 * time.Millisecond

	for {
		select {
		case <-c.quit:
			return
		case update := <-updates:
			// Process KV update
			if update.Operation() != jetstream.KeyValueDelete { // Skip delete operations
				var gameState GameState
				if err := json.Unmarshal(update.Value(), &gameState); err != nil {
					log.Error("Error unmarshaling game state from KV", "error", err)
					continue
				}

				// Only process updates at a reasonable rate
				if time.Since(lastProcessed) > minUpdateInterval {
					c.processGameState(gameState)
					lastProcessed = time.Now()
				}
			}
		case <-fallbackTicker.C:
			// Fallback update in case KV updates are infrequent
			// This ensures NPCs keep moving even if no state changes happen
			gameState := c.manager.GetState()
			c.processGameState(gameState)
		}
	}
}

// processGameState updates NPCs based on current game state
func (c *NPCController) processGameState(gameState GameState) {
	// Process each NPC
	c.mutex.Lock()
	defer c.mutex.Unlock()

	for _, npc := range c.npcs {
		if !npc.IsActive {
			continue
		}

		// Check if the NPC's state has been updated by the server
		serverState, exists := gameState.Players[npc.ID]
		if exists {
			// Update local state with server state
			log.Debug("Updating NPC from server state",
				"id", npc.ID,
				"health", serverState.Health,
				"posX", serverState.Position.X,
				"posY", serverState.Position.Y,
				"posZ", serverState.Position.Z,
				"destroyed", serverState.IsDestroyed)

			// Check for health reduction since last update (we've been hit!)
			if serverState.Health < npc.State.Health && !serverState.IsDestroyed {
				// Determine who might have attacked us
				// Look for shells (which are tracked in game state)
				var mostLikelyAttacker string
				var closestShellDist float64 = 50.0 // Maximum distance to consider

				// Scan for recent shells that might have hit us
				for _, shell := range gameState.Shells {
					// Skip shells fired by this NPC
					if shell.PlayerID == npc.ID {
						continue
					}

					// Calculate distance from shell to this NPC
					dx := shell.Position.X - serverState.Position.X
					dz := shell.Position.Z - serverState.Position.Z
					shellDist := math.Sqrt(dx*dx + dz*dz)

					// If shell is close enough, consider it a potential hit
					if shellDist < closestShellDist {
						closestShellDist = shellDist
						mostLikelyAttacker = shell.PlayerID
					}
				}

				// If we identified an attacker, remember them
				if mostLikelyAttacker != "" {
					// This player attacked us! Hold a grudge
					npc.LastAttackerID = mostLikelyAttacker
					npc.LastAttackTime = time.Now()

					log.Info("NPC was attacked!",
						"id", npc.ID,
						"attackerId", mostLikelyAttacker,
						"oldHealth", npc.State.Health,
						"newHealth", serverState.Health)
				}
			}

			// Check if this is a respawn (destroyed -> not destroyed transition)
			isRespawn := npc.State.IsDestroyed && !serverState.IsDestroyed

			// Update health and destroyed status from server
			npc.State.Health = serverState.Health
			npc.State.IsDestroyed = serverState.IsDestroyed

			// Handle respawn: always take server position and reset movement
			if isRespawn {
				log.Info("NPC respawned by server",
					"id", npc.ID,
					"posX", serverState.Position.X,
					"posY", serverState.Position.Y,
					"posZ", serverState.Position.Z)

				// First, take the server's position on respawn
				npc.State.Position = serverState.Position

				// Check if respawn position is outside the desired 1000 unit center radius
				distFromCenter := math.Sqrt(
					npc.State.Position.X*npc.State.Position.X +
						npc.State.Position.Z*npc.State.Position.Z)

				// If respawned outside our desired 1000 unit radius, override with centered position
				if distFromCenter > 1000.0 {
					// Generate a position within 1000 unit radius of center
					radius := rand.Float64() * 1000.0     // Random radius up to 1000 units
					angle := rand.Float64() * 2 * math.Pi // Random angle 0-2π

					// Override server position to keep NPC in center area
					npc.State.Position.X = math.Cos(angle) * radius
					npc.State.Position.Z = math.Sin(angle) * radius

					log.Info("Overriding NPC respawn position to stay within center radius",
						"id", npc.ID,
						"serverDist", distFromCenter,
						"newX", npc.State.Position.X,
						"newZ", npc.State.Position.Z)
				}
				// Reset movement state to prevent erratic movement
				npc.State.IsMoving = false
				npc.State.Velocity = 0.0
				npc.MovingBackward = false

				// Randomize tank rotation on respawn to avoid all NPCs facing same direction
				npc.State.TankRotation = rand.Float64() * 2 * math.Pi
				npc.State.TurretRotation = npc.State.TankRotation

				// Reset grudges on respawn
				npc.LastAttackerID = ""
				npc.LastAttackTime = time.Time{}
			} else {
				// For normal updates: Only update position if significant movement happened on server side
				dx := npc.State.Position.X - serverState.Position.X
				dz := npc.State.Position.Z - serverState.Position.Z
				dist := math.Sqrt(dx*dx + dz*dz)
				if dist > 5.0 {
					log.Debug("NPC position corrected by server",
						"id", npc.ID,
						"oldX", npc.State.Position.X,
						"oldZ", npc.State.Position.Z,
						"newX", serverState.Position.X,
						"newZ", serverState.Position.Z)
					npc.State.Position = serverState.Position
				}
			}
		} else {
			log.Info("NPC not found in server state, re-registering", "id", npc.ID)
			// Re-register the NPC with the game manager
			c.mutex.Unlock()
			if err := c.manager.UpdatePlayer(npc.State, npc.ID, npc.Name); err != nil {
				log.Error("Error re-registering NPC", "id", npc.ID, "error", err)
			}
			c.mutex.Lock()
		}

		// Skip if destroyed, just wait for game manager to respawn us
		if npc.State.IsDestroyed {
			// Reset movement properties while dead to prevent erratic movement on respawn
			npc.State.IsMoving = false
			npc.State.Velocity = 0.0

			// Log status occasionally but not too frequently
			if time.Since(npc.LastUpdate) > 1*time.Second {
				log.Debug("NPC is destroyed, waiting for manager respawn", "id", npc.ID)
				npc.LastUpdate = time.Now()
			}
			continue
		}

		// Force movement for stationary NPCs
		if time.Since(npc.LastUpdate) > 3*time.Second && !npc.State.IsMoving {
			log.Info("NPC has been stationary for too long, forcing movement",
				"id", npc.ID)
			npc.State.IsMoving = true
			npc.State.Velocity = 0.5 + rand.Float64()*0.5

			// Random new direction
			npc.State.TankRotation = rand.Float64() * 2 * math.Pi
		}

		// Update NPC AI
		c.updateNPCAI(npc, gameState)

		// Save last update time
		npc.LastUpdate = time.Now()
	}
}

// updateNPCAI handles movement and firing for an NPC
func (c *NPCController) updateNPCAI(npc *NPCTank, gameState GameState) {
	// Make a copy of the state to modify
	state := npc.State

	// Look for nearby players to target - affected by aggressiveness
	c.findTarget(npc, gameState)

	// Decide whether to pursue target or follow movement pattern
	// Higher TacticalIQ NPCs make smarter decisions about when to pursue vs patrol
	if npc.TargetID != "" {
		// Calculate pursuit likelihood based on multiple factors
		pursuitLikelihood := npc.Aggressiveness

		// If this is a player who attacked us, we're more likely to pursue them (hold a grudge)
		if npc.LastAttackerID == npc.TargetID && !npc.LastAttackTime.IsZero() {
			timeSinceAttack := time.Since(npc.LastAttackTime)
			if timeSinceAttack < 30*time.Second { // Grudge lasts 30 seconds
				// Increase pursuit likelihood based on grudge factor and recency
				grudgeBoost := npc.GrudgeFactor * (1.0 - (float64(timeSinceAttack) / float64(30*time.Second)))
				pursuitLikelihood += grudgeBoost * 0.5 // Significant boost to pursuit likelihood

				// Log grudge pursuit occasionally
				if rand.Float64() < 0.02 {
					log.Info("NPC pursuing attacker based on grudge",
						"id", npc.ID,
						"attackerId", npc.LastAttackerID,
						"timeSinceAttack", timeSinceAttack.Seconds(),
						"pursuitBoost", grudgeBoost)
				}
			}
		}

		// Pursue based on calculated likelihood
		if pursuitLikelihood > 0.6 && (npc.TacticalIQ < 0.7 || rand.Float64() < pursuitLikelihood) {
			// Pursue target if aggressive enough or holding a grudge
			c.pursueTarget(npc, &state, gameState)
		} else {
			// Otherwise follow normal movement pattern
			c.updateMovement(npc, &state)
		}
	} else {
		// No target, follow normal movement pattern
		c.updateMovement(npc, &state)
	}

	// Update aiming and firing - accuracy affected by FiringAccuracy trait
	c.updateAimingAndFiring(npc, &state, gameState)

	// Set timestamp for this update
	state.Timestamp = time.Now().UnixMilli()

	// Update the state in game manager - note that our caller (processGameState) holds the mutex
	// We need to temporarily release it while calling the manager
	c.mutex.Unlock() // Unlock before calling manager
	if err := c.manager.UpdatePlayer(state, npc.ID, npc.Name); err != nil {
		log.Error("Error updating NPC state", "id", npc.ID, "error", err)
	}
	c.mutex.Lock() // Lock again to continue processing

	// Update local state
	npc.State = state
}

// pursueTarget makes the NPC actively pursue its current target
func (c *NPCController) pursueTarget(npc *NPCTank, state *PlayerState, gameState GameState) {
	// Only pursue if we have a valid target
	if npc.TargetID == "" {
		return
	}

	// Get target position
	targetPlayer, exists := gameState.Players[npc.TargetID]
	if !exists || targetPlayer.IsDestroyed {
		// Target no longer exists or is destroyed
		npc.TargetID = ""
		return
	}

	targetPos := targetPlayer.Position

	// Calculate distance to target
	dx := targetPos.X - state.Position.X
	dz := targetPos.Z - state.Position.Z
	distToTarget := math.Sqrt(dx*dx + dz*dz)

	// Determine ideal distance based on tactical IQ
	// Smarter NPCs maintain better combat distance
	idealDistance := 100.0 + npc.TacticalIQ*50.0

	// Calculate angle to target
	targetAngle := math.Atan2(dz, dx)

	// If we're too close, move away while still facing target
	if distToTarget < idealDistance*0.7 && npc.TacticalIQ > 0.4 {
		// Need to back up - tanks can only move forward or backward along their facing direction
		// So we face the target but move backward
		state.TankRotation = targetAngle // Face the target
		npc.MovingBackward = true        // Move backward

		// Set negative velocity for proper movement calculation
		state.Velocity = -math.Abs(state.Velocity)
	} else if distToTarget > idealDistance*1.3 {
		// If we're too far, move towards target
		state.TankRotation = targetAngle // Face the target
		npc.MovingBackward = false       // Move forward

		// Use positive velocity
		state.Velocity = math.Abs(state.Velocity)
	} else {
		// At good distance, use realistic tank maneuvers
		// Smarter tanks use flanking tactics when possible
		if npc.TacticalIQ > 0.7 {
			// Attempt to get to the side of target for flank shot
			// This is realistic tank positioning - flanking for side armor hits
			circleOffset := math.Pi / 3 // 60 degree offset for flanking
			if rand.Float64() < 0.5 {
				circleOffset = -math.Pi / 3 // Random direction
			}

			// Face in flanking direction
			state.TankRotation = normalizeAngle(targetAngle + circleOffset)
			npc.MovingBackward = false // Move forward in flanking direction
			state.Velocity = math.Abs(state.Velocity)
		} else {
			// Less tactical tanks just face target directly
			state.TankRotation = targetAngle

			// Occasionally reverse direction to be less predictable
			if rand.Float64() < 0.03 {
				npc.MovingBackward = !npc.MovingBackward
				if npc.MovingBackward {
					state.Velocity = -math.Abs(state.Velocity)
				} else {
					state.Velocity = math.Abs(state.Velocity)
				}
			}
		}
	}

	// Adjust speed based on situation - with player-matching speed
	state.IsMoving = true
	baseSpeed := 0.2 // Match player tank speed from tank.ts

	// Tactical adjustments to speed - with smoother transitions
	if distToTarget < idealDistance*0.5 {
		// If very close, move faster to get away, but not too fast
		speed := baseSpeed * npc.MoveSpeed * 1.2
		// If backing up, use negative velocity
		if npc.MovingBackward {
			state.Velocity = -speed
		} else {
			state.Velocity = speed
		}
	} else if math.Abs(distToTarget-idealDistance) < 20.0 {
		// If at good combat distance, slow down for better aiming
		speed := baseSpeed * npc.MoveSpeed * 0.6
		// If backing up, use negative velocity
		if npc.MovingBackward {
			state.Velocity = -speed
		} else {
			state.Velocity = speed
		}
	} else {
		// Normal pursuit speed
		speed := baseSpeed * npc.MoveSpeed
		// If backing up, use negative velocity
		if npc.MovingBackward {
			state.Velocity = -speed
		} else {
			state.Velocity = speed
		}
	}

	// Advanced tanks occasionally use stop-and-shoot tactics - adjusted for 60fps update rate
	if npc.TacticalIQ > 0.8 && rand.Float64() < 0.017 { // Reduced from 10% to ~1.7% for 60fps (10% ÷ 6)
		// Temporarily stop to take a more accurate shot
		state.IsMoving = false
		state.Velocity = 0.0
	}

	// Actually update position
	moveX := math.Cos(state.TankRotation) * state.Velocity
	moveZ := math.Sin(state.TankRotation) * state.Velocity
	state.Position.X += moveX
	state.Position.Z += moveZ

	// Log pursuit behavior occasionally
	if rand.Float64() < 0.01 {
		log.Debug("NPC pursuing target",
			"id", npc.ID,
			"targetId", npc.TargetID,
			"distance", distToTarget,
			"idealDistance", idealDistance,
			"moving", state.IsMoving)
	}
}

// findTarget looks for the best player to target, prioritizing recent attackers
func (c *NPCController) findTarget(npc *NPCTank, gameState GameState) {
	var bestTargetID string
	var bestTargetScore float64 = -1.0
	var bestTargetDist float64 = npc.ScanRadius + 1.0 // Initialize larger than scan radius

	// Check if we have line of sight to potential targets
	hasLineOfSight := map[string]bool{}

	// Find best target considering multiple factors
	for playerID, player := range gameState.Players {
		// Skip self, other NPCs, and destroyed tanks
		if playerID == npc.ID || strings.HasPrefix(playerID, "bot_") || player.IsDestroyed {
			continue
		}

		// Calculate distance
		dx := player.Position.X - npc.State.Position.X
		dz := player.Position.Z - npc.State.Position.Z
		dist := math.Sqrt(dx*dx + dz*dz)

		// Skip if outside scan radius
		if dist > npc.ScanRadius {
			continue
		}

		// Check line of sight if we have physics manager
		canSee := true
		if c.physicsManager != nil {
			fromPos := shared.Position{X: npc.State.Position.X, Y: npc.State.Position.Y + 1.2, Z: npc.State.Position.Z}
			toPos := shared.Position{X: player.Position.X, Y: player.Position.Y, Z: player.Position.Z}
			canSee = c.physicsManager.CheckLineOfSight(fromPos, toPos)
			hasLineOfSight[playerID] = canSee
		}

		// Base score on distance (closer is better)
		distanceScore := 1.0 - (dist / npc.ScanRadius)

		// If this player recently attacked us, greatly increase score (tank holds a grudge)
		recentAttackerBonus := 0.0
		if playerID == npc.LastAttackerID && !npc.LastAttackTime.IsZero() {
			timeSinceAttack := time.Since(npc.LastAttackTime)
			if timeSinceAttack < 30*time.Second { // Grudge lasts 30 seconds
				// Higher grudge bonus the more recent the attack
				recentFactor := 1.0 - (float64(timeSinceAttack) / float64(30*time.Second))
				recentAttackerBonus = 2.0 * recentFactor * npc.GrudgeFactor

				// Log grudge targeting
				if rand.Float64() < 0.1 {
					log.Debug("NPC holding grudge against attacker",
						"id", npc.ID,
						"attackerId", playerID,
						"timeSince", timeSinceAttack.Seconds(),
						"bonus", recentAttackerBonus)
				}
			}
		}

		// Lower-health targets are better targets for tactical NPCs
		healthScore := 0.0
		if npc.TacticalIQ > 0.5 && player.Health < 100 {
			healthScore = (100.0 - float64(player.Health)) / 100.0 * npc.TacticalIQ * 0.5
		}

		// Line of sight bonus - heavily prioritize targets we can actually see
		lineOfSightMultiplier := 1.0
		if !canSee {
			// Can't see target, greatly reduce score unless tactical IQ is very low
			lineOfSightMultiplier = 0.2 + (0.3 * (1.0 - npc.TacticalIQ))
		}

		// Calculate final score combining all factors
		totalScore := (distanceScore + healthScore + recentAttackerBonus) * lineOfSightMultiplier

		// Current target persistence bonus to avoid frequent switching
		if playerID == npc.TargetID && npc.TacticalIQ > 0.4 {
			// Add bonus to current target to reduce erratic switching
			totalScore *= 1.2
		}

		// Check if this is our best target so far
		if totalScore > bestTargetScore {
			bestTargetScore = totalScore
			bestTargetID = playerID
			bestTargetDist = dist
		}
	}

	// Update target if we found one within range
	if bestTargetID != "" {
		// If changing targets, log the change
		if bestTargetID != npc.TargetID {
			log.Debug("NPC changing target",
				"id", npc.ID,
				"oldTarget", npc.TargetID,
				"newTarget", bestTargetID,
				"distance", bestTargetDist,
				"canSee", hasLineOfSight[bestTargetID])
		}
		npc.TargetID = bestTargetID
	} else {
		// No valid target found
		npc.TargetID = ""
	}
}

// updateMovement handles NPC movement patterns
func (c *NPCController) updateMovement(npc *NPCTank, state *PlayerState) {
	switch npc.MovementPattern {
	case CircleMovement:
		c.moveInCircle(npc, state)
	case ZigzagMovement:
		c.moveInZigzag(npc, state)
	case PatrolMovement:
		c.moveInPatrol(npc, state)
	case RandomMovement:
		c.moveRandomly(npc, state)
	}
}

// moveInCircle makes the NPC move in a circular pattern
func (c *NPCController) moveInCircle(npc *NPCTank, state *PlayerState) {
	// Apply NPC's specific movement speed - match player tank speed from tank.ts
	baseSpeed := 0.2                   // Base speed value (exactly matching player tank's tankSpeed in NPCTank class)
	speed := baseSpeed * npc.MoveSpeed // Apply NPC-specific multiplier

	// Get current time for time-based oscillations (like client-side)
	now := float64(time.Now().UnixNano()) / 1e9

	// Calculate distance from center for center-gravity effect
	distFromCenter := math.Sqrt(state.Position.X*state.Position.X + state.Position.Z*state.Position.Z)

	// Create a center gravity effect that increases with distance
	centerBias := 0.0
	if distFromCenter > 1000 { // Begin center bias at 1000 units from center
		// Exponentially increases with distance
		centerBias = math.Min(0.85, (distFromCenter-1000)/2500)
	}

	// Check if we need to override circular pattern and move toward center
	if centerBias > 0.3 && rand.Float64() < centerBias*0.4 { // Higher chance the further away
		// Calculate angle toward center
		centerAngle := math.Atan2(-state.Position.Z, -state.Position.X)

		// Turn toward center with smooth interpolation
		angleDiff := normalizeAngle(centerAngle - state.TankRotation)
		turnRate := 0.02 + (centerBias * 0.03) // Faster turning when far from center

		rotationAmount := math.Copysign(
			math.Min(math.Abs(angleDiff), turnRate),
			angleDiff,
		)

		// Apply rotation with tiny wobble for natural movement
		wobble := (rand.Float64() - 0.5) * 0.002
		state.TankRotation += rotationAmount + wobble
		state.TankRotation = normalizeAngle(state.TankRotation)

		// Move faster when far from center
		speedBoost := 1.0 + (centerBias * 0.7) // Up to 70% speed boost
		state.Velocity = speed * speedBoost

		// Log center movement
		if rand.Float64() < 0.05 {
			log.Debug("Circle NPC gravitating toward center",
				"id", npc.ID,
				"distance", distFromCenter,
				"centerBias", centerBias,
				"boostedSpeed", state.Velocity)
		}
	} else {
		// Normal circular movement with slight center bias
		// Use sine wave for more natural turning like client-side tank movement
		// Add time-based oscillation for more natural motion
		turnMultiplier := 0.5 + (math.Sin(now*0.3) * 0.5) // Oscillate between 0.0 and 1.0

		// For distant NPCs, gradually bias the turning direction toward center
		if centerBias > 0 {
			// Calculate angle toward center
			centerAngle := math.Atan2(-state.Position.Z, -state.Position.X)

			// Calculate angle difference to determine if we're turning toward or away from center
			angleDiff := normalizeAngle(centerAngle - state.TankRotation)

			// If the turn would move us away from center, reduce turn amount
			// If the turn would move us toward center, increase turn amount
			turnBiasMultiplier := 1.0
			if math.Abs(angleDiff) < math.Pi/2 {
				// We're generally facing toward center, increase turning slightly
				turnBiasMultiplier = 1.0 - (centerBias * 0.4) // Reduce turning up to 40%
			} else {
				// We're generally facing away from center, decrease turning
				turnBiasMultiplier = 1.0 + (centerBias * 0.6) // Increase turning up to 60%
			}

			turnMultiplier *= turnBiasMultiplier
		}

		// Smoother, more gradual turning with time-based variation
		turnAmount := 0.001 * speed * turnMultiplier // For smoother 60fps motion
		state.TankRotation += turnAmount

		// Normalize angle
		state.TankRotation = normalizeAngle(state.TankRotation)

		// Add slight speed variation for more natural movement (like client)
		speedVariation := 1.0 + (math.Sin(now*0.2) * 0.1) // ±10% speed variation

		// Apply small speed boost if far from center
		centerSpeedBoost := 1.0 + (centerBias * 0.3) // Up to 30% boost
		state.Velocity = speed * speedVariation * centerSpeedBoost
	}

	// Always be moving
	state.IsMoving = true

	// IMPORTANT: Actually update the position based on rotation and velocity
	// Calculate movement vector based on tank rotation
	moveX := math.Cos(state.TankRotation) * state.Velocity
	moveZ := math.Sin(state.TankRotation) * state.Velocity

	// Update position by applying movement vector
	state.Position.X += moveX
	state.Position.Z += moveZ

	// Update track animation (for client visualization) - add small oscillation
	// The client uses this value to animate tracks and wheels
	state.TrackRotation = state.Velocity * 5.0

	// Log movement occasionally to reduce log spam
	if rand.Float64() < 0.01 {
		log.Debug("NPC tank moving in circle",
			"id", npc.ID,
			"posX", state.Position.X,
			"posZ", state.Position.Z,
			"rotation", state.TankRotation,
			"velocity", state.Velocity,
			"distFromCenter", distFromCenter,
			"centerBias", centerBias)
	}
}

// moveInZigzag makes the NPC move in a zigzag pattern
func (c *NPCController) moveInZigzag(npc *NPCTank, state *PlayerState) {
	// Get current time for oscillation - matches client-side time-based animation
	now := float64(time.Now().UnixNano()) / 1e9

	// Calculate distance from center for center-gravity effect
	distFromCenter := math.Sqrt(state.Position.X*state.Position.X + state.Position.Z*state.Position.Z)

	// Create a center gravity effect that increases with distance
	centerBias := 0.0
	if distFromCenter > 800 { // Lower threshold for zigzag pattern
		// Exponentially increases with distance
		centerBias = math.Min(0.9, (distFromCenter-800)/2200)
	}

	// Check if we need to override zigzag pattern and move toward center
	if centerBias > 0.25 && rand.Float64() < centerBias*0.5 { // Higher chance the further away
		// Calculate angle toward center
		centerAngle := math.Atan2(-state.Position.Z, -state.Position.X)

		// Turn toward center with smooth interpolation
		angleDiff := normalizeAngle(centerAngle - state.TankRotation)
		turnRate := 0.025 + (centerBias * 0.035) // Faster turning when far from center

		rotationAmount := math.Copysign(
			math.Min(math.Abs(angleDiff), turnRate),
			angleDiff,
		)

		// Apply rotation with tiny wobble for natural movement
		wobble := (rand.Float64() - 0.5) * 0.003
		state.TankRotation += rotationAmount + wobble
		state.TankRotation = normalizeAngle(state.TankRotation)

		// Move faster when far from center
		baseSpeed := 0.2                       // Base speed value (matching player tank speed)
		speedBoost := 1.0 + (centerBias * 0.8) // Up to 80% speed boost
		state.Velocity = baseSpeed * npc.MoveSpeed * speedBoost

		// Log center movement
		if rand.Float64() < 0.05 {
			log.Debug("Zigzag NPC gravitating toward center",
				"id", npc.ID,
				"distance", distFromCenter,
				"centerBias", centerBias,
				"boostedSpeed", state.Velocity)
		}
	} else {
		// Normal zigzag movement but biased toward center when far away

		// Calculate zigzag pattern with more natural motion like client-side
		// Use sine wave with variable amplitude based on tactical IQ
		oscillationFrequency := 0.2 + (npc.TacticalIQ * 0.3)      // Higher IQ = faster zigzag
		oscillationAmplitude := 0.02 * (1.0 - npc.TacticalIQ*0.5) // Higher IQ = more controlled zigzag

		// For distant NPCs, gradually bias the zigzag direction toward center
		if centerBias > 0 {
			// Calculate angle toward center
			centerAngle := math.Atan2(-state.Position.Z, -state.Position.X)

			// Calculate angle difference to determine if we're heading toward or away from center
			angleDiff := normalizeAngle(centerAngle - state.TankRotation)

			// Add subtle correction to zigzag that increases with distance from center
			centerCorrection := angleDiff * centerBias * 0.006

			// Apply the center correction to the tank's rotation
			state.TankRotation += centerCorrection
		}

		// Create more dynamic and natural zigzag pattern using time
		oscillation := math.Sin(now*oscillationFrequency) * oscillationAmplitude

		// Add second harmonic for more natural and less predictable motion
		oscillation += math.Sin(now*oscillationFrequency*2.7) * oscillationAmplitude * 0.3

		// Apply the oscillation to the tank's rotation
		state.TankRotation += oscillation

		// Normalize angle
		state.TankRotation = normalizeAngle(state.TankRotation)

		// Always be moving
		state.IsMoving = true
		baseSpeed := 0.2 // Base speed value (matching player tank speed)

		// Vary speed slightly based on zigzag phase for more natural movement
		speedVariation := 1.0 + (math.Cos(now*oscillationFrequency*2) * 0.1) // ±10% speed variation

		// Apply small speed boost if far from center
		centerSpeedBoost := 1.0 + (centerBias * 0.4) // Up to 40% boost when far from center
		state.Velocity = baseSpeed * npc.MoveSpeed * speedVariation * centerSpeedBoost
	}

	// Always be moving
	state.IsMoving = true

	// IMPORTANT: Actually update the position based on rotation and velocity
	moveX := math.Cos(state.TankRotation) * state.Velocity
	moveZ := math.Sin(state.TankRotation) * state.Velocity

	// Update position by applying movement vector
	state.Position.X += moveX
	state.Position.Z += moveZ

	// Update track animation (for client visualization)
	// The client uses this value to animate tracks and wheels
	state.TrackRotation = state.Velocity * 5.0

	// Log movement occasionally to reduce log spam
	if rand.Float64() < 0.01 {
		log.Debug("NPC tank moving in zigzag",
			"id", npc.ID,
			"posX", state.Position.X,
			"posZ", state.Position.Z,
			"rotation", state.TankRotation,
			"distFromCenter", distFromCenter,
			"centerBias", centerBias,
			"velocity", state.Velocity)
	}
}

// moveInPatrol makes the NPC follow patrol points
func (c *NPCController) moveInPatrol(npc *NPCTank, state *PlayerState) {
	// Get current time for time-based animation (matching client)
	now := float64(time.Now().UnixNano()) / 1e9

	// Calculate distance from center for center-gravity effect
	distFromCenter := math.Sqrt(state.Position.X*state.Position.X + state.Position.Z*state.Position.Z)

	// Create a center gravity bias that increases with distance
	centerBias := 0.0
	if distFromCenter > 1500 { // Higher threshold for patrol tanks than random movement
		// Exponentially increases with distance
		centerBias = math.Min(0.8, (distFromCenter-1500)/2000)
	}

	if len(npc.PatrolPoints) == 0 {
		// If no patrol points, just move forward with slight oscillation
		state.IsMoving = true
		baseSpeed := 0.2 // Base speed value (matching player tank speed)

		// Add slight movement variation like client
		speedVariation := 1.0 + (math.Sin(now*0.5) * 0.1) // ±10% variation
		state.Velocity = baseSpeed * npc.MoveSpeed * speedVariation

		// If far from center, turn toward center occasionally
		if centerBias > 0 && rand.Float64() < centerBias {
			// Calculate angle toward center
			centerAngle := math.Atan2(-state.Position.Z, -state.Position.X)

			// Turn toward center with smooth interpolation
			angleDiff := normalizeAngle(centerAngle - state.TankRotation)
			rotationAmount := math.Copysign(
				math.Min(math.Abs(angleDiff), 0.02),
				angleDiff,
			)
			state.TankRotation += rotationAmount

			// Log center correction
			log.Debug("Patrol NPC (without points) gravitating toward center",
				"id", npc.ID,
				"distance", distFromCenter,
				"centerBias", centerBias)
		} else {
			// Normal oscillation for tanks already near center
			oscillation := math.Sin(now*0.3) * 0.005
			state.TankRotation += oscillation
		}

		state.TankRotation = normalizeAngle(state.TankRotation)

		// IMPORTANT: Actually update the position based on rotation and velocity
		moveX := math.Cos(state.TankRotation) * state.Velocity
		moveZ := math.Sin(state.TankRotation) * state.Velocity

		state.Position.X += moveX
		state.Position.Z += moveZ

		// Update track animation (for client visualization)
		state.TrackRotation = state.Velocity * 5.0
		return
	}

	// Check if we should override patrol and move toward center
	if centerBias > 0 && rand.Float64() < centerBias*0.3 { // 30% chance when at maximum bias
		// Calculate angle toward center
		centerAngle := math.Atan2(-state.Position.Z, -state.Position.X)

		// Create temporary target point toward center
		moveTowardCenterDist := distFromCenter * 0.4 // Move 40% toward center in one go
		centerX := state.Position.X + math.Cos(centerAngle)*moveTowardCenterDist
		centerZ := state.Position.Z + math.Sin(centerAngle)*moveTowardCenterDist

		tempTarget := Position{X: centerX, Y: 0, Z: centerZ}

		// Calculate direction to center temp target
		dx := tempTarget.X - state.Position.X
		dz := tempTarget.Z - state.Position.Z

		targetAngle := math.Atan2(dz, dx)

		log.Info("Patrol NPC temporarily moving toward center",
			"id", npc.ID,
			"distance", distFromCenter,
			"centerBias", centerBias,
			"targetX", centerX,
			"targetZ", centerZ)

		// Turn toward center
		currentAngle := state.TankRotation
		angleDiff := normalizeAngle(targetAngle - currentAngle)

		// Faster rotation for center correction
		rotationSpeed := 0.03
		rotationAmount := math.Copysign(
			math.Min(math.Abs(angleDiff), rotationSpeed),
			angleDiff,
		)

		// Apply rotation with slight wobble
		wobble := (rand.Float64() - 0.5) * 0.001
		state.TankRotation = normalizeAngle(currentAngle + rotationAmount + wobble)

		// Move faster toward center
		baseSpeed := 0.2
		speedBoost := 1.0 + (centerBias * 0.6) // Up to 60% speed boost
		state.Velocity = baseSpeed * npc.MoveSpeed * speedBoost

		// Update position
		moveX := math.Cos(state.TankRotation) * state.Velocity
		moveZ := math.Sin(state.TankRotation) * state.Velocity

		state.Position.X += moveX
		state.Position.Z += moveZ

		// Update track animation
		state.TrackRotation = state.Velocity * 5.0

		return
	}

	// Normal patrol behavior - Get current target point
	target := npc.PatrolPoints[npc.CurrentPoint]

	// Calculate direction to target
	dx := target.X - state.Position.X
	dz := target.Z - state.Position.Z
	dist := math.Sqrt(dx*dx + dz*dz)

	// Check if reached target point - use variable distance based on TacticalIQ
	// Smarter NPCs navigate more precisely to waypoints
	arrivalDistance := 5.0 + (1.0-npc.TacticalIQ)*5.0 // 5-10 units
	if dist < arrivalDistance {
		// Move to next patrol point
		npc.CurrentPoint = (npc.CurrentPoint + 1) % len(npc.PatrolPoints)
		log.Debug("NPC tank reached patrol point, moving to next point",
			"id", npc.ID,
			"nextPoint", npc.CurrentPoint)
	}

	// Calculate angle to target
	targetAngle := math.Atan2(dz, dx)

	// Turn gradually toward target angle with smoother motion (like client aimAtTarget)
	currentAngle := state.TankRotation
	angleDiff := normalizeAngle(targetAngle - currentAngle)

	// Calculate rotation speed - higher TacticalIQ = smoother turning
	baseRotationSpeed := 0.01 // Base rotation speed

	// Scale rotation speed based on angle difference (faster when far off target)
	// and TacticalIQ (smarter NPCs turn more precisely)
	rotationSpeedFactor := math.Min(1.0, 0.3+math.Abs(angleDiff)*2)
	rotationSpeed := baseRotationSpeed * rotationSpeedFactor * (0.8 + npc.TacticalIQ*0.4)

	// Calculate rotation amount with smooth dampening (like client)
	rotationAmount := math.Copysign(
		math.Min(math.Abs(angleDiff), rotationSpeed),
		angleDiff,
	)

	// Add slight wobble for natural movement (like client)
	wobble := (rand.Float64() - 0.5) * 0.001

	// Apply rotation
	state.TankRotation = normalizeAngle(currentAngle + rotationAmount + wobble)

	// Adjust speed based on turning - when turning sharply, slow down (like real tanks)
	// This makes movement look more realistic
	turnFactor := 1.0 - (math.Min(1.0, math.Abs(angleDiff)/(math.Pi/4)) * 0.4)

	// Also slow down when approaching target
	approachFactor := 1.0
	if dist < 50.0 {
		// Start slowing down when getting close to target
		approachFactor = 0.6 + ((dist / 50.0) * 0.4)
	}

	// Calculate speed with tactical variations
	baseSpeed := 0.2 // Base speed value (matching player tank speed)

	// Add slight speed oscillation for natural movement
	speedOscillation := 1.0 + (math.Sin(now*0.5) * 0.05) // ±5% variation

	// High tactical IQ means better speed control in turns
	tacticFactor := 0.7 + (npc.TacticalIQ * 0.3)

	// Calculate final speed - scale by turn factor and approach factor
	// High TacticalIQ NPCs slow less in turns (better driving)
	// Apply center bias speed boost if far from center
	speedBoost := 1.0 + (centerBias * 0.4) // Up to 40% speed boost
	state.Velocity = baseSpeed * npc.MoveSpeed *
		(turnFactor*tacticFactor + (1.0 - tacticFactor)) *
		approachFactor * speedOscillation * speedBoost

	// Always be moving
	state.IsMoving = true

	// IMPORTANT: Actually update the position based on rotation and velocity
	moveX := math.Cos(state.TankRotation) * state.Velocity
	moveZ := math.Sin(state.TankRotation) * state.Velocity

	// Update position by applying movement vector
	state.Position.X += moveX
	state.Position.Z += moveZ

	// Update track animation (for client visualization)
	state.TrackRotation = state.Velocity * 5.0

	// Log movement occasionally to reduce log spam
	if rand.Float64() < 0.01 {
		log.Debug("NPC tank patrolling",
			"id", npc.ID,
			"posX", state.Position.X,
			"posZ", state.Position.Z,
			"rotation", state.TankRotation,
			"targetX", target.X,
			"targetZ", target.Z,
			"distance", dist,
			"distFromCenter", distFromCenter,
			"centerBias", centerBias,
			"speed", state.Velocity)
	}
}

// moveRandomly makes the NPC move randomly
func (c *NPCController) moveRandomly(npc *NPCTank, state *PlayerState) {
	// Get current time for smooth time-based animation (like client-side)
	now := float64(time.Now().UnixNano()) / 1e9

	// Use time directly for animations instead of a movement timer counter

	// Boundary checking - keep NPCs within reasonable game area
	const MAP_BOUND = 2400.0 // 2400 unit radius around center for 5000x5000 map

	// Calculate distance from center and bias NPCs to move toward center when far away
	distFromCenter := math.Sqrt(state.Position.X*state.Position.X + state.Position.Z*state.Position.Z)

	// Create a gravity effect that increases with distance from center
	// The further away, the higher the chance of turning toward center
	centerBias := 0.0
	if distFromCenter > 500 {
		// Start applying center bias when beyond 500 units from center
		// Exponentially increases with distance
		centerBias = math.Min(0.9, (distFromCenter-500)/3000)
	}

	// Use nonlinear time-based probability to change direction (like client)
	// Higher TacticalIQ = more purposeful movement with fewer random changes
	changeProbability := 0.01 * (1.0 - npc.TacticalIQ*0.5)

	// Add time-based variation - creates a more natural pattern
	changeProbability *= 0.8 + math.Abs(math.Sin(now*0.5))*0.4

	// Occasionally change direction with a natural pattern
	if rand.Float64() < changeProbability || distFromCenter > MAP_BOUND*0.8 {
		// Calculate angle toward center
		centerAngle := math.Atan2(-state.Position.Z, -state.Position.X)

		// Blend between random direction and center direction based on distance
		if rand.Float64() < centerBias || distFromCenter > MAP_BOUND {
			// Move directly toward center if too far from map bounds or based on center bias
			npc.TargetRotation = centerAngle

			// Log boundary correction
			if distFromCenter > MAP_BOUND {
				log.Info("NPC reached map boundary, turning back toward center",
					"id", npc.ID,
					"distance", distFromCenter)
			} else {
				log.Debug("NPC gravitating toward center",
					"id", npc.ID,
					"distance", distFromCenter,
					"centerBias", centerBias)
			}
		} else {
			// More intelligent NPCs make smaller, more controlled turns
			// Less intelligent NPCs make more chaotic turns
			maxTurn := math.Pi / 8 * (1.0 - npc.TacticalIQ*0.5 + 0.5)
			rotationChange := (rand.Float64() - 0.5) * maxTurn

			// Store target rotation for gradual turning (like client)
			npc.TargetRotation = normalizeAngle(state.TankRotation + rotationChange)

			// Log direction changes occasionally
			if rand.Float64() < 0.1 {
				log.Debug("NPC changing direction",
					"id", npc.ID,
					"current", state.TankRotation,
					"target", npc.TargetRotation,
					"change", rotationChange)
			}
		}
	}

	// Gradually turn toward target rotation (smooth interpolation like client)
	if npc.TargetRotation != 0 {
		// Calculate angle difference
		angleDiff := normalizeAngle(npc.TargetRotation - state.TankRotation)

		// Determine turn speed based on TacticalIQ and angle difference
		// Smarter NPCs turn more smoothly and precisely
		// Increase turn speed when far from center to get NPCs back to playable area faster
		baseTurnSpeed := 0.01 * (0.8 + npc.TacticalIQ*0.4)
		turnSpeed := baseTurnSpeed * (1.0 + centerBias)

		// Apply smooth interpolation like client
		if math.Abs(angleDiff) > 0.01 {
			// Determine rotation direction and amount
			rotationAmount := math.Copysign(
				math.Min(turnSpeed, math.Abs(angleDiff)),
				angleDiff,
			)

			// Apply rotation with tiny wobble for natural movement
			wobble := (rand.Float64() - 0.5) * 0.002
			state.TankRotation += rotationAmount + wobble
			state.TankRotation = normalizeAngle(state.TankRotation)
		} else {
			// Close enough to target - clean up angle to exactly match target
			state.TankRotation = npc.TargetRotation
			npc.TargetRotation = 0 // Reset target (reached)
		}
	} else {
		// Add slight wobble to movement like client-side for more natural look
		// Intelligent NPCs have less random wobble
		wobbleAmount := 0.003 * (1.0 - npc.TacticalIQ*0.7)
		wobble := (rand.Float64() - 0.5) * wobbleAmount

		// Add time-based oscillation component
		oscillation := math.Sin(now*0.3) * 0.001

		// Apply tiny rotation adjustments for natural movement
		state.TankRotation += wobble + oscillation
		state.TankRotation = normalizeAngle(state.TankRotation)
	}

	// Always be moving
	state.IsMoving = true
	baseSpeed := 0.2 // Base speed value (matching player tank speed)

	// Add smooth speed variations like client-side
	// Higher TacticalIQ = more consistent speed
	speedVariation := 1.0 + (math.Sin(now*0.7) * 0.1 * (1.0 - npc.TacticalIQ*0.5))

	// Increase speed when far from center to help NPCs get back to playable area faster
	centerSpeedBoost := 1.0 + (centerBias * 0.5) // Up to 50% speed boost
	state.Velocity = baseSpeed * npc.MoveSpeed * speedVariation * centerSpeedBoost

	// IMPORTANT: Actually update the position based on rotation and velocity
	moveX := math.Cos(state.TankRotation) * state.Velocity
	moveZ := math.Sin(state.TankRotation) * state.Velocity

	// Update position by applying movement vector
	state.Position.X += moveX
	state.Position.Z += moveZ

	// Update track animation (for client visualization)
	state.TrackRotation = state.Velocity * 5.0

	// Log movement occasionally to reduce log spam
	if rand.Float64() < 0.01 {
		log.Debug("NPC moving randomly",
			"id", npc.ID,
			"posX", state.Position.X,
			"posZ", state.Position.Z,
			"rotation", state.TankRotation,
			"velocity", state.Velocity,
			"distFromCenter", distFromCenter,
			"centerBias", centerBias)
	}
}

// updateAimingAndFiring handles NPC aiming and firing logic
func (c *NPCController) updateAimingAndFiring(npc *NPCTank, state *PlayerState, gameState GameState) {
	// Maximum target acquisition range, affected by aggressiveness and tactical IQ
	var maxAcquisitionRange = 250.0 + (npc.Aggressiveness * 100.0)

	// Find potential targets and track the best one
	var bestTarget *PlayerState
	var bestDistance float64 = maxAcquisitionRange
	var playerTargets []PlayerState // Track all potential targets

	// First, find all valid player and NPC targets
	for playerID, player := range gameState.Players {
		// Skip self and destroyed tanks
		if playerID == npc.ID || player.IsDestroyed {
			continue
		}

		// Calculate distance
		dx := player.Position.X - state.Position.X
		dz := player.Position.Z - state.Position.Z
		dist := math.Sqrt(dx*dx + dz*dz)

		// If within range, consider as target
		if dist < bestDistance {
			// For NPCs, prefer to target real players over other NPCs
			isBot := strings.HasPrefix(playerID, "bot_")

			// Add to potential targets
			playerTargets = append(playerTargets, player)

			// Target selection logic - affected by TacticalIQ:
			// - High TacticalIQ NPCs prefer weakened targets
			// - High Aggressiveness NPCs are more likely to switch targets
			// - Low TacticalIQ NPCs just go for nearest target

			// Scoring system for target selection
			targetScore := 0.0

			// Base distance score (closer is better)
			distanceScore := 1.0 - (dist / maxAcquisitionRange)

			// Health score (lower health is better target)
			healthScore := 0.0
			if npc.TacticalIQ > 0.5 && player.Health < 100 {
				// High IQ NPCs prefer to finish off damaged targets
				healthScore = (100.0 - float64(player.Health)) / 100.0 * npc.TacticalIQ
			}

			// Player preference (prefer players over NPCs)
			playerScore := 0.0
			if !isBot {
				playerScore = 0.3
			}

			// Compute final score
			targetScore = distanceScore + healthScore + playerScore

			// Target consistency - discourage frequent target switches
			// if npc has a current target and is considering switching
			if npc.TargetID != "" && npc.TargetID != playerID {
				// Apply switching penalty based on TacticalIQ and inverse of Aggressiveness
				switchPenalty := 0.2 * (1.0 - npc.Aggressiveness) * npc.TacticalIQ
				targetScore -= switchPenalty
			}

			// Target selection decision
			isNewBest := bestTarget == nil || targetScore > 0.0

			// Select this target if it's the best so far
			if isNewBest {
				bestTarget = &player
				bestDistance = dist
				npc.TargetID = playerID

				// Log target selection for high-value targets (debug info)
				if player.Health < 30 || !isBot {
					log.Debug("NPC found strategic target",
						"id", npc.ID,
						"targetId", playerID,
						"distance", dist,
						"health", player.Health,
						"score", targetScore)
				}
			}
		}
	}

	// If we have a target, aim and potentially fire
	if bestTarget != nil {
		targetPos := bestTarget.Position

		// Calculate line of sight if we have physics manager
		npc.CanSeeTarget = true // Default to true
		if c.physicsManager != nil {
			// Convert Position to shared.Position for line of sight check
			fromPos := shared.Position{X: state.Position.X, Y: state.Position.Y, Z: state.Position.Z}
			toPos := shared.Position{X: targetPos.X, Y: targetPos.Y, Z: targetPos.Z}

			// Check line of sight
			npc.CanSeeTarget = c.physicsManager.CheckLineOfSight(fromPos, toPos)
		}

		// Store aiming position (convert to shared.Position)
		sharedTargetPos := shared.Position{X: targetPos.X, Y: targetPos.Y, Z: targetPos.Z}
		npc.AimingAt = &sharedTargetPos

		// Get current rotation to animate smoothly to target (like client's aimAtTarget method)
		currentTurretAngle := state.TurretRotation

		// Calculate direction to target
		dx := targetPos.X - state.Position.X
		dz := targetPos.Z - state.Position.Z

		// Calculate target turret angle
		targetAngle := math.Atan2(dz, dx)

		// If TacticalIQ is high, predict target movement for leading shots
		if npc.TacticalIQ > 0.7 && bestTarget.IsMoving {
			// Calculate estimated time for shell to reach target
			shellSpeed := 5.0
			flightTime := bestDistance / shellSpeed

			// Estimate target's future position based on their current velocity and rotation
			targetMoveX := math.Cos(bestTarget.TankRotation) * bestTarget.Velocity * flightTime
			targetMoveZ := math.Sin(bestTarget.TankRotation) * bestTarget.Velocity * flightTime

			// Add aim lead proportional to NPC's tactical intelligence
			leadFactor := npc.TacticalIQ * 0.8 // Don't do full prediction (hard to hit)
			predictedX := targetPos.X + (targetMoveX * leadFactor)
			predictedZ := targetPos.Z + (targetMoveZ * leadFactor)

			// Update target angle with prediction
			predDx := predictedX - state.Position.X
			predDz := predictedZ - state.Position.Z
			targetAngle = math.Atan2(predDz, predDx)

			// Log prediction occasionally
			if rand.Float64() < 0.05 {
				log.Debug("NPC leading target",
					"id", npc.ID,
					"targetId", npc.TargetID,
					"currentX", targetPos.X,
					"currentZ", targetPos.Z,
					"predictedX", predictedX,
					"predictedZ", predictedZ,
					"lead", leadFactor)
			}
		}

		// Normalize angle difference between current and target angle (like client-side code)
		angleDifference := targetAngle - currentTurretAngle
		normalizedDifference := normalizeAngle(angleDifference)

		// Apply smooth rotation with speed limit (matching client-side aimAtTarget behavior)
		turretRotationSpeed := 0.05 // Base speed for turret rotation

		// Adjust based on TacticalIQ - higher IQ = faster rotation (more responsive)
		turretRotationSpeed *= (0.8 + npc.TacticalIQ*0.4)

		// Calculate rotation amount with smooth dampening
		rotationAmount := math.Copysign(
			math.Min(math.Abs(normalizedDifference), turretRotationSpeed),
			normalizedDifference,
		)

		// Add inaccuracy based on NPC's skill level
		// Less accurate NPCs have more random aim - matching client approach
		baseInaccuracy := (1.0 - npc.FiringAccuracy) * 0.5

		// Accuracy improves when not moving (if stationary)
		inaccuracy := baseInaccuracy
		if !state.IsMoving {
			inaccuracy *= 0.6 // 40% accuracy bonus when stationary
		}

		// Accuracy worsens with distance
		distanceFactor := math.Min(1.0, bestDistance/200.0)
		inaccuracy *= (1.0 + distanceFactor)

		// Calculate aim randomness - add slight wobble for realism like client
		randomOffset := (rand.Float64() - 0.5) * inaccuracy

		// Add slight random wobble (matching client behavior)
		wobble := (rand.Float64() - 0.5) * 0.002

		// Apply calculated rotation with wobble
		state.TurretRotation = currentTurretAngle + rotationAmount + wobble + randomOffset
		state.TurretRotation = normalizeAngle(state.TurretRotation)

		// Calculate barrel elevation based on distance (like client's aimAtTarget method)
		// Calculate horizontal distance to target
		horizontalDistance := math.Sqrt(dx*dx + dz*dz)

		// Target height difference (accounting for tank height)
		heightDifference := (targetPos.Y - state.Position.Y) + 5.0 // Add tank height offset

		// Calculate elevation angle needed
		targetElevation := 0.0
		if horizontalDistance > 0 {
			// Use negative atan2 because of how barrel coordinate system works (like client)
			// Limit to only depression or horizontal (matching client limits)
			targetElevation = math.Min(0.0, -math.Atan2(heightDifference, horizontalDistance))
		}

		// Adjust for distance - further targets need more precise angle
		distanceAdjustment := math.Min(bestDistance/500.0, 0.3)

		// Add slight random variation to elevation for imperfect aiming (like client)
		elevationRandomness := (rand.Float64() - 0.5) * inaccuracy * 0.2

		// Clamp to realistic barrel elevation range
		minBarrelElevation := -0.8 // About -45 degrees
		maxBarrelElevation := 0.0  // Horizontal position

		// Calculate current elevation to animate smoothly
		currentElevation := state.BarrelElevation

		// Calculate difference and apply smooth movement
		elevationDifference := targetElevation - currentElevation

		// Barrel elevation speed
		barrelElevationSpeed := 0.03 // Base speed for barrel movement

		// Adjust based on distance to target angle (faster when far from target angle)
		elevationSpeedFactor := math.Min(1.0, 0.3+math.Abs(elevationDifference)*2)
		elevationAmount := math.Copysign(
			math.Min(math.Abs(elevationDifference), barrelElevationSpeed*elevationSpeedFactor),
			elevationDifference,
		)

		// Apply calculated elevation with randomness
		newElevation := currentElevation + elevationAmount + elevationRandomness + ((rand.Float64() - 0.5) * 0.001)

		// Clamp to valid range
		state.BarrelElevation = math.Max(minBarrelElevation,
			math.Min(maxBarrelElevation, newElevation+distanceAdjustment))

		// Check if we can fire (cooldown expired and have line of sight)
		timeSinceLastFire := time.Since(npc.LastFire)
		cooledDown := timeSinceLastFire > npc.FireCooldown

		// Firing range is affected by the NPC's aggressiveness - increased for larger map
		firingRange := 800.0 + (npc.Aggressiveness * 300.0) // Realistic modern tank engagement range

		// Calculate firing readiness based on aiming parameters
		aimingPrecision := math.Abs(normalizedDifference) // Lower value means better aim

		// Make sure we have line of sight to target
		if c.physicsManager != nil {
			// Convert positions for physics check
			fromPos := shared.Position{X: state.Position.X, Y: state.Position.Y + 1.2, Z: state.Position.Z} // Realistic tank turret height
			toPos := shared.Position{X: targetPos.X, Y: targetPos.Y, Z: targetPos.Z}

			// Update line of sight status
			npc.CanSeeTarget = c.physicsManager.CheckLineOfSight(fromPos, toPos)
		}

		// High TacticalIQ NPCs wait for a good shot rather than firing immediately
		readyToFire := true
		if npc.TacticalIQ > 0.6 {
			// Only fire when aim is relatively precise (turret fairly aligned with target)
			maxAllowedError := (1.0 - npc.FiringAccuracy) * 0.2 // Tighter precision threshold

			// Check if we're aligned well enough to fire
			readyToFire = aimingPrecision < maxAllowedError &&
				math.Abs(elevationDifference) < 0.1 && // Check barrel elevation alignment
				npc.CanSeeTarget // Make sure we can see target

			// Stationary targets are easier to hit
			if bestTarget != nil && !bestTarget.IsMoving && aimingPrecision < maxAllowedError*1.5 {
				readyToFire = true
			}

			// Even high IQ NPCs will eventually fire if they've been aiming for too long and close enough
			if timeSinceLastFire > time.Duration(float64(npc.FireCooldown)*2.5) && aimingPrecision < 0.15 && npc.CanSeeTarget {
				readyToFire = true

				// Log decision to fire
				if rand.Float64() < 0.3 {
					log.Debug("NPC firing after extended aiming",
						"id", npc.ID,
						"precision", aimingPrecision,
						"timeSinceLastFire", timeSinceLastFire)
				}
			}
		}

		// Only fire if:
		// 1. Cooldown has expired
		// 2. Target is in range
		// 3. NPC is ready to fire (aim is good enough)
		// Only fire if we have line of sight (except for very low TacticalIQ NPCs that might blindly fire)
		if cooledDown && bestDistance < firingRange && readyToFire && (npc.CanSeeTarget || npc.TacticalIQ < 0.3) {
			// Prepare shell data with realistic parameters
			// More aggressive NPCs fire faster shells (reflecting different ammunition types)
			shellSpeed := 7.0 + (npc.Aggressiveness * 1.0) // Increased shell speed for more realistic ballistics

			// Calculate barrel end position (like client's fireShell method)
			barrelLength := 2.0 // Increased barrel length for more realistic tank proportions

			// Calculate barrel tip position using barrel elevation and turret rotation
			// This matches the client-side calculation in fireShell method

			// Calculate firing direction - matching client's fireShell method
			firingDirX := 0.0
			firingDirY := 0.0
			firingDirZ := 1.0 // Start with forward vector (z-axis)

			// Apply barrel elevation (x-axis rotation)
			// After elevation: dir = (0, sin(elev), cos(elev))
			firingDirY = math.Sin(state.BarrelElevation)
			firingDirZ = math.Cos(state.BarrelElevation)

			// Apply turret rotation (y-axis rotation)
			// After turret rotation:
			// dirX = sin(turretRot) * cos(elev)
			// dirY = sin(elev) (unchanged by y-axis rotation)
			// dirZ = cos(turretRot) * cos(elev)
			cosElev := math.Cos(state.BarrelElevation)
			firingDirX = math.Sin(state.TurretRotation) * cosElev
			firingDirZ = math.Cos(state.TurretRotation) * cosElev

			// Apply same calculation to get barrel tip position
			// NEW: Starting shell position must be at the barrel tip to match client behavior
			barrelTipX := state.Position.X + (firingDirX * barrelLength)
			barrelTipY := state.Position.Y + 1.2 + (firingDirY * barrelLength) // Y offset for realistic tank turret height
			barrelTipZ := state.Position.Z + (firingDirZ * barrelLength)

			shellData := ShellData{
				// Start shell exactly at barrel tip position for realistic firing
				Position: Position{
					X: barrelTipX,
					Y: barrelTipY,
					Z: barrelTipZ,
				},
				// Direction matches the barrel direction exactly for ballistic accuracy
				Direction: Position{
					X: firingDirX,
					Y: firingDirY,
					Z: firingDirZ,
				},
				Speed: shellSpeed,
			}

			// Log firing attempt
			log.Info("NPC firing at target",
				"id", npc.ID,
				"targetId", npc.TargetID,
				"distance", bestDistance,
				"accuracy", npc.FiringAccuracy,
				"inaccuracy", inaccuracy,
				"shellSpeed", shellSpeed)

			// Fire the shell using the helper method
			c.mutex.Unlock() // Unlock before calling manager
			success := c.FireNPCShell(npc, shellData)
			c.mutex.Lock() // Lock again to continue processing

			// Only update last fire time if successfully fired
			if success {
				npc.LastFire = time.Now()
			}
		}
	} else {
		// If no target, behavior depends on TacticalIQ - similar to client's NPCTank behavior
		// Get current time for oscillation like in client-side
		now := float64(time.Now().UnixNano()) / 1e9

		if npc.TacticalIQ > 0.6 {
			// Smarter NPCs try to align turret with movement when searching
			alignmentBias := npc.TacticalIQ * 0.2

			// Interpolate between scanning and forward alignment
			scanSpeed := 0.002

			// Add time-based oscillation like client's NPCTank movement
			scanComponent := scanSpeed * (1.0 - alignmentBias) * math.Sin(now*0.5)

			// Calculate desired rotation (partial alignment with movement direction)
			desiredRotation := state.TankRotation
			currentRotation := state.TurretRotation

			// Find smallest angle difference
			rotDiff := normalizeAngle(desiredRotation - currentRotation)

			// Move turret partially toward movement direction
			alignmentComponent := rotDiff * alignmentBias * 0.02

			// Apply combined rotation with slight wobble (like client)
			wobble := (rand.Float64() - 0.5) * 0.002
			state.TurretRotation += scanComponent + alignmentComponent + wobble

			// Animate barrel elevation with sine wave (like client)
			// This creates the same effect as the client code:
			// barrelTarget = Math.sin(movementTimer * 0.005) * (maxBarrelElevation - minBarrelElevation) / 2
			minBarrelElevation := -0.8 // About -45 degrees
			maxBarrelElevation := 0.0  // Horizontal position

			// Calculate oscillating barrel elevation
			barrelTarget := math.Sin(now*0.5) * (maxBarrelElevation - minBarrelElevation) / 2

			// Apply smooth animation toward target (like client)
			elevationDiff := barrelTarget - state.BarrelElevation
			state.BarrelElevation += elevationDiff * 0.01
		} else {
			// Basic scanning for lower TacticalIQ NPCs with time-based oscillation (like client)
			scanSpeed := 0.002 + (rand.Float64() * 0.001)

			// Add oscillating component from client-side code
			oscillation := math.Sin(now*0.5) * 0.01
			state.TurretRotation += scanSpeed + oscillation

			// Simple barrel oscillation
			state.BarrelElevation = -0.4 + math.Sin(now*0.3)*0.2
		}

		// Normalize angle
		state.TurretRotation = normalizeAngle(state.TurretRotation)

		// Reset aiming target
		npc.AimingAt = nil
		npc.CanSeeTarget = false
	}
}

// FireNPCShell handles firing a shell with proper debouncing
func (c *NPCController) FireNPCShell(npc *NPCTank, shellData ShellData) bool {
	// Note: this function is called from updateAimingAndFiring, which is called from updateNPCAI
	// The calling function already handles temporarily releasing and re-acquiring the mutex

	// Fire the shell through the manager (which has its own debouncing)
	_, err := c.manager.FireShell(shellData, npc.ID)

	// If there was an error (like debounce rejection), return false
	if err != nil {
		log.Error("Error firing NPC shell", "id", npc.ID, "error", err)
		return false
	}

	// Shell fired successfully
	return true
}

// GetActiveNPCs returns a list of active NPC IDs
func (c *NPCController) GetActiveNPCs() []string {
	c.mutex.RLock()
	defer c.mutex.RUnlock()

	var npcs []string
	for id, npc := range c.npcs {
		if npc.IsActive {
			npcs = append(npcs, id)
		}
	}
	return npcs
}

// RemoveNPC removes an NPC from the game
func (c *NPCController) RemoveNPC(id string) {
	c.mutex.Lock()
	npc, exists := c.npcs[id]
	if exists {
		npc.IsActive = false
		log.Info("Removing NPC tank", "id", id)
	}
	c.mutex.Unlock()
}

// RemoveAllNPCs removes all NPCs from the game
func (c *NPCController) RemoveAllNPCs() {
	c.mutex.Lock()
	for id, npc := range c.npcs {
		npc.IsActive = false
		log.Info("Removing NPC tank", "id", id)
	}
	c.mutex.Unlock()
}

// normalizeAngle normalizes an angle to be between -π and π
func normalizeAngle(angle float64) float64 {
	angle = math.Mod(angle, 2*math.Pi)
	if angle > math.Pi {
		angle -= 2 * math.Pi
	} else if angle < -math.Pi {
		angle += 2 * math.Pi
	}
	return angle
}
