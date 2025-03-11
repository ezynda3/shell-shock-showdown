package game

import (
	"fmt"
	"log"
	"math"
	"math/rand"
	"strings"
	"sync"
	"time"
)

// NPCController manages NPC tanks
type NPCController struct {
	manager      *Manager
	npcs         map[string]*NPCTank
	mutex        sync.RWMutex
	gameMap      *GameMap
	physicsDelay time.Duration
	isRunning    bool
	quit         chan struct{} // Channel to signal shutdown
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
}

// NewNPCController creates a new NPC controller
func NewNPCController(manager *Manager, gameMap *GameMap) *NPCController {
	return &NPCController{
		manager:      manager,
		npcs:         make(map[string]*NPCTank),
		mutex:        sync.RWMutex{},
		gameMap:      gameMap,
		physicsDelay: 100 * time.Millisecond, // Delay between physics updates
		isRunning:    false,
		quit:         make(chan struct{}),
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

// SpawnNPC creates a new NPC tank
func (c *NPCController) SpawnNPC(name string, movementPattern MovementPattern) *NPCTank {
	c.mutex.Lock()
	defer c.mutex.Unlock()

	// Generate an NPC ID with a prefix to distinguish from players
	npcID := fmt.Sprintf("npc_%s_%d", name, time.Now().UnixNano())

	// Create tank position (away from players)
	offsetX := -200.0 + rand.Float64()*400.0
	offsetZ := -200.0 + rand.Float64()*400.0

	// Create initial state
	state := PlayerState{
		ID:             npcID,
		Name:           "NPC-" + name,
		Position:       Position{X: offsetX, Y: 0, Z: offsetZ},
		TankRotation:   rand.Float64() * 2 * math.Pi,
		TurretRotation: rand.Float64() * 2 * math.Pi,
		Health:         100,
		IsMoving:       true,     // Start moving immediately
		Velocity:       1.5,      // Higher initial velocity
		Timestamp:      time.Now().UnixMilli(),
		Color:          c.manager.getPlayerColor(npcID),
		IsDestroyed:    false,
	}

	// Create patrol points if using patrol pattern
	var patrolPoints []Position
	if movementPattern == PatrolMovement {
		// Create a square patrol route
		size := 50.0 + rand.Float64()*50.0
		patrolPoints = []Position{
			{X: offsetX + size, Y: 0, Z: offsetZ + size},
			{X: offsetX + size, Y: 0, Z: offsetZ - size},
			{X: offsetX - size, Y: 0, Z: offsetZ - size},
			{X: offsetX - size, Y: 0, Z: offsetZ + size},
		}
	}

	npc := &NPCTank{
		ID:              npcID,
		Name:            "NPC-" + name,
		State:           state,
		MovementPattern: movementPattern,
		PatrolPoints:    patrolPoints,
		CurrentPoint:    0,
		LastUpdate:      time.Now(),
		LastFire:        time.Now(),
		FireCooldown:    time.Duration(1+rand.Float64()*2) * time.Second, // 1-3 second cooldown (more aggressive)
		ScanRadius:      250.0,                                           // Larger detection radius
		IsActive:        true,
	}

	// Add to NPC map
	c.npcs[npcID] = npc

	// Register with game manager
	if err := c.manager.UpdatePlayer(state, npcID, "NPC-"+name); err != nil {
		log.Printf("Error registering NPC tank: %v", err)
	}

	log.Printf("🤖 Spawned NPC tank %s (%s) at position (%f, %f, %f)",
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
						X: -200.0 + rand.Float64()*400.0,
						Y: 0,
						Z: -200.0 + rand.Float64()*400.0,
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

	// Look for nearby players to target
	c.findTarget(npc, gameState)

	// Update movement based on pattern
	c.updateMovement(npc, &state)

	// Update aiming and firing
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

// findTarget looks for the nearest player to target
func (c *NPCController) findTarget(npc *NPCTank, gameState GameState) {
	var nearestDist float64 = npc.ScanRadius
	var nearestID string

	// Find closest non-NPC player tank
	for playerID, player := range gameState.Players {
		// Skip other NPCs and destroyed tanks
		if playerID == npc.ID || playerID[:4] == "npc_" || player.IsDestroyed {
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
	// Fixed speed that's guaranteed to move
	speed := 2.0 // Faster movement

	// Gradually turn (simple circle approximation)
	turnAmount := 0.01 * speed
	state.TankRotation += turnAmount

	// Normalize angle
	state.TankRotation = normalizeAngle(state.TankRotation)

	// Always be moving
	state.IsMoving = true
	state.Velocity = speed

	// IMPORTANT: Actually update the position based on rotation and velocity
	// Calculate movement vector based on tank rotation
	moveX := math.Cos(state.TankRotation) * speed
	moveZ := math.Sin(state.TankRotation) * speed
	
	// Update position by applying movement vector
	state.Position.X += moveX
	state.Position.Z += moveZ
	
	// Log movement occasionally to reduce log spam
	if rand.Float64() < 0.01 {
		log.Printf("NPC tank %s moving in circle: pos=(%.2f,%.2f), rotation=%.2f, velocity=%.2f", 
			npc.ID, state.Position.X, state.Position.Z, state.TankRotation, state.Velocity)
	}
}

// moveInZigzag makes the NPC move in a zigzag pattern
func (c *NPCController) moveInZigzag(npc *NPCTank, state *PlayerState) {
	// Get current time for basic oscillation
	now := float64(time.Now().UnixNano()) / 1e9

	// Use sine of time to change direction for zigzag motion
	oscillation := math.Sin(now*2.0) * 0.1

	// Apply the oscillation to the tank's rotation
	state.TankRotation += oscillation

	// Always be moving
	state.IsMoving = true
	state.Velocity = 2.0 // Faster movement
	speed := state.Velocity

	// IMPORTANT: Actually update the position based on rotation and velocity
	// Calculate movement vector based on tank rotation
	moveX := math.Cos(state.TankRotation) * speed
	moveZ := math.Sin(state.TankRotation) * speed
	
	// Update position by applying movement vector
	state.Position.X += moveX
	state.Position.Z += moveZ
	
	// Log movement occasionally to reduce log spam
	if rand.Float64() < 0.01 {
		log.Printf("NPC tank %s moving in zigzag: pos=(%.2f,%.2f), rotation=%.2f, oscillation=%.2f", 
			npc.ID, state.Position.X, state.Position.Z, state.TankRotation, oscillation)
	}
}

// moveInPatrol makes the NPC follow patrol points
func (c *NPCController) moveInPatrol(npc *NPCTank, state *PlayerState) {
	if len(npc.PatrolPoints) == 0 {
		// If no patrol points, just move forward
		state.IsMoving = true
		state.Velocity = 1.0
		speed := state.Velocity
		
		// IMPORTANT: Actually update the position based on rotation and velocity
		moveX := math.Cos(state.TankRotation) * speed
		moveZ := math.Sin(state.TankRotation) * speed
		
		state.Position.X += moveX
		state.Position.Z += moveZ
		return
	}

	// Get current target point
	target := npc.PatrolPoints[npc.CurrentPoint]

	// Calculate direction to target
	dx := target.X - state.Position.X
	dz := target.Z - state.Position.Z
	dist := math.Sqrt(dx*dx + dz*dz)

	// Check if reached target point
	if dist < 5.0 {
		// Move to next patrol point
		npc.CurrentPoint = (npc.CurrentPoint + 1) % len(npc.PatrolPoints)
		log.Printf("NPC tank %s reached patrol point, moving to next point %d", 
			npc.ID, npc.CurrentPoint)
	}

	// Calculate angle to target
	targetAngle := math.Atan2(dz, dx)

	// Turn gradually toward target angle
	currentAngle := state.TankRotation
	angleDiff := normalizeAngle(targetAngle - currentAngle)
	
	// Turn at most 0.05 radians per update
	if math.Abs(angleDiff) > 0.05 {
		if angleDiff > 0 {
			state.TankRotation += 0.05
		} else {
			state.TankRotation -= 0.05
		}
	} else {
		state.TankRotation = targetAngle
	}
	
	// Always be moving
	state.IsMoving = true
	state.Velocity = 2.0 // Faster movement
	speed := state.Velocity

	// IMPORTANT: Actually update the position based on rotation and velocity
	moveX := math.Cos(state.TankRotation) * speed
	moveZ := math.Sin(state.TankRotation) * speed
	
	// Update position by applying movement vector
	state.Position.X += moveX
	state.Position.Z += moveZ
	
	// Log movement occasionally to reduce log spam
	if rand.Float64() < 0.01 {
		log.Printf("NPC tank %s patrolling: pos=(%.2f,%.2f), rotation=%.2f, target=(%.2f,%.2f), dist=%.2f", 
			npc.ID, state.Position.X, state.Position.Z, state.TankRotation, 
			target.X, target.Z, dist)
	}
}

// moveRandomly makes the NPC move randomly
func (c *NPCController) moveRandomly(npc *NPCTank, state *PlayerState) {
	// Occasionally change direction (20% chance per update)
	if rand.Float64() < 0.2 {
		// Random rotation change between -PI/4 and PI/4 (45 degrees)
		rotationChange := (rand.Float64() - 0.5) * math.Pi / 2
		state.TankRotation += rotationChange

		// Normalize angle
		state.TankRotation = normalizeAngle(state.TankRotation)

		// Log direction changes occasionally
		if rand.Float64() < 0.1 {
			log.Printf("NPC %s randomly changing direction: rotation=%.2f, change=%.2f",
				npc.ID, state.TankRotation, rotationChange)
		}
	}

	// Always be moving
	state.IsMoving = true
	state.Velocity = 2.0 // Faster movement
	speed := state.Velocity

	// IMPORTANT: Actually update the position based on rotation and velocity
	moveX := math.Cos(state.TankRotation) * speed
	moveZ := math.Sin(state.TankRotation) * speed
	
	// Update position by applying movement vector
	state.Position.X += moveX
	state.Position.Z += moveZ
	
	// Boundary checking - keep NPCs within reasonable game area
	const MAP_BOUND = 250.0  // 250 unit radius around center
	
	// If we're getting too far from center, turn back
	distFromCenter := math.Sqrt(state.Position.X*state.Position.X + state.Position.Z*state.Position.Z)
	if distFromCenter > MAP_BOUND {
		// Calculate angle toward center
		centerAngle := math.Atan2(-state.Position.Z, -state.Position.X)
		
		// Turn toward center
		state.TankRotation = centerAngle
		
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
	// SIMPLIFIED FIRING BEHAVIOR

	// Find any potential target, even without formal targeting
	var nearestTarget *PlayerState
	var nearestDistance float64 = 250.0 // Increased maximum target range

	for playerID, player := range gameState.Players {
		// Skip self, other NPCs, and destroyed tanks
		if playerID == npc.ID || player.IsDestroyed || strings.HasPrefix(playerID, "npc_") {
			continue
		}

		// Calculate distance
		dx := player.Position.X - state.Position.X
		dz := player.Position.Z - state.Position.Z
		dist := math.Sqrt(dx*dx + dz*dz)

		// Track closest player
		if dist < nearestDistance {
			nearestTarget = &player
			nearestDistance = dist
			npc.TargetID = playerID
		}
	}

	// If we have a target, aim and fire
	if nearestTarget != nil {
		// Calculate direction to target
		dx := nearestTarget.Position.X - state.Position.X
		dz := nearestTarget.Position.Z - state.Position.Z
		targetAngle := math.Atan2(dz, dx)

		// Update turret rotation to aim at target
		// Add randomness to make it less precise
		randomOffset := (rand.Float64() - 0.5) * 0.3
		state.TurretRotation = targetAngle + randomOffset

		// Set fixed barrel elevation
		state.BarrelElevation = 0.2

		// FIRE MORE AGGRESSIVELY - More frequent shots
		// Use the NPC's individual fire cooldown
		cooledDown := time.Since(npc.LastFire) > npc.FireCooldown

		// Fire if cooldown has expired - increased firing range
		if cooledDown && nearestDistance < 200 {
			// Prepare shell data
			shellData := ShellData{
				Position: state.Position,
				Direction: Position{
					X: math.Cos(state.TurretRotation),
					Y: math.Sin(state.BarrelElevation),
					Z: math.Sin(state.TurretRotation),
				},
				Speed: 5.0, // Faster shells
			}

			// Log firing attempt
			log.Printf("NPC %s firing at target %s at distance %.2f",
				npc.ID, npc.TargetID, nearestDistance)

			// Fire the shell
			c.mutex.Unlock() // Unlock before calling manager
			if _, err := c.manager.FireShell(shellData, npc.ID); err != nil {
				log.Printf("Error firing NPC shell: %v", err)
			}
			c.mutex.Lock() // Lock again to continue processing

			// Update last fire time
			npc.LastFire = time.Now()
		}
	} else {
		// If no target, just rotate turret to match tank direction
		state.TurretRotation = state.TankRotation
	}
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
