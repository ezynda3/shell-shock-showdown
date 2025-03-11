import * as THREE from 'three';
import { ICollidable, StaticCollider } from './collision';

// Define interface for rocks from the server
export interface ServerRock {
  position: {
    x: number;
    y: number;
    z: number;
  };
  type: string;
  size: number;
  rotation: {
    x: number;
    y: number;
    z: number;
  };
  scale: {
    x: number;
    y: number;
    z: number;
  };
  radius: number;
  formation?: string;
}

// Define interface for rock map from the server
export interface ServerRockMap {
  rocks: ServerRock[];
}

export class RockGenerator {
  private scene: THREE.Scene;
  
  // Collider arrays for environment objects
  private rockColliders: StaticCollider[] = [];
  
  // Materials
  private rockMaterial: THREE.MeshStandardMaterial;
  private darkRockMaterial: THREE.MeshStandardMaterial;
  
  // Store the map data from the server
  private serverMapData: ServerRockMap | null = null;
  
  constructor(scene: THREE.Scene) {
    this.scene = scene;
    
    // Initialize materials
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
  
  // Set server map data
  setServerMapData(mapData: ServerRockMap) {
    this.serverMapData = mapData;
  }
  
  // Noise generation functions removed - server now provides all location data
  
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

  // Method to create a mountain peak
  createMountainPeak(x: number, z: number, height: number, radius: number, seed: number) {
    const peakGroup = new THREE.Group();
    
    // Create geometries for different parts of the mountain
    const baseGeometry = new THREE.ConeGeometry(radius, height * 0.8, 8);
    const base = new THREE.Mesh(baseGeometry, this.darkRockMaterial);
    base.position.y = height * 0.4;
    base.castShadow = true;
    base.receiveShadow = true;
    peakGroup.add(base);
    
    // Middle section of the mountain
    const middleGeometry = new THREE.ConeGeometry(radius * 0.7, height * 0.5, 7);
    const middle = new THREE.Mesh(middleGeometry, this.rockMaterial);
    middle.position.y = height * 0.7;
    middle.castShadow = true;
    middle.receiveShadow = true;
    peakGroup.add(middle);
    
    // Peak of the mountain
    const topGeometry = new THREE.ConeGeometry(radius * 0.4, height * 0.3, 6);
    const top = new THREE.Mesh(topGeometry, this.darkRockMaterial);
    top.position.y = height * 0.95;
    top.castShadow = true;
    top.receiveShadow = true;
    peakGroup.add(top);
    
    // Deform the geometries to make them look more natural
    [base, middle, top].forEach((mesh, i) => {
      const positions = mesh.geometry.attributes.position;
      for (let j = 0; j < positions.count; j++) {
        const vx = positions.getX(j);
        const vy = positions.getY(j);
        const vz = positions.getZ(j);
        
        // Use trigonometric functions with fixed values for deterministic deformation
        const deformSeed = i * 10 + seed;
        const xFactor = 0.9 + Math.sin(vx * deformSeed * 0.1) * 0.3;
        const zFactor = 0.9 + Math.cos(vz * deformSeed * 0.1) * 0.3;
        
        positions.setX(j, vx * xFactor);
        positions.setZ(j, vz * zFactor);
      }
      
      // Signal that the geometry needs an update
      mesh.geometry.attributes.position.needsUpdate = true;
    });
    
    // Position the group
    peakGroup.position.set(x, 0, z);
    this.scene.add(peakGroup);
    
    // Add a collider for the mountain
    const colliderPosition = new THREE.Vector3(x, height * 0.5, z);
    const rockCollider = new StaticCollider(
      colliderPosition,
      'rock',
      radius * 0.8
    );
    this.rockColliders.push(rockCollider);
  }
  
  
  // All noise-based generation code removed as we now use server-provided location data

  createRocks() {
    // Use server-side rock data only
    if (this.serverMapData && this.serverMapData.rocks && this.serverMapData.rocks.length > 0) {
      console.log("Using server-provided rock data");
      const rocks = this.serverMapData.rocks;
      
      // Create rocks from the server data
      for (const rock of rocks) {
        const { position, type, size, rotation, scale } = rock;
        
        // Create rock geometry
        const rockGeometry = new THREE.DodecahedronGeometry(size, 0);
        
        // Deterministically deform vertices based on position
        const positions = rockGeometry.attributes.position;
        const deformSeed = Math.random() * 100; // Simple random seed for deformation
        
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
        
        // Determine material based on rock type
        const material = type === 'standard' ? this.rockMaterial : this.darkRockMaterial;
        
        // Create the rock mesh
        const rockMesh = new THREE.Mesh(rockGeometry, material);
        
        // Set position, rotation and scale
        rockMesh.position.set(position.x, position.y, position.z);
        rockMesh.rotation.set(rotation.x, rotation.y, rotation.z);
        rockMesh.scale.set(scale.x, scale.y, scale.z);
        
        rockMesh.castShadow = true;
        rockMesh.receiveShadow = true;
        
        // Add to scene
        this.scene.add(rockMesh);
        
        // Create a collider for the rock
        const rockCollider = new StaticCollider(
          new THREE.Vector3(position.x, position.y, position.z),
          'rock',
          rock.radius
        );
        this.rockColliders.push(rockCollider);
      }
    } else {
      console.log("No server rock data available");
    }
  }
  
  
  createRockFormation() {
    // This method intentionally left empty after rock formation removal
  }
  
  // Get rock colliders for collision detection
  getRockColliders(): ICollidable[] {
    return [...this.rockColliders];
  }
}