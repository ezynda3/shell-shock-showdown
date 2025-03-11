package game

import (
	"math"
)

// RockType represents the type of rock
type RockType string

const (
	StandardRock RockType = "standard"
	DarkRock     RockType = "dark"
)

// RockFormationType represents the type of rock formation
type RockFormationType string

const (
	ClusterFormation  RockFormationType = "cluster"
	MountainFormation RockFormationType = "mountain"
	SpireFormation    RockFormationType = "spire"
)

// Rock represents a rock in the game world
type Rock struct {
	Position  Position          `json:"position"`
	Type      RockType          `json:"type"`
	Size      float64           `json:"size"`
	Rotation  Position          `json:"rotation"`
	Scale     Position          `json:"scale"`
	Radius    float64           `json:"radius"`
	Formation RockFormationType `json:"formation,omitempty"`
}

// RockMap holds all rocks in the game
type RockMap struct {
	Rocks []Rock `json:"rocks"`
}

// Initialize the rock map
func InitRockMap() *RockMap {
	rockMap := &RockMap{
		Rocks: []Rock{},
	}
	generateRocks(rockMap)
	return rockMap
}

// Update the GameMap to include rocks
func (gm *GameMap) AddRocks(rockMap *RockMap) {
	gm.Rocks = *rockMap
}

// Create a rock
func createRock(rockMap *RockMap, size float64, deformSeed float64, x, y, z float64,
	rotation Position, scale Position, rockType RockType, colliderPosition *Position) Rock {

	// Use the largest scale dimension to determine collision radius
	maxScale := math.Max(scale.X, math.Max(scale.Y, scale.Z))
	collisionRadius := size * maxScale * 1.2 // Slightly larger than the visual size

	// Use provided collider position if available, otherwise use the mesh position
	var position Position
	if colliderPosition != nil {
		position = *colliderPosition
	} else {
		position = Position{X: x, Y: y, Z: z}
	}

	rock := Rock{
		Position: position,
		Type:     rockType,
		Size:     size,
		Rotation: rotation,
		Scale:    scale,
		Radius:   collisionRadius,
	}

	rockMap.Rocks = append(rockMap.Rocks, rock)
	return rock
}

// Create a rock cluster
func createRockCluster(rockMap *RockMap, centerX, centerZ float64, seed int) {
	// Create 5 rocks in a deterministic pattern
	rockCount := 5

	for i := 0; i < rockCount; i++ {
		// Use the seed and index to create deterministic positions
		angle := float64(i) / float64(rockCount) * math.Pi * 2
		distance := 1 + math.Sin(float64(seed)+float64(i))*0.5

		x := math.Cos(angle) * distance
		z := math.Sin(angle) * distance
		y := 0.2 + math.Sin(float64(seed)*float64(i+1))*0.3

		// Deterministic rotation based on position
		rotX := math.Sin(float64(seed)+float64(i)) * math.Pi
		rotY := math.Cos(float64(seed)+float64(i*2)) * math.Pi
		rotZ := math.Sin(float64(seed)+float64(i*3)) * math.Pi

		// Deterministic scale based on position
		baseScale := 0.8 + math.Sin(float64(seed)*float64(i))*0.7
		scaleX := baseScale
		scaleY := baseScale * 0.8
		scaleZ := baseScale * 1.2

		// Alternate materials
		rockType := StandardRock
		if i%2 == 0 {
			rockType = StandardRock
		} else {
			rockType = DarkRock
		}

		// Calculate absolute position (local rock position + cluster position)
		absX := x + centerX
		absY := y
		absZ := z + centerZ

		// Create the rock
		colliderPosition := Position{X: absX, Y: absY, Z: absZ}
		createRock(
			rockMap,
			0.5+math.Sin(float64(seed)+float64(i*7))*0.3, // Size
			float64(seed)+float64(i),                     // Deform seed
			x, y, z,                                      // Local Position
			Position{X: rotX, Y: rotY, Z: rotZ},       // Rotation
			Position{X: scaleX, Y: scaleY, Z: scaleZ}, // Scale
			rockType,
			&colliderPosition,
		)
	}
}

// Create a stone circle
func createStoneCircle(rockMap *RockMap, centerX, centerZ, radius float64, count, seed int) {
	for i := 0; i < count; i++ {
		angle := float64(i) / float64(count) * math.Pi * 2
		x := centerX + math.Cos(angle)*radius
		z := centerZ + math.Sin(angle)*radius
		createRockCluster(rockMap, x, z, seed+i)
	}
}

// Create a rock spire
func createRockSpire(rockMap *RockMap, x, z, height float64, seed int) {
	// Create a series of stacked rocks with decreasing size
	segments := 8
	baseSize := 2.0

	for i := 0; i < segments; i++ {
		// Each segment gets smaller as we go up
		segmentSize := baseSize * (1 - float64(i)/float64(segments)*0.7)
		segmentHeight := height / float64(segments)
		y := float64(i) * segmentHeight

		// Add some offset for natural look, but keep it deterministic
		xOffset := math.Cos(float64(seed)+float64(i)*0.5) * segmentSize * 0.3
		zOffset := math.Sin(float64(seed)+float64(i)*1.2) * segmentSize * 0.3

		// Alternate materials for visual interest
		rockType := StandardRock
		if i%2 == 0 {
			rockType = StandardRock
		} else {
			rockType = DarkRock
		}

		// Create the rock with deterministic variation
		createRock(
			rockMap,
			segmentSize,
			float64(seed+i),
			xOffset, y, zOffset,
			Position{
				X: math.Sin(float64(i)*0.3+float64(seed)) * math.Pi,
				Y: math.Sin(float64(i)*0.7+float64(seed)) * math.Pi * 2,
				Z: math.Sin(float64(i)*0.5+float64(seed)) * math.Pi,
			},
			Position{X: 1.0, Y: 0.8, Z: 1.0},
			rockType,
			&Position{X: x, Y: height / 2, Z: z}, // Collider for the entire spire
		)
	}

	// Add a distinctive top piece
	createRock(
		rockMap,
		baseSize*0.3,
		float64(seed+100),
		0, height, 0,
		Position{X: 0, Y: 0, Z: 0},
		Position{X: 2.0, Y: 1.5, Z: 2.0},
		StandardRock,
		&Position{X: x, Y: height / 2, Z: z}, // Collider for the entire spire
	)
}

// Same noise2D function as in trees.go, but renamed to avoid conflicts
func rockNoise2D(x, y float64, seed int) float64 {
	// Deterministic pseudo-random number generator based on position and seed
	permute := func(i int) int {
		return ((i * 34) + seed*6547 + 12345) % 289
	}

	// Grid cell coordinates
	ix := int(math.Floor(x))
	iy := int(math.Floor(y))

	// Fractional parts
	fx := x - float64(ix)
	fy := y - float64(iy)

	// Smoothing function
	fade := func(t float64) float64 {
		return t * t * t * (t*(t*6-15) + 10)
	}

	// Grid cell indices
	a := permute(ix) + permute(iy)
	b := permute(ix+1) + permute(iy)
	c := permute(ix) + permute(iy+1)
	d := permute(ix+1) + permute(iy+1)

	// Gradient selection
	getGrad := func(h int, x, y float64) float64 {
		h1 := h % 4
		var u, v float64
		if h1 < 2 {
			u, v = x, y
		} else {
			u, v = y, x
		}
		if h1&1 != 0 {
			u = -u
		}
		if h1&2 != 0 {
			v = -v * 2
		} else {
			v = v * 2
		}
		return u + v
	}

	// Gradient values
	ga := getGrad(a, fx, fy)
	gb := getGrad(b, fx-1, fy)
	gc := getGrad(c, fx, fy-1)
	gd := getGrad(d, fx-1, fy-1)

	// Interpolation
	u := fade(fx)
	v := fade(fy)

	// Blend gradients
	result := (1-u)*((1-v)*ga+v*gc) + u*((1-v)*gb+v*gd)

	// Normalize to [0, 1] range
	return (result + 1) * 0.5
}

// Fractal Brownian Motion (fBm) specific for rocks
func rockFbm(x, y float64, octaves int, lacunarity, persistence float64, seed int) float64 {
	var total float64 = 0
	frequency := 0.005 // Base frequency - controls pattern scale
	amplitude := 1.0
	var maxValue float64 = 0

	for i := 0; i < octaves; i++ {
		// Add noise at current frequency and amplitude
		total += rockNoise2D(x*frequency, y*frequency, seed+i*1000) * amplitude
		maxValue += amplitude

		// Increase frequency and decrease amplitude for next octave
		frequency *= lacunarity
		amplitude *= persistence
	}

	// Normalize to [0, 1]
	return total / maxValue
}

// Rock noise value calculator
type RockNoiseResult struct {
	Value  float64
	Size   float64
	Height float64
	Type   RockType
}

// Calculate rock formation density at a given position
func rockNoiseValue(x, y float64, biomeScale float64, heightScale float64) RockNoiseResult {
	// Use different seeds from tree noise to create distinct patterns
	// Large-scale mountain ranges and geological features
	mountainRangeNoise := rockFbm(x, y, 2, 2.0, 0.5, 234)

	// Medium-scale rock formations
	formationNoise := rockFbm(x, y, 3, 2.2, 0.5, 567)

	// Small-scale rock clusters and details
	clusterNoise := rockFbm(x, y, 4, 2.5, 0.6, 789)

	// Combine noise layers with different weights
	combinedNoise :=
		mountainRangeNoise*0.5 +
			formationNoise*0.3 +
			clusterNoise*0.2

	// Scale by biome factor
	scaledNoise := combinedNoise * biomeScale

	// Determine rock size based on noise
	sizeNoise := rockFbm(x, y, 2, 2.0, 0.5, 987)
	size := (0.7 + sizeNoise*1.3) * biomeScale

	// Determine rock height based on separate noise
	heightNoise := rockFbm(x, y, 3, 1.8, 0.6, 654)
	height := (0.5 + heightNoise*0.8) * heightScale

	// Determine rock type based on position
	typeNoise := rockFbm(x, y, 2, 2.5, 0.5, 321)
	rockType := StandardRock
	if typeNoise > 0.5 {
		rockType = StandardRock
	} else {
		rockType = DarkRock
	}

	return RockNoiseResult{
		Value:  scaledNoise,
		Size:   size,
		Height: height,
		Type:   rockType,
	}
}

// Create a rock formation based on noise patterns
func createRockFormationFromNoise(rockMap *RockMap, x, z, densityThreshold, biomeScale, heightScale float64, formationType RockFormationType) {
	// Get noise value at this position
	noise := rockNoiseValue(x, z, biomeScale, heightScale)

	// Only place rocks where noise value exceeds threshold
	if noise.Value > densityThreshold {
		// Use noise to determine formation characteristics
		seed := int(math.Floor((x*1000 + z) * noise.Value))

		if formationType == ClusterFormation {
			createRockCluster(rockMap, x, z, seed)
		} else if formationType == SpireFormation && noise.Value > densityThreshold+0.1 {
			// For spires, use a higher threshold to make them more rare
			spireHeight := 5 + noise.Height*15
			createRockSpire(rockMap, x, z, spireHeight, seed)
		} else if formationType == MountainFormation && noise.Value > densityThreshold+0.2 {
			// For mountains, use an even higher threshold
			if rockFbm(x, z, 2, 2.0, 0.5, 111) > 0.75 {
				// Create a mountain peak
				createRockMountainPeak(rockMap, x, z, 80+noise.Height*150, 40+noise.Size*60, seed)
			} else if rockFbm(x, z, 2, 2.0, 0.5, 222) > 0.85 {
				// Create balanced rocks
				createBalancedRocks(rockMap, x, z, 10+noise.Height*10, seed)
			} else {
				// Create a rock arch
				createRockArch(
					rockMap,
					x, z,
					10+noise.Size*20,  // width
					5+noise.Height*10, // height
					5+noise.Size*10,   // depth
					rockFbm(x, z, 1, 1.0, 0.5, 333)*math.Pi*2, // rotation
					seed,
				)
			}
		}
	}
}

// Create a mountain peak
func createRockMountainPeak(rockMap *RockMap, x, z, height, radius float64, seed int) {
	// Add a collider for the mountain
	colliderPosition := Position{X: x, Y: height * 0.5, Z: z}

	// Create the mountain peak as a single collider with appropriate radius
	rock := Rock{
		Position:  colliderPosition,
		Type:      StandardRock,
		Size:      radius,
		Rotation:  Position{X: 0, Y: 0, Z: 0},
		Scale:     Position{X: 1.0, Y: 1.0, Z: 1.0},
		Radius:    radius * 0.8,
		Formation: MountainFormation,
	}

	rockMap.Rocks = append(rockMap.Rocks, rock)
}

// Create balanced rocks
func createBalancedRocks(rockMap *RockMap, x, z, height float64, seed int) {
	// Base rock - larger, flatter
	createRock(
		rockMap,
		3.0, // Size
		float64(seed),
		0, 1.5, 0, // Position
		Position{X: 0, Y: 0, Z: 0},       // No rotation for stability
		Position{X: 2.0, Y: 1.0, Z: 2.0}, // Flatter shape
		DarkRock,
		&Position{X: x, Y: height / 2, Z: z},
	)

	// Middle rock - medium sized, slightly offset
	createRock(
		rockMap,
		2.0, // Size
		float64(seed+10),
		math.Sin(float64(seed))*0.5, 3.0, math.Cos(float64(seed))*0.5, // Slight offset
		Position{
			X: math.Sin(float64(seed+5)) * 0.3,
			Y: math.Sin(float64(seed+6)) * 0.3,
			Z: math.Sin(float64(seed+7)) * 0.3,
		},
		Position{X: 1.5, Y: 1.2, Z: 1.5},
		StandardRock,
		&Position{X: x, Y: height / 2, Z: z},
	)

	// Top rock - smaller, more precariously balanced
	createRock(
		rockMap,
		1.5, // Size
		float64(seed+20),
		math.Sin(float64(seed+10))*0.8, 5.0, math.Cos(float64(seed+10))*0.8, // More offset
		Position{
			X: math.Sin(float64(seed+15)) * 0.5,
			Y: math.Sin(float64(seed+16)) * 0.5,
			Z: math.Sin(float64(seed+17)) * 0.5,
		},
		Position{X: 1.2, Y: 1.0, Z: 1.2},
		DarkRock,
		&Position{X: x, Y: height / 2, Z: z},
	)

	// Optional: extremely small rock on very top for dramatic effect
	if math.Sin(float64(seed+30)) > 0 { // 50% chance based on seed
		createRock(
			rockMap,
			0.7, // Size
			float64(seed+30),
			math.Sin(float64(seed+20))*0.3, 6.0, math.Cos(float64(seed+20))*0.3,
			Position{
				X: math.Sin(float64(seed+25)) * 1.0,
				Y: math.Sin(float64(seed+26)) * 1.0,
				Z: math.Sin(float64(seed+27)) * 1.0,
			},
			Position{X: 0.8, Y: 0.8, Z: 0.8},
			StandardRock,
			&Position{X: x, Y: height / 2, Z: z},
		)
	}
}

// Create a rock arch
func createRockArch(rockMap *RockMap, x, z, width, height, depth, rotation float64, seed int) {
	// Create a simplified representation of the arch
	// Add colliders for the pillars
	leftColliderPos := Position{
		X: x - math.Cos(rotation)*(width/2-width*0.075),
		Y: height * 0.4,
		Z: z - math.Sin(rotation)*(width/2-width*0.075),
	}

	rightColliderPos := Position{
		X: x + math.Cos(rotation)*(width/2-width*0.075),
		Y: height * 0.4,
		Z: z + math.Sin(rotation)*(width/2-width*0.075),
	}

	// Left pillar
	createRock(
		rockMap,
		width*0.15, // Size based on arch width
		float64(seed),
		0, 0, 0, // Position - using collider position
		Position{X: 0, Y: 0, Z: 0},
		Position{X: 1.0, Y: height * 0.8 / (width * 0.15), Z: depth * 0.3 / (width * 0.15)},
		StandardRock,
		&leftColliderPos,
	)

	// Right pillar
	createRock(
		rockMap,
		width*0.15, // Size based on arch width
		float64(seed+1),
		0, 0, 0, // Position - using collider position
		Position{X: 0, Y: 0, Z: 0},
		Position{X: 1.0, Y: height * 0.8 / (width * 0.15), Z: depth * 0.3 / (width * 0.15)},
		StandardRock,
		&rightColliderPos,
	)

	// Arch top
	archTopCollider := Position{
		X: x,
		Y: height * 0.9,
		Z: z,
	}

	createRock(
		rockMap,
		width*0.4, // Size based on arch width
		float64(seed+2),
		0, 0, 0, // Position - using collider position
		Position{X: 0, Y: rotation, Z: 0}, // Use rotation parameter for Y rotation
		Position{X: 1.0, Y: 0.3, Z: depth * 0.3 / (width * 0.4)},
		DarkRock,
		&archTopCollider,
	)
}

// Create smaller individual rock based on noise
func createSmallRockFromNoise(rockMap *RockMap, x, z, densityThreshold, biomeScale float64) {
	// Get noise value at this position
	noise := rockNoiseValue(x, z, biomeScale, 1.0)

	// Only place rocks where noise value exceeds threshold
	if noise.Value > densityThreshold {
		// Size based on noise
		size := 0.3 + noise.Size*0.7

		// Position with slight y-variation for more natural look
		y := 0.2 + noise.Height*0.6

		// Rotation based on position
		seed := int(math.Floor((x*1000 + z) * noise.Value))
		rotX := math.Sin(float64(seed)*0.1) * math.Pi
		rotY := math.Cos(float64(seed)*0.2) * math.Pi
		rotZ := math.Sin(float64(seed)*0.3) * math.Pi

		// Scale variation
		scaleX := 0.8 + rockFbm(x, z, 2, 2.0, 0.5, 444)*0.4
		scaleY := 0.8 + rockFbm(x, z, 2, 2.0, 0.5, 555)*0.4
		scaleZ := 0.8 + rockFbm(x, z, 2, 2.0, 0.5, 666)*0.4

		// Create the rock
		createRock(
			rockMap,
			size,
			float64(seed),
			x, y, z,
			Position{X: rotX, Y: rotY, Z: rotZ},
			Position{X: scaleX, Y: scaleY, Z: scaleZ},
			noise.Type,
			nil,
		)
	}
}

// Create a rock wall segment
func createRockWall(rockMap *RockMap, startX, startZ, endX, endZ, height float64, seed int) {
	// Calculate direction and length
	dirX := endX - startX
	dirZ := endZ - startZ
	length := math.Sqrt(dirX*dirX + dirZ*dirZ)

	// Normalize direction
	if length > 0 {
		dirX = dirX / length
		dirZ = dirZ / length
	}

	// Create a simplified representation with just a few colliders
	segments := 4 // Number of collider segments
	for i := 0; i < segments; i++ {
		t := float64(i) / float64(segments)
		x := startX + (endX-startX)*t
		z := startZ + (endZ-startZ)*t

		colliderPosition := Position{X: x, Y: height / 2, Z: z}
		segmentLength := length / float64(segments)

		// Create a rock for each segment
		createRock(
			rockMap,
			segmentLength/2, // Size - radius covers half the segment length
			float64(seed+i),
			x, height/2, z, // Position
			Position{X: 0, Y: math.Atan2(dirZ, dirX), Z: 0}, // Rotation along wall direction
			Position{X: 1.0, Y: height / (segmentLength / 2), Z: 1.0},
			func() RockType {
				if i%2 == 0 {
					return StandardRock
				}
				return DarkRock
			}(),
			&colliderPosition,
		)
	}
}

// Generate all rocks in the game map
func generateRocks(rockMap *RockMap) {
	// 1. Rocks near the tank starting area
	// Keep the deterministic circle of rocks for gameplay consistency
	for i := 0; i < 8; i++ {
		angle := float64(i) / 8.0 * math.Pi * 2
		x := math.Cos(angle) * 20 // Closer to center than trees
		z := math.Sin(angle) * 20
		createRockCluster(rockMap, x, z, i)
	}

	// 2. Rock formations in geometric patterns
	// Keep important gameplay landmarks

	// Square formation at corners
	for i := 0; i < 4; i++ {
		x := -100.0
		if i < 2 {
			x = -100.0
		} else {
			x = 100.0
		}

		z := -100.0
		if i%2 == 0 {
			z = -100.0
		} else {
			z = 100.0
		}

		createRockCluster(rockMap, x, z, i+10)
	}

	// 3. Mountain Ranges and Rock Formations - using fractal noise patterns

	// Northern mountain region
	for x := -400.0; x <= 400.0; x += 30 {
		for z := 280.0; z <= 400.0; z += 30 {
			createRockFormationFromNoise(rockMap, x, z, 0.65, 1.2, 1.1, ClusterFormation)
		}
	}

	// Northern mountain peaks (more sparse)
	for x := -350.0; x <= 350.0; x += 60 {
		for z := 420.0; z <= 550.0; z += 60 {
			createRockFormationFromNoise(rockMap, x, z, 0.7, 1.0, 1.2, MountainFormation)
		}
	}

	// Eastern mountain region
	for x := 280.0; x <= 400.0; x += 30 {
		for z := -400.0; z <= 400.0; z += 30 {
			createRockFormationFromNoise(rockMap, x, z, 0.65, 1.2, 1.1, ClusterFormation)
		}
	}

	// Eastern mountain peaks (more sparse)
	for x := 420.0; x <= 550.0; x += 60 {
		for z := -350.0; z <= 350.0; z += 60 {
			createRockFormationFromNoise(rockMap, x, z, 0.7, 1.0, 1.2, MountainFormation)
		}
	}

	// Southern rock region
	for x := -400.0; x <= 400.0; x += 30 {
		for z := -400.0; z >= -550.0; z -= 30 {
			createRockFormationFromNoise(rockMap, x, z, 0.68, 0.9, 0.9, ClusterFormation)
		}
	}

	// Western rock region
	for x := -400.0; x >= -550.0; x -= 30 {
		for z := -400.0; z <= 400.0; z += 30 {
			createRockFormationFromNoise(rockMap, x, z, 0.68, 0.9, 0.9, ClusterFormation)
		}
	}

	// Scattered rock spires in all regions
	for x := -600.0; x <= 600.0; x += 150 {
		for z := -600.0; z <= 600.0; z += 150 {
			// Use a higher threshold to make them more rare
			offsetX := rockFbm(x, z, 2, 2.0, 0.5, 777)*50 - 25
			offsetZ := rockFbm(z, x, 2, 2.0, 0.5, 888)*50 - 25
			createRockFormationFromNoise(
				rockMap,
				x+offsetX,
				z+offsetZ,
				0.75, 0.8, 1.3, SpireFormation,
			)
		}
	}

	// 4. Stone Circles - ceremonial-looking formations at key locations (preserved for gameplay)
	createStoneCircle(rockMap, 500, 500, 50, 12, 400)
	createStoneCircle(rockMap, -500, 500, 50, 12, 500)
	createStoneCircle(rockMap, 500, -500, 50, 12, 600)
	createStoneCircle(rockMap, -500, -500, 50, 12, 700)

	// 5. Scattered small rocks throughout the map using noise pattern
	gridSize := 100.0 // Size of the grid for small rock distribution
	for x := -800.0; x <= 800.0; x += gridSize {
		for z := -800.0; z <= 800.0; z += gridSize {
			// For each grid cell, place several potential rocks
			for i := 0; i < 5; i++ {
				// Use noise to offset position within grid cell
				offsetX := rockFbm(x+float64(i), z, 2, 2.0, 0.5, 999+i) * gridSize
				offsetZ := rockFbm(x, z+float64(i), 2, 2.0, 0.5, 1000+i) * gridSize

				// Create small rock if noise value high enough
				createSmallRockFromNoise(
					rockMap,
					x+offsetX,
					z+offsetZ,
					0.72, // High threshold for sparse distribution
					0.9,
				)
			}
		}
	}

	// 9. Rock ridge lines for more interesting topography
	// Create ridge lines using noise to determine location and properties
	for x := -600.0; x <= 600.0; x += 200 {
		for z := -600.0; z <= 600.0; z += 200 {
			// Only place ridge if noise value high enough
			ridgeNoise := rockFbm(x, z, 3, 2.0, 0.5, 123)
			if ridgeNoise > 0.6 {
				// Use noise to determine ridge direction and length
				angle := rockFbm(x, z, 2, 2.0, 0.5, 456) * math.Pi * 2
				length := 50 + rockFbm(x, z, 2, 2.0, 0.5, 789)*100

				// Calculate start and end points
				startX := x - math.Cos(angle)*length/2
				startZ := z - math.Sin(angle)*length/2
				endX := x + math.Cos(angle)*length/2
				endZ := z + math.Sin(angle)*length/2

				// Height based on noise
				height := 5 + rockFbm(x, z, 2, 2.0, 0.5, 321)*10

				// Create the rock wall
				createRockWall(rockMap, startX, startZ, endX, endZ, height, int(math.Floor(x*z)))
			}
		}
	}
}
