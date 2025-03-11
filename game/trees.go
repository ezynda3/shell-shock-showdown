package game

import (
	"math"
)

// TreeType represents the type of tree
type TreeType string

const (
	PineTree  TreeType = "pine"
	RoundTree TreeType = "round"
	MixedTree TreeType = "mixed"
)

// Tree represents a tree in the game world
type Tree struct {
	Position Position `json:"position"`
	Type     TreeType `json:"type"`
	Scale    float64  `json:"scale"`
	Radius   float64  `json:"radius"`
}

// TreeMap holds all trees in the game
type TreeMap struct {
	Trees []Tree `json:"trees"`
}

// GameMap represents the entire game map including trees and other static objects
type GameMap struct {
	Trees TreeMap `json:"trees"`
	Rocks RockMap `json:"rocks"`
}

// Global instance of the game map
var gameMap *GameMap

// Initialize the game map
func InitGameMap() *GameMap {
	if gameMap == nil {
		// Initialize empty game map
		gameMap = &GameMap{
			Trees: TreeMap{
				Trees: []Tree{},
			},
			Rocks: RockMap{
				Rocks: []Rock{},
			},
		}

		// Generate trees
		generateTrees()

		// Generate rocks
		rockMap := InitRockMap()
		gameMap.Rocks = *rockMap
	}
	return gameMap
}

// GetGameMap returns the game map instance
func GetGameMap() *GameMap {
	if gameMap == nil {
		return InitGameMap()
	}
	return gameMap
}

// createPineTree creates a pine tree at the specified position
func createPineTree(scale float64, x, z float64) Tree {
	// Create a collider for the tree
	collisionRadius := 1.0 * scale
	tree := Tree{
		Position: Position{X: x, Y: collisionRadius, Z: z},
		Type:     PineTree,
		Scale:    scale,
		Radius:   collisionRadius,
	}
	gameMap.Trees.Trees = append(gameMap.Trees.Trees, tree)
	return tree
}

// createRoundTree creates a round tree at the specified position
func createRoundTree(scale float64, x, z float64) Tree {
	// Create a collider for the tree
	collisionRadius := 1.2 * scale
	tree := Tree{
		Position: Position{X: x, Y: collisionRadius, Z: z},
		Type:     RoundTree,
		Scale:    scale,
		Radius:   collisionRadius,
	}
	gameMap.Trees.Trees = append(gameMap.Trees.Trees, tree)
	return tree
}

// createCircleOfTrees creates a circle of trees with the specified radius and count
func createCircleOfTrees(radius float64, count int, treeType TreeType) {
	for i := 0; i < count; i++ {
		angle := float64(i) / float64(count) * math.Pi * 2
		x := math.Cos(angle) * radius
		z := math.Sin(angle) * radius

		scale := 1.0 + (math.Sin(angle*3)+1)*0.3 // Deterministic scale variation

		if treeType == PineTree {
			createPineTree(scale, x, z)
		} else {
			createRoundTree(scale, x, z)
		}
	}
}

// createSacredGrove creates a sacred grove of trees
func createSacredGrove(centerX, centerZ, radius float64, count int) {
	for i := 0; i < count; i++ {
		angle := float64(i) / float64(count) * math.Pi * 2
		x := centerX + math.Cos(angle)*radius
		z := centerZ + math.Sin(angle)*radius

		scale := 1.5 // All trees same size

		if i%2 == 0 {
			createPineTree(scale, x, z)
		} else {
			createRoundTree(scale, x, z)
		}
	}
}

// noise2D implements 2D improved Perlin noise (same as in trees.ts)
func noise2D(x, y float64, seed int) float64 {
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

// fbm implements Fractal Brownian Motion (same as in trees.ts)
func fbm(x, y float64, octaves int, lacunarity, persistence float64, seed int) float64 {
	var total float64 = 0
	frequency := 0.005 // Base frequency - controls pattern scale
	amplitude := 1.0
	var maxValue float64 = 0

	for i := 0; i < octaves; i++ {
		// Add noise at current frequency and amplitude
		total += noise2D(x*frequency, y*frequency, seed+i*1000) * amplitude
		maxValue += amplitude

		// Increase frequency and decrease amplitude for next octave
		frequency *= lacunarity
		amplitude *= persistence
	}

	// Normalize to [0, 1]
	return total / maxValue
}

// treeNoiseValue calculates tree density at a given position
func treeNoiseValue(x, y float64, biomeScale float64, foliageType TreeType) (value float64, treeType TreeType) {
	// Large-scale biome variation
	biomeNoise := fbm(x, y, 3, 2.0, 0.5, 42)

	// Medium-scale terrain variation
	terrainNoise := fbm(x, y, 4, 2.0, 0.5, 123)

	// Small-scale details
	detailNoise := fbm(x, y, 6, 2.2, 0.6, 987)

	// Combine noise layers with different weights
	combinedNoise := biomeNoise*0.4 + terrainNoise*0.4 + detailNoise*0.2

	// Scale by biome factor
	scaledNoise := combinedNoise * biomeScale

	// Determine tree type
	if foliageType == PineTree {
		treeType = PineTree
	} else if foliageType == RoundTree {
		treeType = RoundTree
	} else {
		// For mixed forests, use separate noise function to determine type
		typeNoise := fbm(x, y, 2, 2.5, 0.5, 789)
		if typeNoise > 0.5 {
			treeType = PineTree
		} else {
			treeType = RoundTree
		}
	}

	return scaledNoise, treeType
}

// createTreeFromNoise creates a tree based on a noise threshold
func createTreeFromNoise(x, z, densityThreshold, scaleBase, biomeScale float64, foliageType TreeType) {
	// Get noise value at this position
	noiseValue, treeType := treeNoiseValue(x, z, biomeScale, foliageType)

	// Only place trees where noise value exceeds threshold
	if noiseValue > densityThreshold {
		// Scale varies deterministically based on position
		scale := scaleBase + fbm(x, z, 3, 2.0, 0.5, 555)*0.5

		// Create the appropriate tree type
		if treeType == PineTree {
			createPineTree(scale, x, z)
		} else {
			createRoundTree(scale, x, z)
		}
	}
}

// generateTrees generates all the trees in the game map
func generateTrees() {
	// 1. Trees surrounding the starting area (using circles for consistent gameplay)
	createCircleOfTrees(30, 10, PineTree)  // Inner ring of pine trees
	createCircleOfTrees(45, 12, RoundTree) // Middle ring of round trees
	createCircleOfTrees(60, 16, PineTree)  // Outer ring of pine trees

	// 2. Sacred groves at key locations (preserved for gameplay landmarks)
	createSacredGrove(200, 200, 40, 12)
	createSacredGrove(-200, -200, 40, 12)
	createSacredGrove(200, -200, 40, 12)
	createSacredGrove(-200, 200, 40, 12)

	// 3. Forests using fractal noise patterns

	// North Forest - Pine dominant biome
	for x := -400.0; x <= 400.0; x += 20.0 {
		for z := 400.0; z <= 800.0; z += 20.0 {
			createTreeFromNoise(x, z, 0.55, 1.2, 1.2, PineTree)
		}
	}

	// South Forest - Round dominant biome
	for x := -400.0; x <= 400.0; x += 20.0 {
		for z := -800.0; z <= -400.0; z += 20.0 {
			createTreeFromNoise(x, z, 0.6, 1.0, 1.1, RoundTree)
		}
	}

	// East Forest - Mixed biome (less dense)
	for x := 400.0; x <= 800.0; x += 25.0 {
		for z := -400.0; z <= 400.0; z += 25.0 {
			createTreeFromNoise(x, z, 0.65, 1.1, 0.9, MixedTree)
		}
	}

	// West Forest - Mixed biome (less dense)
	for x := -800.0; x <= -400.0; x += 25.0 {
		for z := -400.0; z <= 400.0; z += 25.0 {
			createTreeFromNoise(x, z, 0.65, 1.1, 0.9, MixedTree)
		}
	}

	// 4. Tree lines - roads through the forests (preserved for navigation)
	// North-South Road
	for z := -1000.0; z <= 1000.0; z += 30.0 {
		createPineTree(1.5, -15, z)
		createPineTree(1.5, 15, z)
	}

	// East-West Road
	for x := -1000.0; x <= 1000.0; x += 30.0 {
		createRoundTree(1.3, x, -15)
		createRoundTree(1.3, x, 15)
	}

	// 5. Distinctive landmarks (preserved for navigation)

	// Large pine tree at origin
	createPineTree(4.0, 0, 100)

	// Circle of 8 large round trees
	for i := 0; i < 8; i++ {
		angle := float64(i) / 8.0 * math.Pi * 2
		createRoundTree(2.5, math.Cos(angle)*120, math.Sin(angle)*120)
	}

	// Spiral of pine trees
	for i := 0; i < 40; i++ {
		angle := float64(i) * 0.5
		radius := 100.0 + float64(i)*5.0
		createPineTree(1.0+float64(i)*0.05, math.Cos(angle)*radius, math.Sin(angle)*radius)
	}

	// Add some extra forest patches in various areas to create more complex patterns
	// Northwest region
	for x := -600.0; x <= -300.0; x += 30.0 {
		for z := 300.0; z <= 600.0; z += 30.0 {
			createTreeFromNoise(x, z, 0.75, 1.3, 0.8, MixedTree)
		}
	}

	// Southeast region
	for x := 300.0; x <= 600.0; x += 30.0 {
		for z := -600.0; z <= -300.0; z += 30.0 {
			createTreeFromNoise(x, z, 0.75, 1.3, 0.8, MixedTree)
		}
	}
}

// GetAllTrees returns all trees in the game map
func GetAllTrees() []Tree {
	return gameMap.Trees.Trees
}
