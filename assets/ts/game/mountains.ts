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
    
    // Fix the noise seed by extending ImprovedNoise
    // @ts-ignore - Access private property to set seed
    this.noise.p = [151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180];
    
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
    
    // Add colliders around the base of the mountain in a complete ring
    const mainBaseColliderCount = 12; // Increased from 4 to 12 for better coverage
    const mainRadius = Math.min(width, depth) * 0.25;
    const mainDistance = Math.min(width, depth) * 0.3;
    
    // First layer - primary ring of colliders with no gaps
    for (let i = 0; i < mainBaseColliderCount; i++) {
      const angle = (i / mainBaseColliderCount) * Math.PI * 2;
      const x = centerX + Math.cos(angle) * mainDistance;
      const z = centerZ + Math.sin(angle) * mainDistance;
      
      const collider = new StaticCollider(
        new THREE.Vector3(x, height * 0.3 - 1, z),
        'mountain',
        mainRadius
      );
      
      this.mountainColliders.push(collider);
    }
    
    // Second layer - outer ring of colliders
    const outerBaseColliderCount = 8;
    const outerRadius = Math.min(width, depth) * 0.2;
    const outerDistance = Math.min(width, depth) * 0.45;
    
    for (let i = 0; i < outerBaseColliderCount; i++) {
      const angle = ((i / outerBaseColliderCount) * Math.PI * 2) + (Math.PI / outerBaseColliderCount); // Offset
      const x = centerX + Math.cos(angle) * outerDistance;
      const z = centerZ + Math.sin(angle) * outerDistance;
      
      const collider = new StaticCollider(
        new THREE.Vector3(x, height * 0.2 - 1, z),
        'mountain',
        outerRadius
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