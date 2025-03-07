import * as THREE from 'three';
import { ICollidable, StaticCollider } from './collision';

export class MapGenerator {
  private scene: THREE.Scene;
  
  // Collider arrays for environment objects
  private treeColliders: StaticCollider[] = [];
  private rockColliders: StaticCollider[] = [];
  
  // Materials
  private trunkMaterial: THREE.MeshStandardMaterial;
  private leafMaterial: THREE.MeshStandardMaterial;
  private rockMaterial: THREE.MeshStandardMaterial;
  private darkRockMaterial: THREE.MeshStandardMaterial;
  
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
    
    this.rockMaterial = new THREE.MeshStandardMaterial({
      color: 0x808080, // Gray
      roughness: 0.9,
      metalness: 0.2
    });
    
    this.darkRockMaterial = new THREE.MeshStandardMaterial({
      color: 0x505050, // Darker gray
      roughness: 0.9,
      metalness: 0.3
    });
  }
  
  // ===== TREE METHODS =====
  
  createPineTree(scale: number, x: number, z: number) {
    const tree = new THREE.Group();
    
    // Tree trunk
    const trunkGeometry = new THREE.CylinderGeometry(0.2 * scale, 0.3 * scale, 1.5 * scale, 8);
    const trunk = new THREE.Mesh(trunkGeometry, this.trunkMaterial);
    trunk.position.y = 0.75 * scale;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    tree.add(trunk);
    
    // Tree foliage (cones)
    const foliageGeometry1 = new THREE.ConeGeometry(1 * scale, 2 * scale, 8);
    const foliage1 = new THREE.Mesh(foliageGeometry1, this.leafMaterial);
    foliage1.position.y = 2 * scale;
    foliage1.castShadow = true;
    tree.add(foliage1);
    
    const foliageGeometry2 = new THREE.ConeGeometry(0.8 * scale, 1.8 * scale, 8);
    const foliage2 = new THREE.Mesh(foliageGeometry2, this.leafMaterial);
    foliage2.position.y = 3 * scale;
    foliage2.castShadow = true;
    tree.add(foliage2);
    
    const foliageGeometry3 = new THREE.ConeGeometry(0.6 * scale, 1.6 * scale, 8);
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
  
  createRoundTree(scale: number, x: number, z: number) {
    const tree = new THREE.Group();
    
    // Tree trunk
    const trunkGeometry = new THREE.CylinderGeometry(0.2 * scale, 0.3 * scale, 1.5 * scale, 8);
    const trunk = new THREE.Mesh(trunkGeometry, this.trunkMaterial);
    trunk.position.y = 0.75 * scale;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    tree.add(trunk);
    
    // Tree foliage (sphere)
    const foliageGeometry = new THREE.SphereGeometry(1.2 * scale, 8, 8);
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
  
  createCircleOfTrees(radius: number, count: number, treeType: 'pine' | 'round') {
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
  
  createSacredGrove(centerX: number, centerZ: number, radius: number, count: number) {
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
  
  createTrees() {
    // 1. Trees surrounding the starting area
    // Create a circle of trees around the origin (tank starting point)
    this.createCircleOfTrees(30, 10, 'pine');   // Inner ring of pine trees (reduced from 12)
    this.createCircleOfTrees(45, 12, 'round');  // Middle ring of round trees (reduced from 16)
    this.createCircleOfTrees(60, 16, 'pine');   // Outer ring of pine trees (reduced from 20)
    
    // 2. Sacred grove - a perfect circle of alternating trees
    // Several sacred groves at key locations
    this.createSacredGrove(200, 200, 40, 12);   // Reduced from 16
    this.createSacredGrove(-200, -200, 40, 12); // Reduced from 16
    this.createSacredGrove(200, -200, 40, 12);  // Reduced from 16
    this.createSacredGrove(-200, 200, 40, 12);  // Reduced from 16
    
    // 3. Large forests in distinct patterns with spacing optimization
    
    // North Forest - Pine
    for (let x = -400; x <= 400; x += 40) {     // Increased spacing (from 25)
      for (let z = 400; z <= 800; z += 40) {    // Increased spacing (from 25)
        // Skip some trees in a deterministic pattern for clearings
        if ((x + z) % 75 === 0) continue;
        
        // Scale based on position
        const scale = 1.2 + Math.sin(x * 0.01) * Math.cos(z * 0.01) * 0.5;
        
        // Add some randomness to reduce regular patterns
        const offsetX = (Math.random() - 0.5) * 15;
        const offsetZ = (Math.random() - 0.5) * 15;
        
        this.createPineTree(scale, x + offsetX, z + offsetZ);
      }
    }
    
    // South Forest - Round
    for (let x = -400; x <= 400; x += 40) {     // Increased spacing (from 25)
      for (let z = -800; z <= -400; z += 40) {  // Increased spacing (from 25)
        // Skip some trees in a deterministic pattern
        if ((x - z) % 75 === 0) continue;
        
        // Scale based on position
        const scale = 1.0 + Math.cos(x * 0.01) * Math.sin(z * 0.01) * 0.4;
        
        // Add some randomness to reduce regular patterns
        const offsetX = (Math.random() - 0.5) * 15;
        const offsetZ = (Math.random() - 0.5) * 15;
        
        this.createRoundTree(scale, x + offsetX, z + offsetZ);
      }
    }
    
    // East Forest - Mixed (with reduced density)
    for (let x = 400; x <= 800; x += 50) {      // Increased spacing (from 25)
      for (let z = -400; z <= 400; z += 50) {   // Increased spacing (from 25)
        // Skip some trees in a deterministic pattern
        if ((x * z) % 1200 === 0) continue;
        if (Math.random() < 0.2) continue;      // Skip 20% of trees randomly
        
        // Scale based on position
        const scale = 1.1 + Math.sin(x * 0.02) * Math.cos(z * 0.02) * 0.3;
        
        // Alternate tree types in a checkerboard pattern
        if ((Math.floor(x / 50) + Math.floor(z / 50)) % 2 === 0) {
          this.createPineTree(scale, x, z);
        } else {
          this.createRoundTree(scale, x, z);
        }
      }
    }
    
    // West Forest - Mixed (with reduced density)
    for (let x = -800; x <= -400; x += 50) {    // Increased spacing (from 25)
      for (let z = -400; z <= 400; z += 50) {   // Increased spacing (from 25)
        // Skip some trees in a deterministic pattern
        if ((x * z) % 1000 === 0) continue;
        if (Math.random() < 0.2) continue;      // Skip 20% of trees randomly
        
        // Scale based on position
        const scale = 1.1 + Math.cos(x * 0.015) * Math.sin(z * 0.015) * 0.3;
        
        // Alternate in rows
        if (Math.floor(z / 50) % 2 === 0) {
          this.createPineTree(scale, x, z);
        } else {
          this.createRoundTree(scale, x, z);
        }
      }
    }
  }
    
    // 4. Tree lines - roads through the forests
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
    
    // 5. Distinctive landmarks
    
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
  }
  
  // ===== ROCK METHODS =====
  
  createRock(size: number, deformSeed: number, x: number, y: number, z: number, rotation: THREE.Vector3, scale: THREE.Vector3, material: THREE.Material) {
    // Create base geometry
    const rockGeometry = new THREE.DodecahedronGeometry(size, 0);
    
    // Deterministically deform vertices based on position
    const positions = rockGeometry.attributes.position;
    for (let j = 0; j < positions.count; j++) {
      const vx = positions.getX(j);
      const vy = positions.getY(j);
      const vz = positions.getZ(j);
      
      // Use trigonometric functions with the seed for deterministic deformation
      const xFactor = 0.8 + Math.sin(vx * deformSeed) * 0.2;
      const yFactor = 0.8 + Math.cos(vy * deformSeed) * 0.2;
      const zFactor = 0.8 + Math.sin(vz * deformSeed) * 0.2;
      
      positions.setX(j, vx * xFactor);
      positions.setY(j, vy * yFactor);
      positions.setZ(j, vz * zFactor);
    }
    
    // Create the rock mesh
    const rock = new THREE.Mesh(rockGeometry, material);
    
    // Set position, rotation and scale
    rock.position.set(x, y, z);
    rock.rotation.set(rotation.x, rotation.y, rotation.z);
    rock.scale.set(scale.x, scale.y, scale.z);
    
    rock.castShadow = true;
    rock.receiveShadow = true;
    
    // Create a collider for the rock
    // Use the largest scale dimension to determine collision radius
    const maxScale = Math.max(scale.x, scale.y, scale.z);
    const collisionRadius = size * maxScale * 1.2; // Slightly larger than the visual size
    const position = new THREE.Vector3(x, y, z);
    const rockCollider = new StaticCollider(position, 'rock', collisionRadius);
    this.rockColliders.push(rockCollider);
    
    return rock;
  }
  
  createRockCluster(centerX: number, centerZ: number, seed: number) {
    const cluster = new THREE.Group();
    
    // Create 5 rocks in a deterministic pattern
    const rockCount = 5;
    
    for (let i = 0; i < rockCount; i++) {
      // Use the seed and index to create deterministic positions
      const angle = (i / rockCount) * Math.PI * 2;
      const distance = 1 + Math.sin(seed + i) * 0.5;
      
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      const y = 0.2 + Math.sin(seed * (i + 1)) * 0.3;
      
      // Deterministic rotation based on position
      const rotX = Math.sin(seed + i) * Math.PI;
      const rotY = Math.cos(seed + i * 2) * Math.PI;
      const rotZ = Math.sin(seed + i * 3) * Math.PI;
      
      // Deterministic scale based on position
      const baseScale = 0.8 + Math.sin(seed * i) * 0.7;
      const scaleX = baseScale;
      const scaleY = baseScale * 0.8;
      const scaleZ = baseScale * 1.2;
      
      // Alternate materials
      const material = i % 2 === 0 ? this.rockMaterial : this.darkRockMaterial;
      
      // Create the rock
      const rock = this.createRock(
        0.5 + Math.sin(seed + i * 7) * 0.3, // Size
        seed + i, // Deform seed
        x, y, z, // Position
        new THREE.Vector3(rotX, rotY, rotZ), // Rotation
        new THREE.Vector3(scaleX, scaleY, scaleZ), // Scale
        material
      );
      
      cluster.add(rock);
    }
    
    // Position the cluster
    cluster.position.set(centerX, 0, centerZ);
    
    // Add to scene
    this.scene.add(cluster);
  }
  
  createStoneCircle(centerX: number, centerZ: number, radius: number, count: number, seed: number) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const x = centerX + Math.cos(angle) * radius;
      const z = centerZ + Math.sin(angle) * radius;
      this.createRockCluster(x, z, seed + i);
    }
  }
  
  createRocks() {
    // 1. Rocks near the tank starting area
    // Create a circle of rocks around the starting point at a small distance
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const x = Math.cos(angle) * 20; // Closer to center than trees
      const z = Math.sin(angle) * 20;
      this.createRockCluster(x, z, i);
    }
    
    // 2. Rock formations in geometric patterns
    
    // Square formation
    for (let i = 0; i < 4; i++) {
      const x = (i < 2 ? -100 : 100);
      const z = (i % 2 === 0 ? -100 : 100);
      this.createRockCluster(x, z, i + 10);
    }
    
    // Rock line along X-axis
    for (let x = -150; x <= 150; x += 30) {
      this.createRockCluster(x, 150, x * 0.1);
    }
    
    // Rock line along Z-axis
    for (let z = -150; z <= 150; z += 30) {
      this.createRockCluster(150, z, z * 0.1 + 100);
    }
    
    // 3. Mountain Ranges - orderly arrangements of rocks
    
    // Northern mountain range
    for (let x = -300; x <= 300; x += 30) {
      // Create 3 parallel lines of rocks with varying height
      const zVariation = 30 * Math.sin(x * 0.02);
      this.createRockCluster(x, 300 + zVariation, x * 0.3);
      this.createRockCluster(x + 10, 330 + zVariation, x * 0.3 + 10);
      this.createRockCluster(x - 5, 360 + zVariation, x * 0.3 + 20);
    }
    
    // Eastern mountain range
    for (let z = -300; z <= 300; z += 30) {
      // Create 3 parallel lines of rocks with varying height
      const xVariation = 30 * Math.sin(z * 0.02);
      this.createRockCluster(300 + xVariation, z, z * 0.3 + 200);
      this.createRockCluster(330 + xVariation, z + 10, z * 0.3 + 210);
      this.createRockCluster(360 + xVariation, z - 5, z * 0.3 + 220);
    }
    
    // 4. Stone Circles - ceremonial-looking formations
    
    // Four stone circles at the corners
    this.createStoneCircle(500, 500, 50, 12, 400);
    this.createStoneCircle(-500, 500, 50, 12, 500);
    this.createStoneCircle(500, -500, 50, 12, 600);
    this.createStoneCircle(-500, -500, 50, 12, 700);
    
    // 5. Center-piece - large rock formation at 0,0,0
    // Create a spiral of rocks outward from center
    for (let i = 1; i < 12; i++) {
      const angle = i * 0.5;
      const radius = i * 5;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      this.createRockCluster(x, z, i * 50);
    }
    
    // 6. Rocky path connecting the quadrants
    // Diagonal path from top-left to bottom-right
    for (let i = -10; i <= 10; i++) {
      this.createRockCluster(-500 + i * 50, -500 + i * 50, i * 5);
    }
    
    // Diagonal path from top-right to bottom-left
    for (let i = -10; i <= 10; i++) {
      this.createRockCluster(500 - i * 50, -500 + i * 50, i * 5 + 1000);
    }
  }
  
  // Method to get all colliders for collision detection
  getAllColliders(): ICollidable[] {
    return [...this.treeColliders, ...this.rockColliders];
  }
}