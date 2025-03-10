import * as THREE from 'three';
import { ICollidable, StaticCollider } from './collision';
import { TreeGenerator } from './trees';

export class MapGenerator {
  private scene: THREE.Scene;
  private treeGenerator: TreeGenerator;
  
  // Collider arrays for environment objects
  private rockColliders: StaticCollider[] = [];
  
  // Materials
  private rockMaterial: THREE.MeshStandardMaterial;
  private darkRockMaterial: THREE.MeshStandardMaterial;
  
  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.treeGenerator = new TreeGenerator(scene);
    
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
    
    // Generate trees after initialization
    this.treeGenerator.generateTrees();
  }
  
  // TreeGenerator will handle all tree creation methods
  
  // Share the noise functions
  noise2D(x: number, y: number, seed: number = 12345): number {
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
  fbm(x: number, y: number, octaves: number = 6, lacunarity: number = 2.0, persistence: number = 0.5, seed: number = 12345): number {
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
  
  // Tree generation is now handled by the TreeGenerator class
  
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
  
  // Calculate rock formation density at a given position
  private rockNoiseValue(x: number, y: number, biomeScale: number = 1.0, heightScale: number = 1.0): {
    value: number,
    size: number,
    height: number,
    type: 'standard' | 'dark'
  } {
    // Use different seeds from tree noise to create distinct patterns
    // Large-scale mountain ranges and geological features
    const mountainRangeNoise = this.fbm(x, y, 2, 2.0, 0.5, 234);
    
    // Medium-scale rock formations
    const formationNoise = this.fbm(x, y, 3, 2.2, 0.5, 567);
    
    // Small-scale rock clusters and details
    const clusterNoise = this.fbm(x, y, 4, 2.5, 0.6, 789);
    
    // Combine noise layers with different weights
    const combinedNoise = 
      mountainRangeNoise * 0.5 + 
      formationNoise * 0.3 + 
      clusterNoise * 0.2;
    
    // Scale by biome factor
    const scaledNoise = combinedNoise * biomeScale;
    
    // Determine rock size based on noise
    const sizeNoise = this.fbm(x, y, 2, 2.0, 0.5, 987);
    const size = (0.7 + sizeNoise * 1.3) * biomeScale;
    
    // Determine rock height based on separate noise
    const heightNoise = this.fbm(x, y, 3, 1.8, 0.6, 654);
    const height = (0.5 + heightNoise * 0.8) * heightScale;
    
    // Determine rock type based on position
    const typeNoise = this.fbm(x, y, 2, 2.5, 0.5, 321);
    const type = typeNoise > 0.5 ? 'standard' : 'dark';
    
    return {
      value: scaledNoise,
      size,
      height,
      type
    };
  }
  
  // Create a rock cluster based on noise patterns
  private createRockFormationFromNoise(x: number, z: number, densityThreshold: number, 
                                      biomeScale: number = 1.0, heightScale: number = 1.0,
                                      formationType: 'cluster' | 'mountain' | 'spire' = 'cluster'): void {
    // Get noise value at this position
    const noise = this.rockNoiseValue(x, z, biomeScale, heightScale);
    
    // Only place rocks where noise value exceeds threshold
    if (noise.value > densityThreshold) {
      // Use noise to determine formation characteristics
      const seed = Math.floor((x * 1000 + z) * noise.value);
      
      if (formationType === 'cluster') {
        this.createRockCluster(x, z, seed);
      } else if (formationType === 'spire' && noise.value > densityThreshold + 0.1) {
        // For spires, use a higher threshold to make them more rare
        const spireHeight = 5 + noise.height * 15; 
        this.createRockSpire(x, z, spireHeight, seed);
      } else if (formationType === 'mountain' && noise.value > densityThreshold + 0.2) {
        // For mountains, use an even higher threshold to make them very rare
        if (this.fbm(x, z, 2, 2.0, 0.5, 111) > 0.75) {
          this.createMountainPeak(x, z, 80 + noise.height * 150, 40 + noise.size * 60, seed);
        } else if (this.fbm(x, z, 2, 2.0, 0.5, 222) > 0.85) {
          this.createBalancedRocks(x, z, 10 + noise.height * 10, seed);
        } else {
          this.createRockArch(
            x, z, 
            10 + noise.size * 20, // width
            5 + noise.height * 10, // height
            5 + noise.size * 10, // depth
            this.fbm(x, z, 1, 1.0, 0.5, 333) * Math.PI * 2, // rotation
            seed
          );
        }
      }
    }
  }
  
  // Create smaller individual rock based on noise
  private createSmallRockFromNoise(x: number, z: number, densityThreshold: number, biomeScale: number = 1.0): void {
    // Get noise value at this position
    const noise = this.rockNoiseValue(x, z, biomeScale, 1.0);
    
    // Only place rocks where noise value exceeds threshold
    if (noise.value > densityThreshold) {
      // Size based on noise
      const size = 0.3 + noise.size * 0.7;
      
      // Position with slight y-variation for more natural look
      const y = 0.2 + noise.height * 0.6;
      
      // Rotation based on position
      const seed = Math.floor((x * 1000 + z) * noise.value);
      const rotX = Math.sin(seed * 0.1) * Math.PI;
      const rotY = Math.cos(seed * 0.2) * Math.PI;
      const rotZ = Math.sin(seed * 0.3) * Math.PI;
      
      // Scale variation
      const scaleX = 0.8 + this.fbm(x, z, 2, 2.0, 0.5, 444) * 0.4;
      const scaleY = 0.8 + this.fbm(x, z, 2, 2.0, 0.5, 555) * 0.4;
      const scaleZ = 0.8 + this.fbm(x, z, 2, 2.0, 0.5, 666) * 0.4;
      
      // Use appropriate material based on noise type
      const material = noise.type === 'standard' ? this.rockMaterial : this.darkRockMaterial;
      
      // Create the rock
      this.createRock(
        size,
        seed,
        x, y, z,
        new THREE.Vector3(rotX, rotY, rotZ),
        new THREE.Vector3(scaleX, scaleY, scaleZ),
        material
      );
    }
  }

  createRocks() {
    // 1. Rocks near the tank starting area
    // Keep the deterministic circle of rocks for gameplay consistency
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const x = Math.cos(angle) * 20; // Closer to center than trees
      const z = Math.sin(angle) * 20;
      this.createRockCluster(x, z, i);
    }
    
    // 2. Rock formations in geometric patterns
    // Keep important gameplay landmarks
    
    // Square formation at corners
    for (let i = 0; i < 4; i++) {
      const x = (i < 2 ? -100 : 100);
      const z = (i % 2 === 0 ? -100 : 100);
      this.createRockCluster(x, z, i + 10);
    }
    
    // 3. Mountain Ranges and Rock Formations - using fractal noise patterns
    
    // Northern mountain region
    for (let x = -400; x <= 400; x += 30) {
      for (let z = 280; z <= 400; z += 30) {
        this.createRockFormationFromNoise(x, z, 0.65, 1.2, 1.1, 'cluster');
      }
    }
    
    // Northern mountain peaks (more sparse)
    for (let x = -350; x <= 350; x += 60) {
      for (let z = 420; z <= 550; z += 60) {
        this.createRockFormationFromNoise(x, z, 0.7, 1.0, 1.2, 'mountain');
      }
    }
    
    // Eastern mountain region
    for (let x = 280; x <= 400; x += 30) {
      for (let z = -400; z <= 400; z += 30) {
        this.createRockFormationFromNoise(x, z, 0.65, 1.2, 1.1, 'cluster');
      }
    }
    
    // Eastern mountain peaks (more sparse) 
    for (let x = 420; x <= 550; x += 60) {
      for (let z = -350; z <= 350; z += 60) {
        this.createRockFormationFromNoise(x, z, 0.7, 1.0, 1.2, 'mountain');
      }
    }
    
    // Southern rock region
    for (let x = -400; x <= 400; x += 30) {
      for (let z = -400; z >= -550; z -= 30) {
        this.createRockFormationFromNoise(x, z, 0.68, 0.9, 0.9, 'cluster');
      }
    }
    
    // Western rock region
    for (let x = -400; x >= -550; x -= 30) {
      for (let z = -400; z <= 400; z += 30) {
        this.createRockFormationFromNoise(x, z, 0.68, 0.9, 0.9, 'cluster');
      }
    }
    
    // Scattered rock spires in all regions
    for (let x = -600; x <= 600; x += 150) {
      for (let z = -600; z <= 600; z += 150) {
        // Use a higher threshold to make them more rare
        this.createRockFormationFromNoise(
          x + this.fbm(x, z, 2, 2.0, 0.5, 777) * 50 - 25,
          z + this.fbm(z, x, 2, 2.0, 0.5, 888) * 50 - 25,
          0.75, 0.8, 1.3, 'spire'
        );
      }
    }
    
    // 4. Stone Circles - ceremonial-looking formations at key locations (preserved for gameplay)
    this.createStoneCircle(500, 500, 50, 12, 400);
    this.createStoneCircle(-500, 500, 50, 12, 500);
    this.createStoneCircle(500, -500, 50, 12, 600);
    this.createStoneCircle(-500, -500, 50, 12, 700);
    
    // 5. Scattered small rocks throughout the map using noise pattern
    const gridSize = 100; // Size of the grid for small rock distribution
    for (let x = -800; x <= 800; x += gridSize) {
      for (let z = -800; z <= 800; z += gridSize) {
        // For each grid cell, place several potential rocks
        for (let i = 0; i < 5; i++) {
          // Use noise to offset position within grid cell
          const offsetX = this.fbm(x + i, z, 2, 2.0, 0.5, 999 + i) * gridSize;
          const offsetZ = this.fbm(x, z + i, 2, 2.0, 0.5, 1000 + i) * gridSize;
          
          // Create small rock if noise value high enough
          this.createSmallRockFromNoise(
            x + offsetX,
            z + offsetZ,
            0.72, // High threshold for sparse distribution
            0.9
          );
        }
      }
    }
    
    // 6. Central mountain formation - important gameplay element
    this.createRockFormation(); // Keep the special central formation
    
    // 7. Major mountain features at key locations
    this.createGiantMountain(300, 300, 1234);
    this.createGiantMountain(-300, 300, 5678);
    this.createGiantMountain(300, -300, 9012);
    this.createGiantMountain(-300, -300, 3456);
    
    // 8. Volcanic craters - distinctive landmarks
    this.createVolcanicCrater(400, 400, 8765);
    this.createVolcanicCrater(-400, -400, 4321);
    
    // 9. Rock ridge lines for more interesting topography
    // Create ridge lines using noise to determine location and properties
    for (let x = -600; x <= 600; x += 200) {
      for (let z = -600; z <= 600; z += 200) {
        // Only place ridge if noise value high enough
        const ridgeNoise = this.fbm(x, z, 3, 2.0, 0.5, 123);
        if (ridgeNoise > 0.6) {
          // Use noise to determine ridge direction and length
          const angle = this.fbm(x, z, 2, 2.0, 0.5, 456) * Math.PI * 2;
          const length = 50 + this.fbm(x, z, 2, 2.0, 0.5, 789) * 100;
          
          // Calculate start and end points
          const startX = x - Math.cos(angle) * length/2;
          const startZ = z - Math.sin(angle) * length/2;
          const endX = x + Math.cos(angle) * length/2;
          const endZ = z + Math.sin(angle) * length/2;
          
          // Height based on noise
          const height = 5 + this.fbm(x, z, 2, 2.0, 0.5, 321) * 10;
          
          // Create the rock wall
          this.createRockWall(startX, startZ, endX, endZ, height, Math.floor(x * z));
        }
      }
    }
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
    return [...this.treeGenerator.getTreeColliders(), ...this.rockColliders];
  }
  
  getTreeColliders(): ICollidable[] {
    return this.treeGenerator.getTreeColliders();
  }
  
  getRockColliders(): ICollidable[] {
    return [...this.rockColliders];
  }
}