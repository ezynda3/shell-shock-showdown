package game

import "time"

// Position represents a 3D position
type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

// PlayerState represents the state of a player in the game
type PlayerState struct {
	ID              string       `json:"id"`
	Name            string       `json:"name"`
	Position        Position     `json:"position"`
	TankRotation    float64      `json:"tankRotation"`
	TurretRotation  float64      `json:"turretRotation"`
	BarrelElevation float64      `json:"barrelElevation"`
	Health          int          `json:"health"`
	IsMoving        bool         `json:"isMoving"`
	Velocity        float64      `json:"velocity"`
	Timestamp       int64        `json:"timestamp"`
	Color           string       `json:"color,omitempty"`
	IsDestroyed     bool         `json:"isDestroyed"`
	Status          PlayerStatus `json:"status"`                  // Player's current state in the game
	Kills           int          `json:"kills"`                   // Number of kills
	Deaths          int          `json:"deaths"`                  // Number of deaths
	TrackRotation   float64      `json:"trackRotation"`           // Track animation speed for client visualization
	LastKilledBy    string       `json:"lastKilledBy,omitempty"`  // ID of player who last killed this player
	LastDeathTime   int64        `json:"lastDeathTime,omitempty"` // Timestamp when player was last killed
	Notification    string       `json:"notification,omitempty"`  // Kill notification message for client
}

// ShellState represents the state of a shell
type ShellState struct {
	ID        string   `json:"id"`
	PlayerID  string   `json:"playerId"`
	Position  Position `json:"position"`
	Direction Position `json:"direction"`
	Speed     float64  `json:"speed"`
	Timestamp int64    `json:"timestamp"`
}

// GameState represents the state of the entire game
type GameState struct {
	Players map[string]PlayerState `json:"players"`
	Shells  []ShellState           `json:"shells"`
}

// EventType represents the type of game event
type EventType string

// Event types
const (
	EventPlayerUpdate EventType = "PLAYER_UPDATE"
	EventShellFired   EventType = "SHELL_FIRED"
	EventTankHit      EventType = "TANK_HIT"
	EventTankDeath    EventType = "TANK_DEATH"
	EventTankRespawn  EventType = "TANK_RESPAWN"
)

// GameEvent represents a consolidated game event
type GameEvent struct {
	Type      EventType   `json:"type"`
	Data      interface{} `json:"data"`
	PlayerID  string      `json:"playerId,omitempty"`
	Timestamp int64       `json:"timestamp"`
}

// HitData represents a tank hit event
type HitData struct {
	TargetID     string `json:"targetId"`
	SourceID     string `json:"sourceId"`
	DamageAmount int    `json:"damageAmount"`
	HitLocation  string `json:"hitLocation"` // Part of tank that was hit (turret, body, tracks)
	Timestamp    int64  `json:"timestamp"`   // When the hit occurred (server time)
}

// RespawnData represents a tank respawn event
type RespawnData struct {
	PlayerID string   `json:"playerId"`
	Position Position `json:"position"`
}

// ShellData represents shell firing data
type ShellData struct {
	Position  Position `json:"position"`
	Direction Position `json:"direction"`
	Speed     float64  `json:"speed"`
}

// PlayerStatus represents the current status of a player in the game lifecycle
type PlayerStatus string

// Player status constants
const (
	StatusReady      PlayerStatus = "READY"      // Player has joined but not yet spawned
	StatusActive     PlayerStatus = "ACTIVE"     // Player is active in the game
	StatusDestroyed  PlayerStatus = "DESTROYED"  // Player's tank has been destroyed, waiting for respawn
	StatusDisconnect PlayerStatus = "DISCONNECT" // Player has disconnected from the game
)

// TimeStamper is a utility function type for getting current time
type TimeStamper func() int64

// DefaultTimeStamper returns the current time in milliseconds
func DefaultTimeStamper() int64 {
	return time.Now().UnixMilli()
}
