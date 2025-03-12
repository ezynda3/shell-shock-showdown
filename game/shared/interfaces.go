package shared

// Position represents a 3D position
type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

// PhysicsManagerInterface defines the methods that can be used by NPCs
type PhysicsManagerInterface interface {
	CheckLineOfSight(fromPos, toPos Position) bool
}
