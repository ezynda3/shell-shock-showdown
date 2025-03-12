package game

import (
	"fmt"
	"log"
	"math"
	"math/rand"
	"strings"
	"sync"
	"time"

	"github.com/mark3labs/pro-saaskit/game/shared"
)

// NPCController manages NPC tanks
type NPCController struct {
	manager        *Manager
	npcs           map[string]*NPCTank
	mutex          sync.RWMutex
	gameMap        *GameMap
	physicsDelay   time.Duration
	isRunning      bool
	quit           chan struct{}                  // Channel to signal shutdown
	physicsManager shared.PhysicsManagerInterface // Reference to physics manager for targeting
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
	TargetID        string // ID of player this NPC is targeting
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

	// NPC personality traits (0.0 to 1.0 scale)
	FiringAccuracy float64 // How accurate this NPC's shots are (higher is more accurate)
	MoveSpeed      float64 // Movement speed multiplier (higher is faster)
	Aggressiveness float64 // How aggressively it pursues targets (higher is more aggressive)
	FireRate       float64 // How frequently it fires (higher means more frequent firing)
	TacticalIQ     float64 // How smart it is tactically (higher means smarter decisions)

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
		physicsDelay:   16 * time.Millisecond, // ~60fps to match the game's rendering frequency
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

	// Start the main NPC simulation loop
	go c.runSimulation()

	log.Println("🤖 NPC Controller started")
}

// Stop halts the NPC simulation
func (c *NPCController) Stop() {
	c.mutex.Lock()
	defer c.mutex.Unlock()

	if !c.isRunning {
		return
	}

	close(c.quit)
	c.isRunning = false
	log.Println("🤖 NPC Controller stopped")
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

	// Create tank position using much wider area to match 5000x5000 map dimensions
	// Use a larger spawn area but keep tanks within playable bounds
	offsetX := -2000.0 + rand.Float64()*4000.0
	offsetZ := -2000.0 + rand.Float64()*4000.0

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
		// Create a square patrol route - larger patrol areas for the 5000x5000 map
		size := 100.0 + rand.Float64()*200.0
		patrolPoints = []Position{
			{X: offsetX + size, Y: 0, Z: offsetZ + size},
			{X: offsetX + size, Y: 0, Z: offsetZ - size},
			{X: offsetX - size, Y: 0, Z: offsetZ - size},
			{X: offsetX - size, Y: 0, Z: offsetZ + size},
		}
	}

	// Generate randomized personality based on difficulty level
	personality := GetRandomizedPersonality(difficultyLevel)

	// Log the NPC's personality traits
	log.Printf("🤖 Bot '%s' personality: Accuracy=%.2f, MoveSpeed=%.2f, Aggressiveness=%.2f, FireRate=%.2f, TacticalIQ=%.2f, Cooldown=%v",
		name,
		personality.Accuracy,
		personality.MoveSpeed,
		personality.Aggressiveness,
		personality.FireRate,
		personality.TacticalIQ,
		personality.Cooldown)

	npc := &NPCTank{
		ID:              npcID,
		Name:            name,
		State:           state,
		MovementPattern: movementPattern,
		PatrolPoints:    patrolPoints,
		CurrentPoint:    0,
		LastUpdate:      time.Now(),
		LastFire:        time.Now(),
		FireCooldown:    personality.Cooldown,
		ScanRadius:      500.0 + (personality.Aggressiveness * 250.0), // More aggressive = larger scan radius - increased for larger map
		IsActive:        true,
		AimingAt:        nil, // No target initially
		CanSeeTarget:    false,

		// Personality traits
		FiringAccuracy: personality.Accuracy,
		MoveSpeed:      personality.MoveSpeed,
		Aggressiveness: personality.Aggressiveness,
		FireRate:       personality.FireRate,
		TacticalIQ:     personality.TacticalIQ,

		// Visual traits
		TankColor:   colorScheme.PrimaryColor,
		TurretStyle: colorScheme.Style,
	}

	// Add to NPC map
	c.npcs[npcID] = npc

	// Register with game manager
	if err := c.manager.UpdatePlayer(state, npcID, name); err != nil {
		log.Printf("Error registering bot tank: %v", err)
	}

	log.Printf("🤖 Spawned bot tank '%s' (%s) at position (%f, %f, %f)",
		npc.Name, npcID, offsetX, offsetZ, 0.0)

	return npc
}

// runSimulation is the main NPC simulation loop
func (c *NPCController) runSimulation() {
	ticker := time.NewTicker(c.physicsDelay)
	defer ticker.Stop()

	for {
		select {
		case <-c.quit:
			return
		case <-ticker.C:
			c.updateNPCs()
		}
	}
}

// updateNPCs processes all active NPCs
func (c *NPCController) updateNPCs() {
	// Get current game state for NPC decision making
	gameState := c.manager.GetState()

	// Process each NPC
	c.mutex.Lock()
	for _, npc := range c.npcs {
		if !npc.IsActive {
			continue
		}

		// Check if the NPC's state has been updated by the server
		serverState, exists := gameState.Players[npc.ID]
		if exists {
			// Update local state with server state
			log.Printf("Updating NPC %s from server state: health=%d, position=(%f,%f,%f), destroyed=%v",
				npc.ID, serverState.Health, serverState.Position.X, serverState.Position.Y, serverState.Position.Z, serverState.IsDestroyed)

			// Update health and destroyed status from server
			npc.State.Health = serverState.Health
			npc.State.IsDestroyed = serverState.IsDestroyed

			// Only update position if significant movement happened on server side
			dx := npc.State.Position.X - serverState.Position.X
			dz := npc.State.Position.Z - serverState.Position.Z
			dist := math.Sqrt(dx*dx + dz*dz)
			if dist > 5.0 {
				log.Printf("NPC %s position corrected by server from (%f,%f) to (%f,%f)",
					npc.ID, npc.State.Position.X, npc.State.Position.Z, serverState.Position.X, serverState.Position.Z)
				npc.State.Position = serverState.Position
			}
		} else {
			log.Printf("NPC %s not found in server state, re-registering", npc.ID)
			// Re-register the NPC with the game manager
			c.mutex.Unlock()
			if err := c.manager.UpdatePlayer(npc.State, npc.ID, npc.Name); err != nil {
				log.Printf("Error re-registering NPC: %v", err)
			}
			c.mutex.Lock()
		}

		// Skip if destroyed, wait for respawn
		if npc.State.IsDestroyed {
			// Check if enough time has passed to respawn
			if time.Since(npc.LastUpdate) > 5*time.Second {
				log.Printf("Respawning destroyed NPC %s", npc.ID)
				// Respawn the NPC
				respawnData := RespawnData{
					PlayerID: npc.ID,
					Position: Position{
						X: -2000.0 + rand.Float64()*4000.0,
						Y: 0,
						Z: -2000.0 + rand.Float64()*4000.0,
					},
				}
				c.mutex.Unlock() // Unlock before calling manager
				c.manager.RespawnTank(respawnData)
				c.mutex.Lock() // Lock again to continue processing

				// Reset tank state
				npc.State.IsDestroyed = false
				npc.State.Health = 100
				npc.LastUpdate = time.Now()
			}
			continue
		}

		// Force movement for stationary NPCs
		if time.Since(npc.LastUpdate) > 3*time.Second && !npc.State.IsMoving {
			log.Printf("NPC %s has been stationary for too long, forcing movement", npc.ID)
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
	c.mutex.Unlock()
}

// updateNPCAI handles movement and firing for an NPC
func (c *NPCController) updateNPCAI(npc *NPCTank, gameState GameState) {
	// Make a copy of the state to modify
	state := npc.State

	// Look for nearby players to target - affected by aggressiveness
	c.findTarget(npc, gameState)

	// Decide whether to pursue target or follow movement pattern
	// Higher TacticalIQ NPCs make smarter decisions about when to pursue vs patrol
	if npc.TargetID != "" && npc.Aggressiveness > 0.6 && (npc.TacticalIQ < 0.7 || rand.Float64() < npc.Aggressiveness) {
		// Pursue target if aggressive enough
		c.pursueTarget(npc, &state, gameState)
	} else {
		// Otherwise follow normal movement pattern
		c.updateMovement(npc, &state)
	}

	// Update aiming and firing - accuracy affected by FiringAccuracy trait
	c.updateAimingAndFiring(npc, &state, gameState)

	// Set timestamp for this update
	state.Timestamp = time.Now().UnixMilli()

	// Update the state in game manager
	c.mutex.Unlock() // Unlock before calling manager
	if err := c.manager.UpdatePlayer(state, npc.ID, npc.Name); err != nil {
		log.Printf("Error updating NPC state: %v", err)
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
		// Move away from target but maintain facing
		state.TankRotation = normalizeAngle(targetAngle + math.Pi)

		// Smart NPCs circle strafe instead of just backing up
		if npc.TacticalIQ > 0.7 {
			// Add a perpendicular component for circling
			circleOffset := math.Pi / 2
			if rand.Float64() < 0.5 {
				circleOffset = -math.Pi / 2 // Choose direction randomly
			}
			state.TankRotation = normalizeAngle(targetAngle + circleOffset)
		}
	} else if distToTarget > idealDistance*1.3 {
		// If we're too far, move towards target
		state.TankRotation = targetAngle
	} else {
		// At good distance, circle strafe
		circleDir := math.Pi / 2
		if rand.Float64() < 0.5 {
			circleDir = -math.Pi / 2
		}
		state.TankRotation = normalizeAngle(targetAngle + circleDir)
	}

	// Adjust speed based on situation - with player-matching speed
	state.IsMoving = true
	baseSpeed := 0.2 // Match player tank speed from tank.ts

	// Tactical adjustments to speed - with smoother transitions
	if distToTarget < idealDistance*0.5 {
		// If very close, move faster to get away, but not too fast
		state.Velocity = baseSpeed * npc.MoveSpeed * 1.2
	} else if math.Abs(distToTarget-idealDistance) < 20.0 {
		// If at good combat distance, slow down for better aiming
		state.Velocity = baseSpeed * npc.MoveSpeed * 0.6
	} else {
		// Normal pursuit speed
		state.Velocity = baseSpeed * npc.MoveSpeed
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
		log.Printf("NPC %s pursuing target %s: distance=%.2f, idealDistance=%.2f, moving=%v",
			npc.ID, npc.TargetID, distToTarget, idealDistance, state.IsMoving)
	}
}

// findTarget looks for the nearest player to target
func (c *NPCController) findTarget(npc *NPCTank, gameState GameState) {
	var nearestDist float64 = npc.ScanRadius
	var nearestID string

	// Find closest non-NPC player tank
	for playerID, player := range gameState.Players {
		// Skip other NPCs and destroyed tanks
		if playerID == npc.ID || strings.HasPrefix(playerID, "bot_") || player.IsDestroyed {
			continue
		}

		// Calculate distance
		dx := player.Position.X - npc.State.Position.X
		dz := player.Position.Z - npc.State.Position.Z
		dist := math.Sqrt(dx*dx + dz*dz)

		// Check if this is the closest player so far
		if dist < nearestDist {
			nearestDist = dist
			nearestID = playerID
		}
	}

	// Update target
	npc.TargetID = nearestID
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

	// Use sine wave for more natural turning like client-side tank movement
	// Add time-based oscillation for more natural motion
	turnMultiplier := 0.5 + (math.Sin(now*0.3) * 0.5) // Oscillate between 0.0 and 1.0
	
	// Smoother, more gradual turning with time-based variation
	turnAmount := 0.001 * speed * turnMultiplier // For smoother 60fps motion
	state.TankRotation += turnAmount

	// Normalize angle
	state.TankRotation = normalizeAngle(state.TankRotation)

	// Always be moving
	state.IsMoving = true
	
	// Add slight speed variation for more natural movement (like client)
	speedVariation := 1.0 + (math.Sin(now*0.2) * 0.1) // ±10% speed variation
	state.Velocity = speed * speedVariation

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
		log.Printf("NPC tank %s moving in circle: pos=(%.2f,%.2f), rotation=%.2f, velocity=%.2f",
			npc.ID, state.Position.X, state.Position.Z, state.TankRotation, state.Velocity)
	}
}

// moveInZigzag makes the NPC move in a zigzag pattern
func (c *NPCController) moveInZigzag(npc *NPCTank, state *PlayerState) {
	// Get current time for oscillation - matches client-side time-based animation
	now := float64(time.Now().UnixNano()) / 1e9

	// Calculate zigzag pattern with more natural motion like client-side
	// Use sine wave with variable amplitude based on tactical IQ
	oscillationFrequency := 0.2 + (npc.TacticalIQ * 0.3) // Higher IQ = faster zigzag
	oscillationAmplitude := 0.02 * (1.0 - npc.TacticalIQ * 0.5) // Higher IQ = more controlled zigzag
	
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
	baseSpeed := 0.2                           // Base speed value (matching player tank speed)
	
	// Vary speed slightly based on zigzag phase for more natural movement
	speedVariation := 1.0 + (math.Cos(now*oscillationFrequency*2) * 0.1) // ±10% speed variation
	state.Velocity = baseSpeed * npc.MoveSpeed * speedVariation
	
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
		log.Printf("NPC tank %s moving in zigzag: pos=(%.2f,%.2f), rotation=%.2f, oscillation=%.2f",
			npc.ID, state.Position.X, state.Position.Z, state.TankRotation, oscillation)
	}
}

// moveInPatrol makes the NPC follow patrol points
func (c *NPCController) moveInPatrol(npc *NPCTank, state *PlayerState) {
	// Get current time for time-based animation (matching client)
	now := float64(time.Now().UnixNano()) / 1e9
	
	if len(npc.PatrolPoints) == 0 {
		// If no patrol points, just move forward with slight oscillation
		state.IsMoving = true
		baseSpeed := 0.2                           // Base speed value (matching player tank speed)
		
		// Add slight movement variation like client
		speedVariation := 1.0 + (math.Sin(now*0.5) * 0.1) // ±10% variation
		state.Velocity = baseSpeed * npc.MoveSpeed * speedVariation
		
		// Add slight directional oscillation
		oscillation := math.Sin(now*0.3) * 0.005
		state.TankRotation += oscillation
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

	// Get current target point
	target := npc.PatrolPoints[npc.CurrentPoint]

	// Calculate direction to target
	dx := target.X - state.Position.X
	dz := target.Z - state.Position.Z
	dist := math.Sqrt(dx*dx + dz*dz)

	// Check if reached target point - use variable distance based on TacticalIQ
	// Smarter NPCs navigate more precisely to waypoints
	arrivalDistance := 5.0 + (1.0 - npc.TacticalIQ) * 5.0 // 5-10 units
	if dist < arrivalDistance {
		// Move to next patrol point
		npc.CurrentPoint = (npc.CurrentPoint + 1) % len(npc.PatrolPoints)
		log.Printf("NPC tank %s reached patrol point, moving to next point %d",
			npc.ID, npc.CurrentPoint)
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
	rotationSpeedFactor := math.Min(1.0, 0.3 + math.Abs(angleDiff) * 2)
	rotationSpeed := baseRotationSpeed * rotationSpeedFactor * (0.8 + npc.TacticalIQ * 0.4)
	
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
	turnFactor := 1.0 - (math.Min(1.0, math.Abs(angleDiff) / (math.Pi/4)) * 0.4)
	
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
	state.Velocity = baseSpeed * npc.MoveSpeed * 
		(turnFactor * tacticFactor + (1.0 - tacticFactor)) * 
		approachFactor * speedOscillation
	
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
		log.Printf("NPC tank %s patrolling: pos=(%.2f,%.2f), rotation=%.2f, target=(%.2f,%.2f), dist=%.2f, speed=%.2f",
			npc.ID, state.Position.X, state.Position.Z, state.TankRotation,
			target.X, target.Z, dist, state.Velocity)
	}
}

// moveRandomly makes the NPC move randomly
func (c *NPCController) moveRandomly(npc *NPCTank, state *PlayerState) {
	// Get current time for smooth time-based animation (like client-side)
	now := float64(time.Now().UnixNano()) / 1e9
	
	// Use time directly for animations instead of a movement timer counter
	
	// Use nonlinear time-based probability to change direction (like client)
	// Higher TacticalIQ = more purposeful movement with fewer random changes
	changeProbability := 0.01 * (1.0 - npc.TacticalIQ * 0.5)
	
	// Add time-based variation - creates a more natural pattern
	changeProbability *= 0.8 + math.Abs(math.Sin(now*0.5)) * 0.4
	
	// Occasionally change direction with a natural pattern
	if rand.Float64() < changeProbability {
		// More intelligent NPCs make smaller, more controlled turns
		// Less intelligent NPCs make more chaotic turns
		maxTurn := math.Pi / 8 * (1.0 - npc.TacticalIQ * 0.5 + 0.5)
		rotationChange := (rand.Float64() - 0.5) * maxTurn
		
		// Store target rotation for gradual turning (like client)
		npc.TargetRotation = normalizeAngle(state.TankRotation + rotationChange)
		
		// Log direction changes occasionally
		if rand.Float64() < 0.1 {
			log.Printf("NPC %s changing direction: current=%.2f, target=%.2f, change=%.2f",
				npc.ID, state.TankRotation, npc.TargetRotation, rotationChange)
		}
	}
	
	// Gradually turn toward target rotation (smooth interpolation like client)
	if npc.TargetRotation != 0 {
		// Calculate angle difference
		angleDiff := normalizeAngle(npc.TargetRotation - state.TankRotation)
		
		// Determine turn speed based on TacticalIQ and angle difference
		// Smarter NPCs turn more smoothly and precisely
		turnSpeed := 0.01 * (0.8 + npc.TacticalIQ * 0.4)
		
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
		wobbleAmount := 0.003 * (1.0 - npc.TacticalIQ * 0.7)
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
	speedVariation := 1.0 + (math.Sin(now*0.7) * 0.1 * (1.0 - npc.TacticalIQ * 0.5))
	state.Velocity = baseSpeed * npc.MoveSpeed * speedVariation

	// IMPORTANT: Actually update the position based on rotation and velocity
	moveX := math.Cos(state.TankRotation) * state.Velocity
	moveZ := math.Sin(state.TankRotation) * state.Velocity

	// Update position by applying movement vector
	state.Position.X += moveX
	state.Position.Z += moveZ
	
	// Update track animation (for client visualization)
	state.TrackRotation = state.Velocity * 5.0

	// Boundary checking - keep NPCs within reasonable game area
	const MAP_BOUND = 2400.0 // 2400 unit radius around center for 5000x5000 map

	// If we're getting too far from center, turn back
	distFromCenter := math.Sqrt(state.Position.X*state.Position.X + state.Position.Z*state.Position.Z)
	if distFromCenter > MAP_BOUND {
		// Calculate angle toward center
		centerAngle := math.Atan2(-state.Position.Z, -state.Position.X)
		
		// Set target rotation toward center (for smooth turning)
		npc.TargetRotation = centerAngle

		// Log boundary correction
		log.Printf("NPC %s reached map boundary (dist=%.2f), turning back toward center",
			npc.ID, distFromCenter)
	}

	// Log movement occasionally to reduce log spam
	if rand.Float64() < 0.01 {
		log.Printf("NPC %s moving randomly: pos=(%.2f,%.2f), rotation=%.2f, velocity=%.2f",
			npc.ID, state.Position.X, state.Position.Z, state.TankRotation, state.Velocity)
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
					log.Printf("NPC %s found strategic target %s: distance=%.1f, health=%d, score=%.2f",
						npc.ID, playerID, dist, player.Health, targetScore)
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
				log.Printf("NPC %s leading target %s: current=(%0.1f,%0.1f), predicted=(%0.1f,%0.1f), lead=%.2f",
					npc.ID, npc.TargetID, targetPos.X, targetPos.Z, predictedX, predictedZ, leadFactor)
			}
		}

		// Normalize angle difference between current and target angle (like client-side code)
		angleDifference := targetAngle - currentTurretAngle
		normalizedDifference := normalizeAngle(angleDifference)
		
		// Apply smooth rotation with speed limit (matching client-side aimAtTarget behavior)
		turretRotationSpeed := 0.05 // Base speed for turret rotation
		
		// Adjust based on TacticalIQ - higher IQ = faster rotation (more responsive)
		turretRotationSpeed *= (0.8 + npc.TacticalIQ * 0.4)
		
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
		elevationSpeedFactor := math.Min(1.0, 0.3 + math.Abs(elevationDifference) * 2)
		elevationAmount := math.Copysign(
			math.Min(math.Abs(elevationDifference), barrelElevationSpeed * elevationSpeedFactor),
			elevationDifference,
		)
		
		// Apply calculated elevation with randomness
		newElevation := currentElevation + elevationAmount + elevationRandomness + ((rand.Float64() - 0.5) * 0.001)
		
		// Clamp to valid range
		state.BarrelElevation = math.Max(minBarrelElevation, 
			math.Min(maxBarrelElevation, newElevation + distanceAdjustment))

		// Check if we can fire (cooldown expired and have line of sight)
		timeSinceLastFire := time.Since(npc.LastFire)
		cooledDown := timeSinceLastFire > npc.FireCooldown

		// Firing range is affected by the NPC's aggressiveness - increased for larger map
		firingRange := 500.0 + (npc.Aggressiveness * 250.0)

		// Calculate firing readiness based on aiming parameters
		aimingPrecision := math.Abs(normalizedDifference) // Lower value means better aim

		// High TacticalIQ NPCs wait for a good shot rather than firing immediately
		readyToFire := true
		if npc.TacticalIQ > 0.7 {
			// Only fire when aim is relatively precise (turret fairly aligned with target)
			maxAllowedError := (1.0 - npc.FiringAccuracy) * 0.3 // Precision threshold
			readyToFire = aimingPrecision < maxAllowedError

			// Even high IQ NPCs will eventually fire if they've been aiming for too long
			if timeSinceLastFire > npc.FireCooldown*3 {
				readyToFire = true
			}
		}

		// Only fire if:
		// 1. Cooldown has expired
		// 2. Target is in range
		// 3. NPC has line of sight to target
		// 4. NPC is ready to fire (aim is good enough)
		// 5. NEW: Only fire if we have detected a tank (CanSeeTarget)
		if cooledDown && bestDistance < firingRange && npc.CanSeeTarget && readyToFire {
			// Prepare shell data with a bit of randomness
			// More aggressive NPCs fire faster shells
			shellSpeed := 5.0 + (npc.Aggressiveness * 0.5)

			// Calculate barrel end position (like client's fireShell method)
			barrelLength := 1.5 // BARREL_END_OFFSET from client code
			
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
			barrelTipY := state.Position.Y + 1.0 + (firingDirY * barrelLength) // Y offset for tank height
			barrelTipZ := state.Position.Z + (firingDirZ * barrelLength)

			shellData := ShellData{
				// NEW: Start shell exactly at barrel tip position - matching client behavior
				Position: Position{
					X: barrelTipX,
					Y: barrelTipY,
					Z: barrelTipZ,
				},
				// NEW: Direction must match the barrel direction exactly
				Direction: Position{
					X: firingDirX,
					Y: firingDirY,
					Z: firingDirZ,
				},
				Speed: shellSpeed,
			}

			// Log firing attempt
			log.Printf("NPC %s firing at target %s: distance=%.1f, accuracy=%.2f, inaccuracy=%.3f, shellSpeed=%.1f",
				npc.ID, npc.TargetID, bestDistance, npc.FiringAccuracy, inaccuracy, shellSpeed)

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
			barrelTarget := math.Sin(now * 0.5) * (maxBarrelElevation - minBarrelElevation) / 2
			
			// Apply smooth animation toward target (like client)
			elevationDiff := barrelTarget - state.BarrelElevation
			state.BarrelElevation += elevationDiff * 0.01
		} else {
			// Basic scanning for lower TacticalIQ NPCs with time-based oscillation (like client)
			scanSpeed := 0.002 + (rand.Float64() * 0.001)
			
			// Add oscillating component from client-side code
			oscillation := math.Sin(now * 0.5) * 0.01
			state.TurretRotation += scanSpeed + oscillation
			
			// Simple barrel oscillation
			state.BarrelElevation = -0.4 + math.Sin(now * 0.3) * 0.2
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
	// Fire the shell through the manager (which has its own debouncing)
	_, err := c.manager.FireShell(shellData, npc.ID)
	
	// If there was an error (like debounce rejection), return false
	if err != nil {
		log.Printf("Error firing NPC shell: %v", err)
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
		log.Printf("🤖 Removing NPC tank %s", id)
	}
	c.mutex.Unlock()
}

// RemoveAllNPCs removes all NPCs from the game
func (c *NPCController) RemoveAllNPCs() {
	c.mutex.Lock()
	for id, npc := range c.npcs {
		npc.IsActive = false
		log.Printf("🤖 Removing NPC tank %s", id)
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