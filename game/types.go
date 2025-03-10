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
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	Position        Position `json:"position"`
	TankRotation    float64  `json:"tankRotation"`
	TurretRotation  float64  `json:"turretRotation"`
	BarrelElevation float64  `json:"barrelElevation"`
	Health          int      `json:"health"`
	IsMoving        bool     `json:"isMoving"`
	Velocity        float64  `json:"velocity"`
	Timestamp       int64    `json:"timestamp"`
	Color           string   `json:"color,omitempty"`
	IsDestroyed     bool     `json:"isDestroyed"`
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

// TimeStamper is a utility function type for getting current time
type TimeStamper func() int64

// DefaultTimeStamper returns the current time in milliseconds
func DefaultTimeStamper() int64 {
	return time.Now().UnixMilli()
}
