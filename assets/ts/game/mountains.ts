import * as THREE from 'three';
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';
import { ICollidable, StaticCollider } from './collision';

export class MountainGenerator {
  private scene: THREE.Scene;
  private noise: ImprovedNoise;
  
  // Collider arrays for mountains
  private mountainColliders: StaticCollider[] = [];
  
  // Materials
  private mountainMaterial: THREE.MeshStandardMaterial;
  private snowMaterial: THREE.MeshStandardMaterial;
  
  constructor(scene: THREE.Scene) {
    this.scene = scene;
    
    // Initialize noise with deterministic seed
    this.noise = new ImprovedNoise();
    
    // Initialize materials
    this.mountainMaterial = new THREE.MeshStandardMaterial({
      color: 0x61584b, // Brown-gray
      roughness: 0.9,
      metalness: 0.1
    });
    
    this.snowMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, // White
      roughness: 0.8,
      metalness: 0.1
    });
  }
  
  // Create a mountain range using ImprovedNoise
  createMountainRange(centerX: number, centerZ: number, width: number, depth: number, height: number, resolution: number = 64, seed: number = 12345) {
    // Create a plane geometry for the mountain base
    const geometry = new THREE.PlaneGeometry(width, depth, resolution - 1, resolution - 1);
    geometry.rotateX(-Math.PI / 2); // Rotate to be horizontal
    
    // Get the positions attribute for modification
    const positions = geometry.attributes.position;
    
    // Create a deterministic height map using ImprovedNoise
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      
      // Normalize coordinates to the 0-1 range for noise generation
      const nx = (x / width) + 0.5;
      const nz = (z / depth) + 0.5;
      
      // Add seed influence to make the mountain deterministic
      // We're using the sine of the seed to affect the noise coordinates
      const seedOffsetX = Math.sin(seed * 0.1) * 100;
      const seedOffsetZ = Math.cos(seed * 0.1) * 100;
      
      // Generate base mountain shape with large-scale noise
      let y = 0;
      
      // Large scale terrain features (base mountain shape)
      y += this.noise.noise(nx * 3 + seedOffsetX, 0, nz * 3 + seedOffsetZ) * 0.5 + 0.5;
      
      // Medium scale details
      y += (this.noise.noise(nx * 6 + seedOffsetX, 0, nz * 6 + seedOffsetZ) * 0.5 + 0.5) * 0.25;
      
      // Small scale details
      y += (this.noise.noise(nx * 12 + seedOffsetX, 0, nz * 12 + seedOffsetZ) * 0.5 + 0.5) * 0.125;
      
      // Ridge effect by taking absolute of noise values
      const ridgeNoise = Math.abs(this.noise.noise(nx * 4 + seedOffsetX, 0, nz * 4 + seedOffsetZ));
      y += ridgeNoise * 0.2;
      
      // Apply falloff from center to edges for a more natural mountain shape
      const distFromCenterX = Math.abs(x) / (width * 0.5);
      const distFromCenterZ = Math.abs(z) / (depth * 0.5);
      const distFromCenter = Math.sqrt(distFromCenterX * distFromCenterX + distFromCenterZ * distFromCenterZ);
      
      // Circular falloff
      const falloff = Math.max(0, 1 - Math.pow(distFromCenter, 2));
      
      // Apply height and falloff
      positions.setY(i, y * height * falloff);
    }
    
    // Update normals for proper lighting
    geometry.computeVertexNormals();
    
    // Create mountain mesh with the material
    const mountain = new THREE.Mesh(geometry, this.mountainMaterial);
    
    // Position the mountain with base slightly below ground level to avoid seams
    mountain.position.set(centerX, -1, centerZ);
    
    // Enable shadows
    mountain.castShadow = true;
    mountain.receiveShadow = true;
    
    // Add to scene
    this.scene.add(mountain);
    
    // Create snow cap for the mountain if tall enough
    if (height > 100) {
      this.createSnowCap(centerX, centerZ, width, depth, height, resolution, seed);
    }
    
    // Add colliders for the mountain
    this.addMountainColliders(centerX, centerZ, width, depth, height);
    
    return mountain;
  }
  
  // Create a snow cap for the mountain peaks
  private createSnowCap(centerX: number, centerZ: number, width: number, depth: number, height: number, resolution: number, seed: number) {
    // Create a snow cap geometry with the same resolution as the mountain
    const snowGeometry = new THREE.PlaneGeometry(width, depth, resolution - 1, resolution - 1);
    snowGeometry.rotateX(-Math.PI / 2); // Rotate to be horizontal
    
    // Get the positions attribute for modification
    const positions = snowGeometry.attributes.position;
    
    // Snow line height (where snow begins) - set to 70% of mountain height
    const snowLineHeight = height * 0.7;
    
    // Create a heightmap for the snow using the same noise pattern as the mountain
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      
      // Normalize coordinates to the 0-1 range for noise generation
      const nx = (x / width) + 0.5;
      const nz = (z / depth) + 0.5;
      
      // Add seed influence to make the mountain deterministic
      const seedOffsetX = Math.sin(seed * 0.1) * 100;
      const seedOffsetZ = Math.cos(seed * 0.1) * 100;
      
      // Generate the same height map as the mountain
      let y = 0;
      
      // Large scale terrain features
      y += this.noise.noise(nx * 3 + seedOffsetX, 0, nz * 3 + seedOffsetZ) * 0.5 + 0.5;
      
      // Medium scale details
      y += (this.noise.noise(nx * 6 + seedOffsetX, 0, nz * 6 + seedOffsetZ) * 0.5 + 0.5) * 0.25;
      
      // Small scale details
      y += (this.noise.noise(nx * 12 + seedOffsetX, 0, nz * 12 + seedOffsetZ) * 0.5 + 0.5) * 0.125;
      
      // Ridge effect
      const ridgeNoise = Math.abs(this.noise.noise(nx * 4 + seedOffsetX, 0, nz * 4 + seedOffsetZ));
      y += ridgeNoise * 0.2;
      
      // Apply falloff from center to edges
      const distFromCenterX = Math.abs(x) / (width * 0.5);
      const distFromCenterZ = Math.abs(z) / (depth * 0.5);
      const distFromCenter = Math.sqrt(distFromCenterX * distFromCenterX + distFromCenterZ * distFromCenterZ);
      
      // Circular falloff
      const falloff = Math.max(0, 1 - Math.pow(distFromCenter, 2));
      
      // Calculate mountain height at this position
      const mountainHeight = y * height * falloff;
      
      // Only show snow above the snow line, otherwise push the vertex down
      if (mountainHeight > snowLineHeight) {
        // Add a small offset to prevent z-fighting
        positions.setY(i, mountainHeight + 0.2);
      } else {
        // Move below the terrain to hide these vertices
        positions.setY(i, -1000);
      }
    }
    
    // Update normals for proper lighting
    snowGeometry.computeVertexNormals();
    
    // Create snow mesh
    const snow = new THREE.Mesh(snowGeometry, this.snowMaterial);
    
    // Position the snow at the same level as the mountain
    snow.position.set(centerX, -1, centerZ);
    
    // Enable shadows
    snow.castShadow = true;
    snow.receiveShadow = true;
    
    // Add to scene
    this.scene.add(snow);
    
    return snow;
  }
  
  // Add colliders for the mountain
  private addMountainColliders(centerX: number, centerZ: number, width: number, depth: number, height: number) {
    // Create a simple collision boundary for the mountain
    // Here we just use a few large spherical colliders instead of trying to match the precise shape
    
    // Central peak collider
    const peakCollider = new StaticCollider(
      new THREE.Vector3(centerX, height * 0.5 - 1, centerZ),
      'mountain',
      Math.min(width, depth) * 0.3
    );
    this.mountainColliders.push(peakCollider);
    
    // Add some additional colliders around the base
    const colliderCount = 4;
    const radius = Math.min(width, depth) * 0.25;
    
    for (let i = 0; i < colliderCount; i++) {
      const angle = (i / colliderCount) * Math.PI * 2;
      const distance = Math.min(width, depth) * 0.3;
      
      const x = centerX + Math.cos(angle) * distance;
      const z = centerZ + Math.sin(angle) * distance;
      
      const collider = new StaticCollider(
        new THREE.Vector3(x, height * 0.3 - 1, z),
        'mountain',
        radius
      );
      
      this.mountainColliders.push(collider);
    }
  }
  
  // Generate a mountain range with multiple peaks
  createMountainRangeGroup(centerX: number, centerZ: number, width: number, depth: number, peakCount: number = 3, seed: number = 12345) {
    // Create a group to hold all mountains
    const mountainGroup = new THREE.Group();
    
    // Create multiple mountain peaks with varied heights and positions
    for (let i = 0; i < peakCount; i++) {
      // Use deterministic offsets based on the seed
      const offsetX = (Math.sin(seed + i * 100) * 0.5) * width * 0.5;
      const offsetZ = (Math.cos(seed + i * 100) * 0.5) * depth * 0.5;
      
      // Vary the mountain size based on position
      const sizeVariation = 0.6 + Math.sin(seed + i * 200) * 0.4;
      const peakWidth = width * sizeVariation * 0.6;
      const peakDepth = depth * sizeVariation * 0.6;
      
      // Vary the height based on position
      const heightVariation = 0.7 + Math.sin(seed + i * 300) * 0.3;
      const peakHeight = (100 + i * 50) * heightVariation;
      
      // Create the mountain
      this.createMountainRange(
        centerX + offsetX,
        centerZ + offsetZ,
        peakWidth,
        peakDepth,
        peakHeight,
        64, // resolution
        seed + i * 1000 // Unique seed for each peak
      );
    }
    
    // Add the mountain group to the scene
    this.scene.add(mountainGroup);
    
    return mountainGroup;
  }
  
  // Get all mountain colliders
  getMountainColliders(): ICollidable[] {
    return [...this.mountainColliders];
  }
}