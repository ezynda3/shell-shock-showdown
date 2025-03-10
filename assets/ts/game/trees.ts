import * as THREE from 'three';
import { StaticCollider } from './collision';

export class TreeGenerator {
  private scene: THREE.Scene;
  
  // Collider arrays for trees
  private treeColliders: StaticCollider[] = [];
  
  // Materials
  private trunkMaterial: THREE.MeshStandardMaterial;
  private leafMaterial: THREE.MeshStandardMaterial;
  
  constructor(scene: THREE.Scene) {
    this.scene = scene;
    
    // Initialize materials
    this.trunkMaterial = new THREE.MeshStandardMaterial({
      color: 0x8B4513, // Brown
      roughness: 0.9,
      metalness: 0.0
    });
    
    this.leafMaterial = new THREE.MeshStandardMaterial({
      color: 0x2E8B57, // Dark green
      roughness: 0.8,
      metalness: 0.1
    });
  }
  
  // ===== TREE METHODS =====
  
  createPineTree(scale: number, x: number, z: number): StaticCollider {
    const tree = new THREE.Group();
    
    // Tree trunk - reduced segments for lower polygon count
    const trunkGeometry = new THREE.CylinderGeometry(0.2 * scale, 0.3 * scale, 1.5 * scale, 6);
    const trunk = new THREE.Mesh(trunkGeometry, this.trunkMaterial);
    trunk.position.y = 0.75 * scale;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    tree.add(trunk);
    
    // Tree foliage (cones) - reduced segments for lower polygon count
    const foliageGeometry1 = new THREE.ConeGeometry(1 * scale, 2 * scale, 6);
    const foliage1 = new THREE.Mesh(foliageGeometry1, this.leafMaterial);
    foliage1.position.y = 2 * scale;
    foliage1.castShadow = true;
    tree.add(foliage1);
    
    const foliageGeometry2 = new THREE.ConeGeometry(0.8 * scale, 1.8 * scale, 6);
    const foliage2 = new THREE.Mesh(foliageGeometry2, this.leafMaterial);
    foliage2.position.y = 3 * scale;
    foliage2.castShadow = true;
    tree.add(foliage2);
    
    const foliageGeometry3 = new THREE.ConeGeometry(0.6 * scale, 1.6 * scale, 6);
    const foliage3 = new THREE.Mesh(foliageGeometry3, this.leafMaterial);
    foliage3.position.y = 4 * scale;
    foliage3.castShadow = true;
    tree.add(foliage3);
    
    // Position tree
    tree.position.set(x, 0, z);
    
    // Add to scene
    this.scene.add(tree);
    
    // Create a collider for the tree
    const collisionRadius = 1.0 * scale; // Size based on tree scale
    const position = new THREE.Vector3(x, collisionRadius, z);
    const treeCollider = new StaticCollider(position, 'tree', collisionRadius);
    this.treeColliders.push(treeCollider);
    
    return treeCollider;
  }
  
  createRoundTree(scale: number, x: number, z: number): StaticCollider {
    const tree = new THREE.Group();
    
    // Tree trunk - reduced segments
    const trunkGeometry = new THREE.CylinderGeometry(0.2 * scale, 0.3 * scale, 1.5 * scale, 6);
    const trunk = new THREE.Mesh(trunkGeometry, this.trunkMaterial);
    trunk.position.y = 0.75 * scale;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    tree.add(trunk);
    
    // Tree foliage (sphere) - reduced segments
    const foliageGeometry = new THREE.SphereGeometry(1.2 * scale, 6, 6);
    const foliage = new THREE.Mesh(foliageGeometry, this.leafMaterial);
    foliage.position.y = 2.5 * scale;
    foliage.castShadow = true;
    tree.add(foliage);
    
    // Position tree
    tree.position.set(x, 0, z);
    
    // Add to scene
    this.scene.add(tree);
    
    // Create a collider for the tree
    const collisionRadius = 1.2 * scale; // Size based on tree scale
    const position = new THREE.Vector3(x, collisionRadius, z);
    const treeCollider = new StaticCollider(position, 'tree', collisionRadius);
    this.treeColliders.push(treeCollider);
    
    return treeCollider;
  }
  
  createCircleOfTrees(radius: number, count: number, treeType: 'pine' | 'round'): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      
      const scale = 1.0 + (Math.sin(angle * 3) + 1) * 0.3; // Deterministic scale variation
      
      if (treeType === 'pine') {
        this.createPineTree(scale, x, z);
      } else {
        this.createRoundTree(scale, x, z);
      }
    }
  }
  
  createSacredGrove(centerX: number, centerZ: number, radius: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const x = centerX + Math.cos(angle) * radius;
      const z = centerZ + Math.sin(angle) * radius;
      
      const scale = 1.5; // All trees same size
      
      if (i % 2 === 0) {
        this.createPineTree(scale, x, z);
      } else {
        this.createRoundTree(scale, x, z);
      }
    }
  }
  
  // Fractal noise implementation (2D improved Perlin noise)
  private noise2D(x: number, y: number, seed: number = 12345): number {
    // Deterministic pseudo-random number generator based on position and seed
    const permute = (i: number): number => {
      return ((i * 34) + seed * 6547 + 12345) % 289;
    };
    
    // Grid cell coordinates
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    
    // Fractional parts
    const fx = x - ix;
    const fy = y - iy;
    
    // Smoothing function
    const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
    
    // Grid cell indices
    const a = permute(ix) + permute(iy);
    const b = permute(ix + 1) + permute(iy);
    const c = permute(ix) + permute(iy + 1);
    const d = permute(ix + 1) + permute(iy + 1);
    
    // Gradient selection
    const getGrad = (h: number, x: number, y: number): number => {
      const h1 = h % 4;
      let u = h1 < 2 ? x : y;
      let v = h1 < 2 ? y : x;
      return ((h1 & 1) ? -u : u) + ((h1 & 2) ? -v * 2 : v * 2);
    };
    
    // Gradient values
    const ga = getGrad(a, fx, fy);
    const gb = getGrad(b, fx - 1, fy);
    const gc = getGrad(c, fx, fy - 1);
    const gd = getGrad(d, fx - 1, fy - 1);
    
    // Interpolation
    const u = fade(fx);
    const v = fade(fy);
    
    // Blend gradients
    const result = 
      (1 - u) * ((1 - v) * ga + v * gc) + 
      u * ((1 - v) * gb + v * gd);
    
    // Normalize to [0, 1] range
    return (result + 1) * 0.5;
  }
  
  // Fractal Brownian Motion (fBm) to create multiple octaves of noise
  private fbm(x: number, y: number, octaves: number = 6, lacunarity: number = 2.0, persistence: number = 0.5, seed: number = 12345): number {
    let total = 0;
    let frequency = 0.005; // Base frequency - controls pattern scale
    let amplitude = 1.0;
    let maxValue = 0;
    
    for (let i = 0; i < octaves; i++) {
      // Add noise at current frequency and amplitude
      total += this.noise2D(x * frequency, y * frequency, seed + i * 1000) * amplitude;
      maxValue += amplitude;
      
      // Increase frequency and decrease amplitude for next octave
      frequency *= lacunarity;
      amplitude *= persistence;
    }
    
    // Normalize to [0, 1]
    return total / maxValue;
  }
  
  // Calculate tree density at a given position
  private treeNoiseValue(x: number, y: number, biomeScale: number = 1.0, foliageType: 'pine' | 'round' | 'mixed' = 'mixed'): {value: number, type: 'pine' | 'round'} {
    // Large-scale biome variation
    const biomeNoise = this.fbm(x, y, 3, 2.0, 0.5, 42);
    
    // Medium-scale terrain variation
    const terrainNoise = this.fbm(x, y, 4, 2.0, 0.5, 123);
    
    // Small-scale details
    const detailNoise = this.fbm(x, y, 6, 2.2, 0.6, 987);
    
    // Combine noise layers with different weights
    const combinedNoise = 
      biomeNoise * 0.4 + 
      terrainNoise * 0.4 + 
      detailNoise * 0.2;
    
    // Scale by biome factor
    const scaledNoise = combinedNoise * biomeScale;
    
    // Determine tree type
    let treeType: 'pine' | 'round';
    
    if (foliageType === 'pine') {
      treeType = 'pine';
    } else if (foliageType === 'round') {
      treeType = 'round';
    } else {
      // For mixed forests, use separate noise function to determine type
      const typeNoise = this.fbm(x, y, 2, 2.5, 0.5, 789);
      treeType = typeNoise > 0.5 ? 'pine' : 'round';
    }
    
    return {
      value: scaledNoise,
      type: treeType
    };
  }
  
  // Create a tree based on a noise threshold
  private createTreeFromNoise(x: number, z: number, densityThreshold: number, scaleBase: number, biomeScale: number, foliageType: 'pine' | 'round' | 'mixed'): void {
    // Get noise value at this position
    const noise = this.treeNoiseValue(x, z, biomeScale, foliageType);
    
    // Only place trees where noise value exceeds threshold
    if (noise.value > densityThreshold) {
      // Scale varies deterministically based on position
      const scale = scaleBase + this.fbm(x, z, 3, 2.0, 0.5, 555) * 0.5;
      
      // Create the appropriate tree type
      if (noise.type === 'pine') {
        this.createPineTree(scale, x, z);
      } else {
        this.createRoundTree(scale, x, z);
      }
    }
  }
  
  generateTrees(): void {
    // 1. Trees surrounding the starting area (using circles for consistent gameplay)
    this.createCircleOfTrees(30, 10, 'pine');   // Inner ring of pine trees
    this.createCircleOfTrees(45, 12, 'round');  // Middle ring of round trees
    this.createCircleOfTrees(60, 16, 'pine');   // Outer ring of pine trees
    
    // 2. Sacred groves at key locations (preserved for gameplay landmarks)
    this.createSacredGrove(200, 200, 40, 12);
    this.createSacredGrove(-200, -200, 40, 12);
    this.createSacredGrove(200, -200, 40, 12);
    this.createSacredGrove(-200, 200, 40, 12);
    
    // 3. Forests using fractal noise patterns
    
    // North Forest - Pine dominant biome
    for (let x = -400; x <= 400; x += 20) {
      for (let z = 400; z <= 800; z += 20) {
        this.createTreeFromNoise(x, z, 0.55, 1.2, 1.2, 'pine');
      }
    }
    
    // South Forest - Round dominant biome
    for (let x = -400; x <= 400; x += 20) {
      for (let z = -800; z <= -400; z += 20) {
        this.createTreeFromNoise(x, z, 0.6, 1.0, 1.1, 'round');
      }
    }
    
    // East Forest - Mixed biome (less dense)
    for (let x = 400; x <= 800; x += 25) {
      for (let z = -400; z <= 400; z += 25) {
        this.createTreeFromNoise(x, z, 0.65, 1.1, 0.9, 'mixed');
      }
    }
    
    // West Forest - Mixed biome (less dense)
    for (let x = -800; x <= -400; x += 25) {
      for (let z = -400; z <= 400; z += 25) {
        this.createTreeFromNoise(x, z, 0.65, 1.1, 0.9, 'mixed');
      }
    }
    
    // 4. Tree lines - roads through the forests (preserved for navigation)
    // North-South Road
    for (let z = -1000; z <= 1000; z += 30) {
      this.createPineTree(1.5, -15, z);
      this.createPineTree(1.5, 15, z);
    }
    
    // East-West Road
    for (let x = -1000; x <= 1000; x += 30) {
      this.createRoundTree(1.3, x, -15);
      this.createRoundTree(1.3, x, 15);
    }
    
    // 5. Distinctive landmarks (preserved for navigation)
    
    // Large pine tree at origin
    this.createPineTree(4.0, 0, 100);
    
    // Circle of 8 large round trees
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      this.createRoundTree(2.5, Math.cos(angle) * 120, Math.sin(angle) * 120);
    }
    
    // Spiral of pine trees
    for (let i = 0; i < 40; i++) {
      const angle = i * 0.5;
      const radius = 100 + i * 5;
      this.createPineTree(1.0 + i * 0.05, Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    
    // Add some extra forest patches in various areas to create more complex patterns
    // Northwest region
    for (let x = -600; x <= -300; x += 30) {
      for (let z = 300; z <= 600; z += 30) {
        this.createTreeFromNoise(x, z, 0.75, 1.3, 0.8, 'mixed');
      }
    }
    
    // Southeast region
    for (let x = 300; x <= 600; x += 30) {
      for (let z = -600; z <= -300; z += 30) {
        this.createTreeFromNoise(x, z, 0.75, 1.3, 0.8, 'mixed');
      }
    }
  }
  
  // Get tree colliders for collision detection
  getTreeColliders(): StaticCollider[] {
    return [...this.treeColliders];
  }
}