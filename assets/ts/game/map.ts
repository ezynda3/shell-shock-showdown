import * as THREE from 'three';
import { ICollidable, StaticCollider } from './collision';

export class MapGenerator {
  private scene: THREE.Scene;
  
  // Collider arrays for environment objects
  private treeColliders: StaticCollider[] = [];
  private rockColliders: StaticCollider[] = [];
  private buildingColliders: StaticCollider[] = [];
  
  // Materials
  private trunkMaterial: THREE.MeshStandardMaterial;
  private leafMaterial: THREE.MeshStandardMaterial;
  private rockMaterial: THREE.MeshStandardMaterial;
  private darkRockMaterial: THREE.MeshStandardMaterial;
  
  // Building materials
  private buildingMaterials: THREE.MeshStandardMaterial[] = [];
  private glassMaterial: THREE.MeshStandardMaterial;
  private roadMaterial: THREE.MeshStandardMaterial;
  
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
    
    // Building materials with different colors
    this.buildingMaterials = [
      new THREE.MeshStandardMaterial({
        color: 0x708090, // Slate gray
        roughness: 0.7,
        metalness: 0.3
      }),
      new THREE.MeshStandardMaterial({
        color: 0xA9A9A9, // Dark gray
        roughness: 0.7,
        metalness: 0.2
      }),
      new THREE.MeshStandardMaterial({
        color: 0x4682B4, // Steel blue
        roughness: 0.6,
        metalness: 0.4
      }),
      new THREE.MeshStandardMaterial({
        color: 0x8B4513, // Brown
        roughness: 0.8,
        metalness: 0.1
      }),
      new THREE.MeshStandardMaterial({
        color: 0x2F4F4F, // Dark slate gray
        roughness: 0.7,
        metalness: 0.3
      })
    ];
    
    // Glass material for windows
    this.glassMaterial = new THREE.MeshStandardMaterial({
      color: 0x87CEEB, // Sky blue
      roughness: 0.2,
      metalness: 0.8,
      transparent: true,
      opacity: 0.6
    });
    
    // Road material
    this.roadMaterial = new THREE.MeshStandardMaterial({
      color: 0x333333, // Dark gray
      roughness: 0.9,
      metalness: 0.1
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
  
  createRock(size: number, deformSeed: number, x: number, y: number, z: number, rotation: THREE.Vector3, scale: THREE.Vector3, material: THREE.Material, colliderPosition?: THREE.Vector3) {
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
    
    // Use provided collider position if available, otherwise use the mesh position
    const position = colliderPosition ? colliderPosition.clone() : new THREE.Vector3(x, y, z);
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
      
      // Calculate absolute position (local rock position + cluster position)
      const absX = x + centerX;
      const absY = y;
      const absZ = z + centerZ;
      
      // Create the rock
      const rock = this.createRock(
        0.5 + Math.sin(seed + i * 7) * 0.3, // Size
        seed + i, // Deform seed
        x, y, z, // Local Position (for the mesh)
        new THREE.Vector3(rotX, rotY, rotZ), // Rotation
        new THREE.Vector3(scaleX, scaleY, scaleZ), // Scale
        material,
        new THREE.Vector3(absX, absY, absZ) // Absolute position (for the collider)
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
  
  // Method to create a tall spire of rocks
  createRockSpire(x: number, z: number, height: number, seed: number) {
    const spireGroup = new THREE.Group();
    
    // Create a series of stacked rocks with decreasing size
    const segments = 8;
    const baseSize = 2.0;
    
    for (let i = 0; i < segments; i++) {
      // Each segment gets smaller as we go up
      const segmentSize = baseSize * (1 - i / segments * 0.7);
      const segmentHeight = height / segments;
      const y = i * segmentHeight;
      
      // Add some offset for natural look, but keep it deterministic
      const xOffset = Math.cos(seed + i * 0.5) * segmentSize * 0.3;
      const zOffset = Math.sin(seed + i * 1.2) * segmentSize * 0.3;
      
      // Alternate materials for visual interest
      const material = i % 2 === 0 ? this.rockMaterial : this.darkRockMaterial;
      
      // Create the rock with deterministic variation
      const rock = this.createRock(
        segmentSize, 
        seed + i,
        xOffset, y, zOffset,
        new THREE.Vector3(
          Math.sin(i * 0.3 + seed) * Math.PI,
          Math.sin(i * 0.7 + seed) * Math.PI * 2,
          Math.sin(i * 0.5 + seed) * Math.PI
        ),
        new THREE.Vector3(1.0, 0.8, 1.0),
        material
      );
      
      spireGroup.add(rock);
    }
    
    // Add a distinctive top piece
    const topRock = this.createRock(
      baseSize * 0.3,
      seed + 100,
      0, height, 0,
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(2.0, 1.5, 2.0),
      this.rockMaterial
    );
    
    spireGroup.add(topRock);
    
    // Position the spire and add to scene
    spireGroup.position.set(x, 0, z);
    this.scene.add(spireGroup);
    
    // Add a collider for the entire spire
    const colliderPosition = new THREE.Vector3(x, height/2, z);
    const rockCollider = new StaticCollider(
      colliderPosition,
      'rock',
      baseSize * 2.5 // Large enough to cover the whole spire
    );
    this.rockColliders.push(rockCollider);
  }
  
  // Method to create a rock arch
  createRockArch(x: number, z: number, width: number, height: number, depth: number, rotation: number, seed: number) {
    const archGroup = new THREE.Group();
    
    // Create pillars
    const pillarWidth = width * 0.15;
    const pillarDepth = depth * 0.3;
    
    // Left pillar
    const leftPillar = new THREE.BoxGeometry(pillarWidth, height * 0.8, pillarDepth);
    const leftPillarMesh = new THREE.Mesh(leftPillar, this.rockMaterial);
    leftPillarMesh.position.set(-width/2 + pillarWidth/2, height * 0.4, 0);
    archGroup.add(leftPillarMesh);
    
    // Right pillar
    const rightPillar = new THREE.BoxGeometry(pillarWidth, height * 0.8, pillarDepth);
    const rightPillarMesh = new THREE.Mesh(rightPillar, this.rockMaterial);
    rightPillarMesh.position.set(width/2 - pillarWidth/2, height * 0.4, 0);
    archGroup.add(rightPillarMesh);
    
    // Create arch top as a curved shape
    const archCurve = new THREE.Shape();
    
    // Define the curve with 10 segments to form a nice arch
    const segments = 10;
    const archWidth = width - pillarWidth;
    
    // Create points along a half-circle for the arch
    for (let i = 0; i <= segments; i++) {
      const angle = Math.PI - (i / segments) * Math.PI;
      const x = Math.cos(angle) * (archWidth/2);
      const y = Math.sin(angle) * (height * 0.2) + height * 0.8;
      
      if (i === 0) {
        archCurve.moveTo(x, y);
      } else {
        archCurve.lineTo(x, y);
      }
    }
    
    // Complete the shape by adding bottom points
    archCurve.lineTo(archWidth/2, height * 0.8);
    archCurve.lineTo(-archWidth/2, height * 0.8);
    
    // Extrude the shape to create the 3D arch
    const extrudeSettings = {
      steps: 1,
      depth: pillarDepth,
      bevelEnabled: true,
      bevelThickness: 0.2,
      bevelSize: 0.1,
      bevelSegments: 2
    };
    
    const archGeometry = new THREE.ExtrudeGeometry(archCurve, extrudeSettings);
    const archMesh = new THREE.Mesh(archGeometry, this.darkRockMaterial);
    
    // Center the arch
    archMesh.position.z = -pillarDepth/2;
    archGroup.add(archMesh);
    
    // Add some rock decorations
    for (let i = 0; i < 5; i++) {
      const decorationPosition = new THREE.Vector3(
        (Math.sin(seed + i) - 0.5) * width,
        height * 1.1 + Math.sin(seed + i * 2) * height * 0.2,
        (Math.cos(seed + i) - 0.5) * depth
      );
      
      const rock = this.createRock(
        0.4 + Math.sin(seed + i * 3) * 0.2,
        seed + i * 10,
        decorationPosition.x, decorationPosition.y, decorationPosition.z,
        new THREE.Vector3(
          Math.sin(seed + i * 4) * Math.PI,
          Math.sin(seed + i * 5) * Math.PI,
          Math.sin(seed + i * 6) * Math.PI
        ),
        new THREE.Vector3(1, 1, 1),
        i % 2 === 0 ? this.rockMaterial : this.darkRockMaterial
      );
      
      archGroup.add(rock);
    }
    
    // Position and rotate the arch
    archGroup.position.set(x, 0, z);
    archGroup.rotation.y = rotation;
    this.scene.add(archGroup);
    
    // Add colliders for the pillars
    const leftColliderPos = new THREE.Vector3(
      x - Math.cos(rotation) * (width/2 - pillarWidth/2),
      height * 0.4,
      z - Math.sin(rotation) * (width/2 - pillarWidth/2)
    );
    
    const rightColliderPos = new THREE.Vector3(
      x + Math.cos(rotation) * (width/2 - pillarWidth/2),
      height * 0.4,
      z + Math.sin(rotation) * (width/2 - pillarWidth/2)
    );
    
    this.rockColliders.push(
      new StaticCollider(leftColliderPos, 'rock', pillarWidth)
    );
    
    this.rockColliders.push(
      new StaticCollider(rightColliderPos, 'rock', pillarWidth)
    );
    
    // Add a collider for the arch top
    const archTopCollider = new StaticCollider(
      new THREE.Vector3(x, height * 0.9, z),
      'rock',
      width * 0.4
    );
    this.rockColliders.push(archTopCollider);
  }
  
  // Method to create a balanced rock formation
  createBalancedRocks(x: number, z: number, height: number, seed: number) {
    const balancedRockGroup = new THREE.Group();
    
    // Base rock - larger, flatter
    const baseRock = this.createRock(
      3.0, // Size
      seed,
      0, 1.5, 0, // Position
      new THREE.Vector3(0, 0, 0), // No rotation for stability
      new THREE.Vector3(2.0, 1.0, 2.0), // Flatter shape
      this.darkRockMaterial
    );
    
    balancedRockGroup.add(baseRock);
    
    // Middle rock - medium sized, slightly offset
    const middleRock = this.createRock(
      2.0, // Size
      seed + 10,
      Math.sin(seed) * 0.5, 3.0, Math.cos(seed) * 0.5, // Slight offset
      new THREE.Vector3(Math.sin(seed + 5) * 0.3, Math.sin(seed + 6) * 0.3, Math.sin(seed + 7) * 0.3),
      new THREE.Vector3(1.5, 1.2, 1.5),
      this.rockMaterial
    );
    
    balancedRockGroup.add(middleRock);
    
    // Top rock - smaller, more precariously balanced
    const topRock = this.createRock(
      1.5, // Size
      seed + 20,
      Math.sin(seed + 10) * 0.8, 5.0, Math.cos(seed + 10) * 0.8, // More offset
      new THREE.Vector3(Math.sin(seed + 15) * 0.5, Math.sin(seed + 16) * 0.5, Math.sin(seed + 17) * 0.5),
      new THREE.Vector3(1.2, 1.0, 1.2),
      this.darkRockMaterial
    );
    
    balancedRockGroup.add(topRock);
    
    // Optional: extremely small rock on very top for dramatic effect
    if (Math.sin(seed + 30) > 0) { // 50% chance based on seed
      const tinyRock = this.createRock(
        0.7, // Size
        seed + 30,
        Math.sin(seed + 20) * 0.3, 6.0, Math.cos(seed + 20) * 0.3,
        new THREE.Vector3(Math.sin(seed + 25) * 1.0, Math.sin(seed + 26) * 1.0, Math.sin(seed + 27) * 1.0),
        new THREE.Vector3(0.8, 0.8, 0.8),
        this.rockMaterial
      );
      
      balancedRockGroup.add(tinyRock);
    }
    
    // Position the group
    balancedRockGroup.position.set(x, 0, z);
    this.scene.add(balancedRockGroup);
    
    // Add a collider for the entire stack
    const colliderPosition = new THREE.Vector3(x, height/2, z);
    const rockCollider = new StaticCollider(
      colliderPosition,
      'rock',
      3.0 // Large enough for the whole stack
    );
    this.rockColliders.push(rockCollider);
  }
  
  // Method to create a rock wall segment
  createRockWall(startX: number, startZ: number, endX: number, endZ: number, height: number, seed: number) {
    // Calculate direction and length
    const direction = new THREE.Vector2(endX - startX, endZ - startZ).normalize();
    const length = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endZ - startZ, 2));
    
    // Create rocks along the wall
    const rockCount = Math.ceil(length / 5); // One rock every ~5 units
    
    for (let i = 0; i < rockCount; i++) {
      // Calculate position along the wall
      const t = i / (rockCount - 1); // 0 to 1
      const x = startX + (endX - startX) * t;
      const z = startZ + (endZ - startZ) * t;
      
      // Add some variation perpendicular to the wall
      const perpX = -direction.y; // Perpendicular direction
      const perpZ = direction.x;
      
      const offset = (Math.sin(seed + i * 5) - 0.5) * 2.0;
      const xPos = x + perpX * offset;
      const zPos = z + perpZ * offset;
      
      // Vary the height
      const yPos = Math.sin(seed + i * 3) * height * 0.4;
      
      // Create a rock with size variation
      const size = 1.0 + Math.sin(seed + i * 7) * 0.5;
      
      this.createRock(
        size,
        seed + i * 10,
        0, yPos, 0,
        new THREE.Vector3(
          Math.sin(seed + i * 11) * Math.PI,
          Math.sin(seed + i * 13) * Math.PI,
          Math.sin(seed + i * 17) * Math.PI
        ),
        new THREE.Vector3(1, height / size, 1),
        i % 2 === 0 ? this.rockMaterial : this.darkRockMaterial,
        new THREE.Vector3(xPos, height/2, zPos) // Absolute position for collider
      );
    }
    
    // Add colliders along the wall
    const segments = 4; // Number of collider segments
    for (let i = 0; i < segments; i++) {
      const t = i / segments;
      const x = startX + (endX - startX) * t;
      const z = startZ + (endZ - startZ) * t;
      
      const colliderPosition = new THREE.Vector3(x, height/2, z);
      const segmentLength = length / segments;
      
      const rockCollider = new StaticCollider(
        colliderPosition,
        'rock',
        segmentLength/2 // Radius covers half the segment length
      );
      this.rockColliders.push(rockCollider);
    }
  }
  
  // Create a giant mountain similar to the central formation
  createGiantMountain(x: number, z: number, seed: number) {
    // Create a mountain group to hold all components
    const mountainGroup = new THREE.Group();
    
    // Mountain dimensions
    const mountainHeight = 160 + Math.sin(seed) * 40; // 120-200 units tall
    const mountainWidth = 100 + Math.sin(seed * 1.3) * 30; // 70-130 units wide
    const mountainDepth = 100 + Math.cos(seed * 0.7) * 30; // 70-130 units deep
    
    // Create main mountain structure with multiple layers
    // Base layer - largest, darkest
    const baseGeometry = new THREE.ConeGeometry(mountainWidth/2, mountainHeight * 0.7, 8);
    const baseMesh = new THREE.Mesh(baseGeometry, this.darkRockMaterial);
    baseMesh.position.y = mountainHeight * 0.35;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    
    // Middle layer
    const middleGeometry = new THREE.ConeGeometry(mountainWidth * 0.6/2, mountainHeight * 0.5, 7);
    const middleMesh = new THREE.Mesh(middleGeometry, this.rockMaterial);
    middleMesh.position.y = mountainHeight * 0.65;
    middleMesh.castShadow = true;
    middleMesh.receiveShadow = true;
    
    // Upper layer
    const upperGeometry = new THREE.ConeGeometry(mountainWidth * 0.4/2, mountainHeight * 0.3, 6);
    const upperMesh = new THREE.Mesh(upperGeometry, this.darkRockMaterial);
    upperMesh.position.y = mountainHeight * 0.9;
    upperMesh.castShadow = true;
    upperMesh.receiveShadow = true;
    
    // Peak
    const peakGeometry = new THREE.ConeGeometry(mountainWidth * 0.2/2, mountainHeight * 0.15, 5);
    const peakMesh = new THREE.Mesh(peakGeometry, this.rockMaterial);
    peakMesh.position.y = mountainHeight * 1.05;
    peakMesh.castShadow = true;
    peakMesh.receiveShadow = true;
    
    // Add all layers to the mountain group
    mountainGroup.add(baseMesh);
    mountainGroup.add(middleMesh);
    mountainGroup.add(upperMesh);
    mountainGroup.add(peakMesh);
    
    // Deform the mountain meshes for more natural look
    [baseMesh, middleMesh, upperMesh, peakMesh].forEach((mesh, i) => {
      const positions = mesh.geometry.attributes.position;
      for (let j = 0; j < positions.count; j++) {
        const vx = positions.getX(j);
        const vy = positions.getY(j);
        const vz = positions.getZ(j);
        
        // Use deterministic deformation with the seed
        const deformSeed = seed + i * 100;
        const xFactor = 0.9 + Math.sin(vx * deformSeed * 0.01) * 0.4;
        const zFactor = 0.9 + Math.cos(vz * deformSeed * 0.01) * 0.4;
        
        positions.setX(j, vx * xFactor);
        positions.setZ(j, vz * zFactor);
        
        // Add some vertical variation for the non-peak layers
        if (i < 3) {
          const yFactor = 1.0 + Math.cos(vx * vz * deformSeed * 0.001) * 0.1;
          positions.setY(j, vy * yFactor);
        }
      }
      
      // Update the geometry
      mesh.geometry.attributes.position.needsUpdate = true;
    });
    
    // Add rock clusters around the base of the mountain
    const baseRadius = mountainWidth / 2 * 1.2;
    const clusterCount = 12;
    
    for (let i = 0; i < clusterCount; i++) {
      const angle = (i / clusterCount) * Math.PI * 2;
      const distance = baseRadius * (0.9 + Math.sin(seed + i * 7) * 0.3);
      
      const clusterX = Math.cos(angle) * distance;
      const clusterZ = Math.sin(angle) * distance;
      
      // Create a rock cluster at this position, using the mountain seed
      const rockCluster = new THREE.Group();
      
      // Create 3-5 rocks per cluster
      const rockCount = 3 + Math.floor(Math.abs(Math.sin(seed + i * 13)) * 3);
      
      for (let j = 0; j < rockCount; j++) {
        // Calculate position within cluster
        const offsetAngle = Math.PI * 2 * Math.sin(seed + i * j);
        const offsetDist = 2 + Math.sin(seed + i * j * 3) * 1.5;
        
        const rockX = clusterX + Math.cos(offsetAngle) * offsetDist;
        const rockZ = clusterZ + Math.sin(offsetAngle) * offsetDist;
        const rockY = Math.abs(Math.sin(seed + i * j * 5)) * 2;
        
        // Create rock with size variation
        const rockSize = 1.0 + Math.abs(Math.sin(seed + i * j * 11)) * 2.0;
        
        const rock = this.createRock(
          rockSize,
          seed + i * 100 + j,
          rockX, rockY, rockZ,
          new THREE.Vector3(
            Math.sin(seed + i * j * 17) * Math.PI,
            Math.sin(seed + i * j * 19) * Math.PI * 2,
            Math.sin(seed + i * j * 23) * Math.PI
          ),
          new THREE.Vector3(
            1.0 + Math.sin(seed + i * j * 29) * 0.4,
            0.7 + Math.abs(Math.sin(seed + i * j * 31)) * 0.6,
            1.0 + Math.sin(seed + i * j * 37) * 0.4
          ),
          j % 2 === 0 ? this.rockMaterial : this.darkRockMaterial
        );
        
        mountainGroup.add(rock);
      }
    }
    
    // Position the mountain group
    mountainGroup.position.set(x, 0, z);
    
    // Add to scene
    this.scene.add(mountainGroup);
    
    // Add collision for the mountain core
    const mountainCollider = new StaticCollider(
      new THREE.Vector3(x, mountainHeight * 0.5, z),
      'rock',
      mountainWidth * 0.6 // Large enough to cover the core
    );
    this.rockColliders.push(mountainCollider);
    
    // Add additional smaller colliders around the periphery
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const distance = mountainWidth * 0.4;
      
      const colliderX = x + Math.cos(angle) * distance;
      const colliderZ = z + Math.sin(angle) * distance;
      
      const collider = new StaticCollider(
        new THREE.Vector3(colliderX, mountainHeight * 0.3, colliderZ),
        'rock',
        mountainWidth * 0.25
      );
      this.rockColliders.push(collider);
    }
  }
  
  // Create a large mountain range that extends along an axis
  createMountainRange(x: number, z: number, height: number, seed: number) {
    // Mountain range parameters
    const rangeLength = 300; // Length of the range
    const rangeWidth = 100; // Width of the range
    const segmentCount = 5; // Number of peaks in the range
    
    // Determine orientation based on x/z position
    const isHorizontal = Math.abs(x) > Math.abs(z);
    
    // Create peaks along the range
    for (let i = 0; i < segmentCount; i++) {
      // Position along the range (-1 to 1)
      const t = (i / (segmentCount - 1)) * 2 - 1;
      
      // Calculate position
      const peakX = isHorizontal ? x + t * rangeLength / 2 : x;
      const peakZ = isHorizontal ? z : z + t * rangeLength / 2;
      
      // Vary peak height along the range
      const peakHeight = height * (0.7 + Math.sin(seed + i * 5) * 0.3);
      
      // Create individual peaks
      this.createMountainPeak(
        peakX, peakZ, peakHeight, 
        rangeWidth * (0.5 + Math.sin(seed + i * 7) * 0.3), 
        seed + i * 1000
      );
      
      // Add smaller peaks between main peaks (except for last segment)
      if (i < segmentCount - 1) {
        const midT = t + 1 / (segmentCount - 1);
        const midX = isHorizontal ? x + midT * rangeLength / 2 : x;
        const midZ = isHorizontal ? z : z + midT * rangeLength / 2;
        
        // Create smaller connecting peaks
        this.createMountainPeak(
          midX, midZ, 
          peakHeight * 0.7, 
          rangeWidth * 0.6, 
          seed + i * 1000 + 500
        );
      }
    }
    
    // Add ridge rocks along the entire range
    const ridgeSegments = 20;
    for (let i = 0; i < ridgeSegments; i++) {
      // Position along range
      const t = (i / (ridgeSegments - 1)) * 2 - 1;
      
      // Base position
      const baseX = isHorizontal ? x + t * rangeLength / 2 : x;
      const baseZ = isHorizontal ? z : z + t * rangeLength / 2;
      
      // Add some noise perpendicular to the range
      const perpOffset = Math.sin(seed + i * 13) * rangeWidth * 0.3;
      const finalX = isHorizontal ? baseX : baseX + perpOffset;
      const finalZ = isHorizontal ? baseZ + perpOffset : baseZ;
      
      // Vary height along the range with a rolling hills effect
      const hillHeight = height * 0.15 * (1 + Math.sin(t * Math.PI * 3 + seed));
      
      // Create rock clusters
      this.createRockCluster(finalX, finalZ, seed + i * 100);
      
      // Every few segments, add a larger formation
      if (i % 3 === 0) {
        this.createRockCluster(
          finalX + (isHorizontal ? 0 : rangeWidth * 0.2 * Math.sin(seed + i)),
          finalZ + (isHorizontal ? rangeWidth * 0.2 * Math.sin(seed + i) : 0),
          seed + i * 200
        );
      }
    }
  }
  
  // Helper method to create individual mountain peaks
  createMountainPeak(x: number, z: number, height: number, width: number, seed: number) {
    // Create mountain group
    const peakGroup = new THREE.Group();
    
    // Create the main peak cone
    const coneGeometry = new THREE.ConeGeometry(width / 2, height, 8);
    const coneMesh = new THREE.Mesh(coneGeometry, this.darkRockMaterial);
    coneMesh.position.y = height / 2;
    coneMesh.castShadow = true;
    coneMesh.receiveShadow = true;
    
    // Deform the cone mesh for natural look
    const positions = coneMesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const vx = positions.getX(i);
      const vy = positions.getY(i);
      const vz = positions.getZ(i);
      
      // Use deterministic deformation
      const xFactor = 0.9 + Math.sin(vx * seed * 0.01 + vz * 0.1) * 0.3;
      const zFactor = 0.9 + Math.cos(vz * seed * 0.01 + vx * 0.1) * 0.3;
      
      positions.setX(i, vx * xFactor);
      positions.setZ(i, vz * zFactor);
      
      // Add vertical irregularities
      if (vy > 0) { // Don't deform the base
        const yFactor = 1.0 + Math.sin(vx * vz * 0.1 + seed) * 0.1;
        positions.setY(i, vy * yFactor);
      }
    }
    
    // Update the geometry
    coneMesh.geometry.attributes.position.needsUpdate = true;
    
    peakGroup.add(coneMesh);
    
    // Add a smaller upper peak
    if (height > 30) {
      const upperGeometry = new THREE.ConeGeometry(width * 0.3 / 2, height * 0.3, 6);
      const upperMesh = new THREE.Mesh(upperGeometry, this.rockMaterial);
      upperMesh.position.y = height * 0.85;
      upperMesh.castShadow = true;
      upperMesh.receiveShadow = true;
      
      // Deform the upper peak too
      const upperPositions = upperMesh.geometry.attributes.position;
      for (let i = 0; i < upperPositions.count; i++) {
        const vx = upperPositions.getX(i);
        const vz = upperPositions.getZ(i);
        
        // Different deformation pattern for the upper peak
        const xFactor = 0.9 + Math.sin(vx * (seed + 100) * 0.02) * 0.3;
        const zFactor = 0.9 + Math.cos(vz * (seed + 200) * 0.02) * 0.3;
        
        upperPositions.setX(i, vx * xFactor);
        upperPositions.setZ(i, vz * zFactor);
      }
      
      upperMesh.geometry.attributes.position.needsUpdate = true;
      peakGroup.add(upperMesh);
    }
    
    // Add rocks around the base
    const rockCount = 6 + Math.floor(Math.abs(Math.sin(seed) * 6));
    for (let i = 0; i < rockCount; i++) {
      const angle = (i / rockCount) * Math.PI * 2;
      const distance = width * 0.6 * (0.8 + Math.sin(seed + i * 5) * 0.3);
      
      const rockX = Math.cos(angle) * distance;
      const rockZ = Math.sin(angle) * distance;
      const rockY = Math.abs(Math.sin(seed + i * 7)) * 4;
      
      // Size variation based on seed
      const rockSize = 1.0 + Math.abs(Math.sin(seed + i * 11)) * 3.0;
      
      const rock = this.createRock(
        rockSize,
        seed + i * 100,
        rockX, rockY, rockZ,
        new THREE.Vector3(
          Math.sin(seed + i * 17) * Math.PI,
          Math.sin(seed + i * 19) * Math.PI * 2,
          Math.sin(seed + i * 23) * Math.PI
        ),
        new THREE.Vector3(
          1.0 + Math.sin(seed + i * 29) * 0.4,
          0.7 + Math.abs(Math.sin(seed + i * 31)) * 0.4,
          1.0 + Math.sin(seed + i * 37) * 0.4
        ),
        i % 2 === 0 ? this.rockMaterial : this.darkRockMaterial
      );
      
      peakGroup.add(rock);
    }
    
    // Position and add to scene
    peakGroup.position.set(x, 0, z);
    this.scene.add(peakGroup);
    
    // Add collider for the peak
    const peakCollider = new StaticCollider(
      new THREE.Vector3(x, height * 0.5, z),
      'rock',
      width * 0.5
    );
    this.rockColliders.push(peakCollider);
  }
  
  // Create a volcanic crater mountain
  createVolcanicCrater(x: number, z: number, seed: number) {
    // Crater parameters
    const outerRadius = 80 + Math.sin(seed) * 20; // 60-100 units
    const innerRadius = outerRadius * 0.6;
    const height = 120 + Math.sin(seed * 1.3) * 30; // 90-150 units
    const craterDepth = height * 0.3;
    
    // Create mountain group
    const craterGroup = new THREE.Group();
    
    // Create the main crater using a torus geometry
    const craterGeometry = new THREE.TorusGeometry(
      innerRadius, // Radius of the entire torus
      (outerRadius - innerRadius) / 2, // Thickness of the torus
      16, // Radial segments
      24  // Tubular segments
    );
    
    // Rotate to make it horizontal
    craterGeometry.rotateX(Math.PI / 2);
    
    const craterMesh = new THREE.Mesh(craterGeometry, this.darkRockMaterial);
    craterMesh.position.y = height * 0.7;
    craterMesh.castShadow = true;
    craterMesh.receiveShadow = true;
    
    // Create the base cone
    const baseGeometry = new THREE.ConeGeometry(outerRadius, height * 0.9, 20);
    
    // Cut out the center of the cone to make a crater
    // We'll do this by moving vertices
    const basePositions = baseGeometry.attributes.position;
    for (let i = 0; i < basePositions.count; i++) {
      const vx = basePositions.getX(i);
      const vy = basePositions.getY(i);
      const vz = basePositions.getZ(i);
      
      // Calculate distance from center (xz plane)
      const distFromCenter = Math.sqrt(vx * vx + vz * vz);
      
      // If inside the inner radius and near the top
      if (distFromCenter < innerRadius * 0.8 && vy > height * 0.7) {
        // Push down to create crater
        const newY = height * 0.7 - (height * 0.7 - vy) * (craterDepth / height);
        basePositions.setY(i, newY);
      }
      
      // Add some noise to the surface
      const deformFactor = 0.9 + Math.sin(vx * seed * 0.01 + vz * 0.1) * 0.3;
      basePositions.setX(i, vx * deformFactor);
      basePositions.setZ(i, vz * deformFactor);
    }
    
    // Update the geometry
    baseGeometry.attributes.position.needsUpdate = true;
    
    const baseMesh = new THREE.Mesh(baseGeometry, this.rockMaterial);
    baseMesh.position.y = height * 0.45;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    
    // Add meshes to group
    craterGroup.add(baseMesh);
    craterGroup.add(craterMesh);
    
    // Add rocks around the rim
    const rimRockCount = 16;
    for (let i = 0; i < rimRockCount; i++) {
      const angle = (i / rimRockCount) * Math.PI * 2;
      const rimX = Math.cos(angle) * innerRadius;
      const rimZ = Math.sin(angle) * innerRadius;
      
      // Height variation along the rim
      const rimHeight = height * 0.75 + Math.sin(seed + i * 5) * height * 0.1;
      
      // Create larger, more dramatic rocks
      const rock = this.createRock(
        4.0 + Math.abs(Math.sin(seed + i * 11)) * 3.0,
        seed + i * 100,
        rimX, rimHeight - height * 0.45, rimZ, // Account for the group's position
        new THREE.Vector3(
          Math.sin(seed + i * 17) * Math.PI,
          Math.sin(seed + i * 19) * Math.PI * 0.5, // Less rotation on Y
          Math.sin(seed + i * 23) * Math.PI
        ),
        new THREE.Vector3(
          1.2 + Math.sin(seed + i * 29) * 0.3,
          1.5 + Math.abs(Math.sin(seed + i * 31)) * 0.5, // Taller
          1.2 + Math.sin(seed + i * 37) * 0.3
        ),
        i % 2 === 0 ? this.rockMaterial : this.darkRockMaterial
      );
      
      craterGroup.add(rock);
    }
    
    // Add some "lava rocks" inside the crater
    const innerRockCount = 8;
    for (let i = 0; i < innerRockCount; i++) {
      const angle = (i / innerRockCount) * Math.PI * 2;
      const dist = innerRadius * (0.3 + Math.abs(Math.sin(seed + i * 7)) * 0.3);
      
      const innerX = Math.cos(angle) * dist;
      const innerZ = Math.sin(angle) * dist;
      
      // These rocks are at the bottom of the crater
      const innerY = height * 0.7 - craterDepth + Math.abs(Math.sin(seed + i * 13)) * 5;
      
      // Create spiky "lava" rocks
      const rock = this.createRock(
        2.0 + Math.abs(Math.sin(seed + i * 19)) * 2.0,
        seed + i * 200,
        innerX, innerY - height * 0.45, innerZ, // Account for the group's position
        new THREE.Vector3(
          Math.sin(seed + i * 29) * Math.PI,
          Math.sin(seed + i * 31) * Math.PI * 2, // More rotation for chaotic look
          Math.sin(seed + i * 37) * Math.PI
        ),
        new THREE.Vector3(
          0.7 + Math.sin(seed + i * 41) * 0.3,
          1.8 + Math.abs(Math.sin(seed + i * 43)) * 0.7, // Much taller/spikier
          0.7 + Math.sin(seed + i * 47) * 0.3
        ),
        this.darkRockMaterial // Dark rocks for the "lava" rocks
      );
      
      craterGroup.add(rock);
    }
    
    // Position and add to scene
    craterGroup.position.set(x, 0, z);
    this.scene.add(craterGroup);
    
    // Add main collider for the volcano
    const mainCollider = new StaticCollider(
      new THREE.Vector3(x, height * 0.4, z),
      'rock',
      outerRadius * 0.8
    );
    this.rockColliders.push(mainCollider);
    
    // Add colliders around the rim
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const colliderX = x + Math.cos(angle) * innerRadius;
      const colliderZ = z + Math.sin(angle) * innerRadius;
      
      const rimCollider = new StaticCollider(
        new THREE.Vector3(colliderX, height * 0.7, colliderZ),
        'rock',
        10 // Size of rim colliders
      );
      this.rockColliders.push(rimCollider);
    }
  }
  
  // Create a chaotic, gravity-defying rock cluster
  createFloatingRocks(x: number, z: number, seed: number) {
    const floatingRockGroup = new THREE.Group();
    
    // Parameters for arrangement
    const radius = 10; // Max distance from center
    const rockCount = 10 + Math.floor(Math.abs(Math.sin(seed) * 5)); // 10-15 rocks
    
    for (let i = 0; i < rockCount; i++) {
      // Generate deterministic positions using trigonometric functions
      const angle = (i / rockCount) * Math.PI * 2;
      const distance = radius * (0.5 + Math.abs(Math.sin(seed + i * 3)) * 0.5);
      
      // Calculate position with some height variation
      const xPos = Math.cos(angle) * distance;
      const yPos = 4 + Math.sin(seed + i * 7) * 3; // Float between 1-7 units high
      const zPos = Math.sin(angle) * distance;
      
      // Size variation
      const size = 0.7 + Math.abs(Math.sin(seed + i * 11)) * 1.3; // Size between 0.7 and 2.0
      
      // Create rock with deterministic properties
      const rock = this.createRock(
        size,
        seed + i * 13,
        xPos, yPos, zPos,
        new THREE.Vector3(
          Math.sin(seed + i * 17) * Math.PI,
          Math.sin(seed + i * 19) * Math.PI,
          Math.sin(seed + i * 23) * Math.PI
        ),
        new THREE.Vector3(
          1.0 + Math.sin(seed + i * 29) * 0.3,
          1.0 + Math.sin(seed + i * 31) * 0.3,
          1.0 + Math.sin(seed + i * 37) * 0.3
        ),
        i % 2 === 0 ? this.rockMaterial : this.darkRockMaterial
      );
      
      floatingRockGroup.add(rock);
      
      // Add individual colliders for each floating rock
      const colliderPosition = new THREE.Vector3(x + xPos, yPos, z + zPos);
      const rockCollider = new StaticCollider(
        colliderPosition,
        'rock',
        size * 1.2 // Slightly larger than visual size
      );
      this.rockColliders.push(rockCollider);
    }
    
    // Position and add to scene
    floatingRockGroup.position.set(x, 0, z);
    this.scene.add(floatingRockGroup);
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
    
    // ======= NEW GIANT MOUNTAIN FORMATIONS =======
    
    // Create multiple massive mountain formations at key locations
    this.createGiantMountain(300, 300, 1234);
    this.createGiantMountain(-300, 300, 5678);
    this.createGiantMountain(300, -300, 9012);
    this.createGiantMountain(-300, -300, 3456);
    
    // Create a mountain range that runs across the map
    this.createMountainRange(0, 250, 200, 6789);
    this.createMountainRange(250, 0, 180, 7890);
    this.createMountainRange(0, -250, 220, 8901);
    this.createMountainRange(-250, 0, 190, 9012);
    
    // Create a few volcanic crater formations
    this.createVolcanicCrater(400, 400, 8765);
    this.createVolcanicCrater(-400, -400, 4321);
  }
  
  // ===== BUILDING AND CITY METHODS =====
  
  createSkyscraper(x: number, z: number, height: number, width: number, depth: number, materialIndex?: number) {
    // Use provided material index or calculate deterministically
    let buildingMaterialIndex = materialIndex;
    if (buildingMaterialIndex === undefined) {
      // Create a deterministic index based on building position
      buildingMaterialIndex = Math.abs(Math.floor(Math.sin(x * 0.1 + z * 0.2) * this.buildingMaterials.length)) % this.buildingMaterials.length;
    }
    const buildingMaterial = this.buildingMaterials[buildingMaterialIndex];
    
    // LOW-POLY APPROACH: Create the building as a single mesh with a simple texture
    // Create the main building structure
    const buildingGeometry = new THREE.BoxGeometry(width, height, depth);
    
    // Create a canvas for the building texture with window pattern
    const textureSize = 512;
    const canvas = document.createElement('canvas');
    canvas.width = textureSize;
    canvas.height = textureSize;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      // Fill with building base color
      const color = buildingMaterial.color;
      ctx.fillStyle = '#' + color.getHexString();
      ctx.fillRect(0, 0, textureSize, textureSize);
      
      // Create window grid pattern - simple and efficient
      const windowRows = 16; // Fixed number for texture
      const windowCols = 16;
      const windowWidth = textureSize / windowCols;
      const windowHeight = textureSize / windowRows;
      
      // Draw windows as simple blue rectangles
      ctx.fillStyle = 'rgba(135, 206, 235, 0.7)'; // Light blue windows
      
      // Vary the window pattern based on materialIndex for diversity
      const offset = buildingMaterialIndex % 4; // 0-3 different patterns
      
      // Create windows based on pattern
      for (let row = 1; row < windowRows; row++) {
        for (let col = 1; col < windowCols; col++) {
          // Skip some windows based on pattern
          if ((row + col + offset) % 4 === 0) continue;
          
          // Draw window
          ctx.fillRect(
            col * windowWidth - windowWidth * 0.8,
            row * windowHeight - windowHeight * 0.8,
            windowWidth * 0.6,
            windowHeight * 0.6
          );
        }
      }
    }
    
    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    
    // Create material with the texture
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      color: buildingMaterial.color,
      roughness: buildingMaterial.roughness,
      metalness: buildingMaterial.metalness
    });
    
    // Create the mesh with the optimized geometry and textured material
    const buildingMesh = new THREE.Mesh(buildingGeometry, material);
    buildingMesh.position.set(x, height / 2, 0);
    buildingMesh.position.y = height / 2; // Position at ground level with height centered
    buildingMesh.position.z = z;
    buildingMesh.castShadow = true;
    buildingMesh.receiveShadow = true;
    
    // Add to scene directly (no group needed)
    this.scene.add(buildingMesh);
    
    // Create a collider box for the building
    const colliderPosition = new THREE.Vector3(x, height / 2, z);
    // Use box collider instead of sphere for better building collision
    const colliderSize = new THREE.Vector3(width, height, depth);
    const buildingCollider = new StaticCollider(colliderPosition, 'building', undefined, colliderSize);
    this.buildingColliders.push(buildingCollider);
    
    return buildingCollider;
  }
  
  createRoad(startX: number, startZ: number, endX: number, endZ: number, width: number) {
    // Calculate road length and direction
    const roadLength = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endZ - startZ, 2));
    const angle = Math.atan2(endZ - startZ, endX - startX);
    
    // Create road geometry
    const roadGeometry = new THREE.PlaneGeometry(roadLength, width);
    const roadMesh = new THREE.Mesh(roadGeometry, this.roadMaterial);
    
    // Position and rotate road
    roadMesh.rotation.x = -Math.PI / 2; // Lay flat on the ground
    roadMesh.rotation.z = -angle; // Align with direction
    
    // Position at midpoint between start and end
    const midX = (startX + endX) / 2;
    const midZ = (startZ + endZ) / 2;
    roadMesh.position.set(midX, 0.1, midZ); // Slightly above ground to prevent z-fighting
    
    // Add to scene
    this.scene.add(roadMesh);
  }
  
  createRockFormation() {
    // Create a large, deterministic rock formation in the center of the map
    const formationRadius = 160; // Size of the rock formation area
    
    // Create a central large mountain/rock
    const centerRockGroup = new THREE.Group();
    
    // Create the central peak - a large irregular mountain
    const peakHeight = 180;
    const peakWidth = 100;
    const peakDepth = 100;
    
    // Create geometries for different parts of the mountain
    const baseGeometry = new THREE.ConeGeometry(peakWidth/2, peakHeight * 0.8, 8);
    const base = new THREE.Mesh(baseGeometry, this.darkRockMaterial);
    base.position.y = peakHeight * 0.4;
    base.castShadow = true;
    base.receiveShadow = true;
    centerRockGroup.add(base);
    
    // Middle section of the mountain
    const middleGeometry = new THREE.ConeGeometry(peakWidth/3, peakHeight * 0.5, 7);
    const middle = new THREE.Mesh(middleGeometry, this.rockMaterial);
    middle.position.y = peakHeight * 0.7;
    middle.castShadow = true;
    middle.receiveShadow = true;
    centerRockGroup.add(middle);
    
    // Peak of the mountain
    const topGeometry = new THREE.ConeGeometry(peakWidth/6, peakHeight * 0.3, 6);
    const top = new THREE.Mesh(topGeometry, this.darkRockMaterial);
    top.position.y = peakHeight * 0.95;
    top.castShadow = true;
    top.receiveShadow = true;
    centerRockGroup.add(top);
    
    // Deform the geometries to make them look more natural
    // We use deterministic deformation by using fixed values
    [base, middle, top].forEach((mesh, i) => {
      const positions = mesh.geometry.attributes.position;
      for (let j = 0; j < positions.count; j++) {
        const vx = positions.getX(j);
        const vy = positions.getY(j);
        const vz = positions.getZ(j);
        
        // Use trigonometric functions with fixed values for deterministic deformation
        const deformSeed = i * 10 + 5;
        const xFactor = 0.9 + Math.sin(vx * deformSeed * 0.1) * 0.3;
        const zFactor = 0.9 + Math.cos(vz * deformSeed * 0.1) * 0.3;
        
        positions.setX(j, vx * xFactor);
        positions.setZ(j, vz * zFactor);
      }
      
      // Signal that the geometry needs an update
      mesh.geometry.attributes.position.needsUpdate = true;
    });
    
    // Add the center rock group to the scene
    centerRockGroup.position.set(0, 0, 0);
    this.scene.add(centerRockGroup);
    
    // Create a collider for the central peak
    const peakCollider = new StaticCollider(
      new THREE.Vector3(0, peakHeight * 0.5, 0),
      'rock',
      peakWidth * 0.6
    );
    this.rockColliders.push(peakCollider);
    
    // Create surrounding rock clusters in a circular pattern
    const clusters = 16; // Number of surrounding rock clusters
    for (let i = 0; i < clusters; i++) {
      const angle = (i / clusters) * Math.PI * 2;
      
      // Vary the distance from center deterministically
      const distance = formationRadius * 0.5 * (0.8 + 0.4 * Math.sin(i * 3.7));
      
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      
      // Create a cluster of rocks at this position
      // Use i as seed for deterministic generation
      this.createRockCluster(x, z, i * 100);
      
      // Add some extra rocks for more complexity
      // Inner ring
      if (i % 2 === 0) {
        const innerDistance = distance * 0.6;
        const innerX = Math.cos(angle) * innerDistance;
        const innerZ = Math.sin(angle) * innerDistance;
        this.createRockCluster(innerX, innerZ, i * 100 + 50);
      }
      
      // Outer ring
      if (i % 3 === 0) {
        const outerDistance = distance * 1.4;
        const outerX = Math.cos(angle) * outerDistance;
        const outerZ = Math.sin(angle) * outerDistance;
        this.createRockCluster(outerX, outerZ, i * 100 + 25);
      }
    }
    
    // Create pathways/clearings through the formation - four cardinal directions
    const pathWidth = 15;
    
    // North-South path
    for (let z = -formationRadius; z <= formationRadius; z += 20) {
      // Create smaller rocks along the path edges
      this.createRock(
        0.8, // Size
        z * 0.1, // Deform seed
        -pathWidth/2, 0.4, z, // Position
        new THREE.Vector3(0, z * 0.1, 0), // Rotation
        new THREE.Vector3(0.8, 0.6, 0.8), // Scale
        this.rockMaterial
      );
      
      this.createRock(
        0.8, // Size
        z * 0.1 + 10, // Deform seed
        pathWidth/2, 0.4, z, // Position
        new THREE.Vector3(0, z * 0.1 + 1, 0), // Rotation
        new THREE.Vector3(0.8, 0.6, 0.8), // Scale
        this.darkRockMaterial
      );
    }
    
    // East-West path
    for (let x = -formationRadius; x <= formationRadius; x += 20) {
      // Create smaller rocks along the path edges
      this.createRock(
        0.8, // Size
        x * 0.1, // Deform seed
        x, 0.4, -pathWidth/2, // Position
        new THREE.Vector3(0, x * 0.1, 0), // Rotation
        new THREE.Vector3(0.8, 0.6, 0.8), // Scale
        this.rockMaterial
      );
      
      this.createRock(
        0.8, // Size
        x * 0.1 + 10, // Deform seed
        x, 0.4, pathWidth/2, // Position
        new THREE.Vector3(0, x * 0.1 + 1, 0), // Rotation
        new THREE.Vector3(0.8, 0.6, 0.8), // Scale
        this.darkRockMaterial
      );
    }
  }
  
  // Methods to get colliders for collision detection
  getAllColliders(): ICollidable[] {
    return [...this.treeColliders, ...this.rockColliders, ...this.buildingColliders];
  }
  
  getTreeColliders(): ICollidable[] {
    return [...this.treeColliders];
  }
  
  getRockColliders(): ICollidable[] {
    return [...this.rockColliders];
  }
  
  getBuildingColliders(): ICollidable[] {
    return [...this.buildingColliders];
  }
}