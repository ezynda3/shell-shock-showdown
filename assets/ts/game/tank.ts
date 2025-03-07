import * as THREE from 'three';
import { Shell } from './shell';

// Interface for objects that can be collided with
export interface ICollidable {
  getCollider(): THREE.Sphere | THREE.Box3;
  getPosition(): THREE.Vector3;
  getType(): string;
  onCollision?(other: ICollidable): void;
}

// Interface for common tank properties and methods
export interface ITank extends ICollidable {
  tank: THREE.Group;
  turretPivot: THREE.Group;
  barrelPivot: THREE.Group;
  update(keys?: { [key: string]: boolean }, colliders?: ICollidable[]): Shell | null;
  dispose(): void;
  takeDamage(amount: number): boolean; // Returns true if tank is destroyed
  getHealth(): number; // Returns current health percentage (0-100)
  respawn(position?: THREE.Vector3): void; // Respawn the tank
  getMinBarrelElevation(): number; // Get minimum barrel elevation angle
  getMaxBarrelElevation(): number; // Get maximum barrel elevation angle
}

export class Tank implements ITank {
  // Tank components
  tank: THREE.Group;
  tankBody?: THREE.Mesh;
  turret?: THREE.Mesh;
  turretPivot: THREE.Group;
  barrel?: THREE.Mesh;
  barrelPivot: THREE.Group;
  
  // Tank properties
  private tankSpeed = 0.15;
  private tankRotationSpeed = 0.05;
  private turretRotationSpeed = 0.04;
  private barrelElevationSpeed = 0.03;
  private maxBarrelElevation = 0;           // Barrel can't go lower than starting position
  private minBarrelElevation = -Math.PI / 4; // Barrel pointing up limit
  
  // Getter methods for barrel elevation limits
  getMinBarrelElevation(): number {
    return this.minBarrelElevation;
  }
  
  getMaxBarrelElevation(): number {
    return this.maxBarrelElevation;
  }
  
  // Collision properties
  private collider: THREE.Sphere;
  private collisionRadius = 2.0; // Size of the tank's collision sphere
  private lastPosition = new THREE.Vector3();
  
  // Firing properties
  private canFire = true;
  private readonly RELOAD_TIME = 60; // 1 second cooldown at 60fps
  private reloadCounter = 0;
  private readonly SHELL_SPEED = 6.0; // 4x from 1.5 for much longer range
  private readonly BARREL_END_OFFSET = 1.5; // Distance from turret pivot to end of barrel
  
  // Health properties
  private health: number = 100; // Full health
  private readonly MAX_HEALTH: number = 100;
  private isDestroyed: boolean = false;
  private destroyedEffects: THREE.Object3D[] = [];
  
  private scene: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;

  constructor(scene: THREE.Scene, camera?: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
    
    // Initialize tank group
    this.tank = new THREE.Group();
    this.turretPivot = new THREE.Group();
    this.barrelPivot = new THREE.Group();
    
    // Create tank model
    this.createTank();
    
    // Initialize collision sphere
    this.collider = new THREE.Sphere(this.tank.position.clone(), this.collisionRadius);
    this.lastPosition = this.tank.position.clone();
    
    // Add to scene
    scene.add(this.tank);
  }

  private createTank() {
    // Tank body
    const bodyGeometry = new THREE.BoxGeometry(2, 0.75, 3);
    const bodyMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x4a7c59,  // Dark green
      roughness: 0.7,
      metalness: 0.3
    });
    this.tankBody = new THREE.Mesh(bodyGeometry, bodyMaterial);
    this.tankBody.position.y = 0.75 / 2;
    this.tankBody.castShadow = true;
    this.tankBody.receiveShadow = true;
    this.tank.add(this.tankBody);
    
    // Tracks (left and right)
    const trackGeometry = new THREE.BoxGeometry(0.4, 0.5, 3.2);
    const trackMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x333333, 
      roughness: 0.9,
      metalness: 0.2
    });
    
    const leftTrack = new THREE.Mesh(trackGeometry, trackMaterial);
    leftTrack.position.set(-1, 0.25, 0);
    leftTrack.castShadow = true;
    leftTrack.receiveShadow = true;
    this.tank.add(leftTrack);
    
    const rightTrack = new THREE.Mesh(trackGeometry, trackMaterial);
    rightTrack.position.set(1, 0.25, 0);
    rightTrack.castShadow = true;
    rightTrack.receiveShadow = true;
    this.tank.add(rightTrack);
    
    // Create turret group for Y-axis rotation
    this.turretPivot = new THREE.Group();
    this.turretPivot.position.set(0, 1.0, 0); // Position at top of tank body, slightly higher
    this.tank.add(this.turretPivot);
    
    // Turret base (dome)
    const turretGeometry = new THREE.CylinderGeometry(0.8, 0.8, 0.5, 16);
    const turretMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x3f5e49,  // Slightly different green
      roughness: 0.7,
      metalness: 0.3
    });
    this.turret = new THREE.Mesh(turretGeometry, turretMaterial);
    this.turret.castShadow = true;
    this.turret.receiveShadow = true;
    this.turretPivot.add(this.turret);
    
    // Create a group for the barrel - this will handle the elevation
    const barrelGroup = new THREE.Group();
    
    // Position the pivot point at the front edge of the turret (not the center)
    barrelGroup.position.set(0, 0, 0.8); // 0.8 is the radius of the turret
    this.turretPivot.add(barrelGroup);
    
    // Create the barrel using a rotated cylinder
    const barrelGeometry = new THREE.CylinderGeometry(0.2, 0.2, 2, 16);
    const barrelMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x333333, 
      roughness: 0.7,
      metalness: 0.5
    });
    
    this.barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
    
    // Rotate the cylinder to point forward (perpendicular to tank)
    this.barrel.rotation.x = Math.PI / 2;
    
    // Position the barrel so one end is at the pivot point
    this.barrel.position.set(0, 0, 1); // Half the length of the barrel
    
    this.barrel.castShadow = true;
    barrelGroup.add(this.barrel);
    
    // Store reference to the barrelGroup for elevation control
    this.barrelPivot = barrelGroup;
    
    // Set initial barrel elevation to exactly horizontal (0 degrees)
    this.barrelPivot.rotation.x = 0;
    
    // Ensure the barrel is properly oriented for horizontal firing
    // This ensures shells fly straight initially and don't hit the ground immediately
    this.barrel.rotation.x = Math.PI / 2; // Barrel cylinder points along z-axis
  }


  update(keys: { [key: string]: boolean }, colliders?: ICollidable[]): Shell | null {
    // If tank is destroyed, don't process movement or firing
    if (this.isDestroyed) {
      return null;
    }
    
    // Store the current position before movement
    this.lastPosition.copy(this.tank.position);
    
    // Handle reloading
    if (!this.canFire) {
      this.reloadCounter++;
      if (this.reloadCounter >= this.RELOAD_TIME) {
        this.canFire = true;
        this.reloadCounter = 0;
      }
    }
    
    // Tank movement
    if (keys['w'] || keys['W']) {
      // Move forward in the direction the tank is facing
      this.tank.position.x += Math.sin(this.tank.rotation.y) * this.tankSpeed;
      this.tank.position.z += Math.cos(this.tank.rotation.y) * this.tankSpeed;
    }
    
    if (keys['s'] || keys['S']) {
      // Move backward in the direction the tank is facing
      this.tank.position.x -= Math.sin(this.tank.rotation.y) * this.tankSpeed;
      this.tank.position.z -= Math.cos(this.tank.rotation.y) * this.tankSpeed;
    }
    
    // Tank rotation
    if (keys['a'] || keys['A']) {
      this.tank.rotation.y += this.tankRotationSpeed;
    }
    
    if (keys['d'] || keys['D']) {
      this.tank.rotation.y -= this.tankRotationSpeed;
    }
    
    // Turret rotation (independent of tank rotation)
    if (keys['arrowleft'] || keys['ArrowLeft']) {
      this.turretPivot.rotation.y += this.turretRotationSpeed;
    }
    
    if (keys['arrowright'] || keys['ArrowRight']) {
      this.turretPivot.rotation.y -= this.turretRotationSpeed;
    }
    
    // Barrel elevation (using the barrel pivot group instead of the barrel itself)
    if (keys['arrowup'] || keys['ArrowUp']) {
      // Move barrel up (decreasing rotation.x value)
      this.barrelPivot.rotation.x = Math.max(
        this.minBarrelElevation,
        this.barrelPivot.rotation.x - this.barrelElevationSpeed
      );
    }
    
    if (keys['arrowdown'] || keys['ArrowDown']) {
      // Move barrel down (increasing rotation.x value)
      this.barrelPivot.rotation.x = Math.min(
        this.maxBarrelElevation,
        this.barrelPivot.rotation.x + this.barrelElevationSpeed
      );
    }
    
    // Update collider position
    this.collider.center.copy(this.tank.position);
    
    // Handle collisions
    if (colliders) {
      for (const collider of colliders) {
        // Skip self-collision
        if (collider === this) continue;
        
        // Check for collision
        if (this.checkCollision(collider)) {
          // If collision occurred, move back to last position
          this.tank.position.copy(this.lastPosition);
          this.collider.center.copy(this.lastPosition);
          break;
        }
      }
    }
    
    // Handle firing - use space, 'f', or left mouse button
    if ((keys['space'] || keys[' '] || keys['f'] || keys['mousefire']) && this.canFire) {
      console.log('Firing shell!');
      return this.fireShell();
    }
    
    return null;
  }
  
  private fireShell(): Shell {
    // Set reload timer
    this.canFire = false;
    this.reloadCounter = 0;
    
    // Calculate barrel end position
    const barrelEndPosition = new THREE.Vector3(0, 0, this.BARREL_END_OFFSET);
    
    // Apply barrel pivot rotation
    barrelEndPosition.applyEuler(new THREE.Euler(
      this.barrelPivot.rotation.x,
      0,
      0
    ));
    
    // Apply turret rotation
    barrelEndPosition.applyEuler(new THREE.Euler(
      0,
      this.turretPivot.rotation.y,
      0
    ));
    
    // Apply tank rotation and position
    barrelEndPosition.applyEuler(new THREE.Euler(
      0,
      this.tank.rotation.y,
      0
    ));
    barrelEndPosition.add(this.turretPivot.position.clone().add(this.tank.position));
    
    // Calculate firing direction
    const direction = new THREE.Vector3();
    
    // Start with forward vector
    direction.set(0, 0, 1);
    
    // Apply barrel elevation
    direction.applyEuler(new THREE.Euler(
      this.barrelPivot.rotation.x,
      0,
      0
    ));
    
    // Apply turret rotation
    direction.applyEuler(new THREE.Euler(
      0,
      this.turretPivot.rotation.y,
      0
    ));
    
    // Apply tank rotation
    direction.applyEuler(new THREE.Euler(
      0,
      this.tank.rotation.y,
      0
    ));
    
    // Create and return new shell
    return new Shell(
      this.scene,
      barrelEndPosition,
      direction,
      this.SHELL_SPEED,
      this
    );
  }
  
  // Implement ICollidable interface
  getCollider(): THREE.Sphere {
    return this.collider;
  }
  
  getPosition(): THREE.Vector3 {
    return this.tank.position.clone();
  }
  
  getType(): string {
    return 'tank';
  }
  
  onCollision(other: ICollidable): void {
    // Move back to last position
    this.tank.position.copy(this.lastPosition);
    this.collider.center.copy(this.lastPosition);
  }
  
  private checkCollision(other: ICollidable): boolean {
    const otherCollider = other.getCollider();
    
    if (otherCollider instanceof THREE.Sphere) {
      // Sphere-Sphere collision
      const distance = this.tank.position.distanceTo(other.getPosition());
      return distance < (this.collider.radius + otherCollider.radius);
    } else if (otherCollider instanceof THREE.Box3) {
      // Sphere-Box collision
      return otherCollider.intersectsSphere(this.collider);
    }
    
    return false;
  }

  updateCamera(camera: THREE.PerspectiveCamera) {
    // Camera follows tank and turret direction
    const cameraOffset = new THREE.Vector3(0, 4, -8); // Decreased height to show more sky
    
    // Calculate the combined rotation of tank body and turret
    const combinedAngle = this.tank.rotation.y + this.turretPivot.rotation.y;
    
    // Rotate the offset based on the combined rotation
    const rotatedOffset = cameraOffset.clone();
    rotatedOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), combinedAngle);
    
    // Apply the offset to the tank's position
    camera.position.copy(this.tank.position).add(rotatedOffset);
    
    // Calculate a look target that considers both tank position and turret direction
    const lookDirection = new THREE.Vector3(0, 0, 10); // Look forward
    lookDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), combinedAngle); // Apply rotation
    
    // Set the target position with some height adjustment
    const targetPosition = this.tank.position.clone().add(lookDirection).add(new THREE.Vector3(0, 4, 0));
    camera.lookAt(targetPosition);
  }
  
  dispose() {
    // Clean up resources
    this.scene.remove(this.tank);
    
    // Clean up any destroyed effects
    for (const effect of this.destroyedEffects) {
      this.scene.remove(effect);
    }
    this.destroyedEffects = [];
  }
  
  // Health methods
  takeDamage(amount: number): boolean {
    if (this.isDestroyed) return true;
    
    // Apply damage to tank
    this.health = Math.max(0, this.health - amount);
    
    // Debug
    console.log(`Tank taking damage: ${amount}, remaining health: ${this.health}`);
    
    // Check if destroyed
    if (this.health <= 0) {
      this.health = 0;
      this.isDestroyed = true;
      this.createDestroyedEffect();
      return true;
    }
    
    // Update health bar
    this.updateHealthBar();
    
    return false;
  }
  
  getHealth(): number {
    return this.health;
  }
  
  respawn(position?: THREE.Vector3): void {
    // Reset health
    this.health = this.MAX_HEALTH;
    this.isDestroyed = false;
    
    // Reset position if provided
    if (position) {
      this.tank.position.copy(position);
    } else {
      // Default respawn at origin
      this.tank.position.set(0, 0, 0);
    }
    
    // Make tank visible again
    this.tank.visible = true;
    
    // Make health bar visible again
    if (this.healthBarSprite) {
      this.healthBarSprite.visible = true;
    }
    
    // Reset collider
    this.collider.center.copy(this.tank.position);
    
    // Remove destroyed effects
    for (const effect of this.destroyedEffects) {
      this.scene.remove(effect);
    }
    this.destroyedEffects = [];
  }
  
  private createDestroyedEffect(): void {
    // Hide the tank
    this.tank.visible = false;
    
    // Hide health bar sprite
    if (this.healthBarSprite) {
      this.healthBarSprite.visible = false;
    }
    
    // Create black smoke particle system
    const particleCount = 50;
    const smokeGeometry = new THREE.BufferGeometry();
    const smokePositions = new Float32Array(particleCount * 3);
    const smokeColors = new Float32Array(particleCount * 3);
    
    // Create random positions within a sphere
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      const radius = 1.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      
      smokePositions[i3] = this.tank.position.x + radius * Math.sin(phi) * Math.cos(theta);
      smokePositions[i3 + 1] = this.tank.position.y + radius * Math.cos(phi) + 1; // Slightly above ground
      smokePositions[i3 + 2] = this.tank.position.z + radius * Math.sin(phi) * Math.sin(theta);
      
      // Dark smoke color (dark gray to black)
      const darkness = 0.1 + Math.random() * 0.2;
      smokeColors[i3] = darkness;
      smokeColors[i3 + 1] = darkness;
      smokeColors[i3 + 2] = darkness;
    }
    
    smokeGeometry.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
    smokeGeometry.setAttribute('color', new THREE.BufferAttribute(smokeColors, 3));
    
    const smokeMaterial = new THREE.PointsMaterial({
      size: 0.7,
      vertexColors: true,
      transparent: true,
      opacity: 0.8
    });
    
    const smokeParticles = new THREE.Points(smokeGeometry, smokeMaterial);
    this.scene.add(smokeParticles);
    this.destroyedEffects.push(smokeParticles);
    
    // Create fire effect (orange-red particles)
    const fireCount = 30;
    const fireGeometry = new THREE.BufferGeometry();
    const firePositions = new Float32Array(fireCount * 3);
    const fireColors = new Float32Array(fireCount * 3);
    
    // Create random positions for fire (concentrated lower)
    for (let i = 0; i < fireCount; i++) {
      const i3 = i * 3;
      const radius = 1.0;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI / 2; // Concentrate in lower hemisphere
      
      firePositions[i3] = this.tank.position.x + radius * Math.sin(phi) * Math.cos(theta);
      firePositions[i3 + 1] = this.tank.position.y + 0.5; // Lower than smoke
      firePositions[i3 + 2] = this.tank.position.z + radius * Math.sin(phi) * Math.sin(theta);
      
      // Fire colors (orange to red)
      fireColors[i3] = 0.9 + Math.random() * 0.1; // Red
      fireColors[i3 + 1] = 0.3 + Math.random() * 0.3; // Green
      fireColors[i3 + 2] = 0; // No blue
    }
    
    fireGeometry.setAttribute('position', new THREE.BufferAttribute(firePositions, 3));
    fireGeometry.setAttribute('color', new THREE.BufferAttribute(fireColors, 3));
    
    const fireMaterial = new THREE.PointsMaterial({
      size: 0.5,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    
    const fireParticles = new THREE.Points(fireGeometry, fireMaterial);
    this.scene.add(fireParticles);
    this.destroyedEffects.push(fireParticles);
  }
  
  // Debug helper to visualize the collision sphere (for development)
  visualizeCollider(): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(this.collisionRadius, 16, 16);
    const material = new THREE.MeshBasicMaterial({ 
      color: 0xff0000,
      wireframe: true,
      transparent: true,
      opacity: 0.3
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(this.tank.position);
    this.scene.add(mesh);
    return mesh;
  }
}

export class NPCTank implements ITank {
  // Tank components
  tank: THREE.Group;
  tankBody?: THREE.Mesh;
  turret?: THREE.Mesh;
  turretPivot: THREE.Group;
  barrel?: THREE.Mesh;
  barrelPivot: THREE.Group;
  
  // Implement required interface methods
  getMinBarrelElevation(): number {
    return this.minBarrelElevation;
  }
  
  getMaxBarrelElevation(): number {
    return this.maxBarrelElevation;
  }
  
  // Tank properties
  private tankSpeed = 0.1;
  private tankRotationSpeed = 0.03;
  private turretRotationSpeed = 0.02;
  private barrelElevationSpeed = 0.01;
  private maxBarrelElevation = 0;
  private minBarrelElevation = -Math.PI / 4;
  
  // NPC behavior properties
  private movementPattern: 'circle' | 'zigzag' | 'random' | 'patrol';
  private movementTimer = 0;
  private changeDirectionInterval: number;
  private currentDirection = 0; // Angle in radians
  private targetPosition = new THREE.Vector3();
  private patrolPoints: THREE.Vector3[] = [];
  private currentPatrolIndex = 0;
  private tankColor: number;
  
  // Collision properties
  private collider: THREE.Sphere;
  private collisionRadius = 2.0; // Size of the tank's collision sphere
  private lastPosition = new THREE.Vector3();
  private collisionResetTimer = 0;
  private readonly COLLISION_RESET_DELAY = 60; // Frames to wait after collision before trying new direction
  
  // Firing properties
  private canFire = true;
  private readonly RELOAD_TIME = 180; // 3 second cooldown at 60fps - slower than player for balance
  private reloadCounter = 0;
  private readonly SHELL_SPEED = 4.8; // 4x from 1.2 but still slower than player
  private readonly BARREL_END_OFFSET = 1.5; // Distance from turret pivot to end of barrel
  private readonly FIRE_PROBABILITY = 0.01; // 1% chance to fire each frame when canFire is true
  private readonly TARGETING_DISTANCE = 300; // Increased from 100 to match new shell range
  
  // Health properties
  private health: number = 100; // Full health
  private readonly MAX_HEALTH: number = 100;
  private isDestroyed: boolean = false;
  private destroyedEffects: THREE.Object3D[] = [];
  
  // Health bar display
  private healthBarSprite: THREE.Sprite;
  private healthBarContext: CanvasRenderingContext2D | null = null;
  private healthBarTexture: THREE.CanvasTexture | null = null;

  private scene: THREE.Scene;

  constructor(scene: THREE.Scene, position: THREE.Vector3, color = 0xff0000) {
    this.scene = scene;
    this.tankColor = color;
    
    // Initialize tank group
    this.tank = new THREE.Group();
    this.turretPivot = new THREE.Group();
    this.barrelPivot = new THREE.Group();
    
    // Create tank model
    this.createTank();
    
    // Set initial position
    this.tank.position.copy(position);
    this.lastPosition = this.tank.position.clone();
    
    // Initialize collision sphere
    this.collider = new THREE.Sphere(this.tank.position.clone(), this.collisionRadius);
    
    // Pick a random movement pattern
    const patterns: ('circle' | 'zigzag' | 'random' | 'patrol')[] = ['circle', 'zigzag', 'random', 'patrol'];
    this.movementPattern = patterns[Math.floor(Math.random() * patterns.length)];
    
    // Set random change direction interval (between 2-5 seconds at 60fps)
    this.changeDirectionInterval = Math.floor(Math.random() * 180) + 120;
    
    // If patrol pattern, set up patrol points
    if (this.movementPattern === 'patrol') {
      this.setupPatrolPoints();
    }
    
    // Create health bar
    this.createHealthBar();
    
    // Add to scene
    scene.add(this.tank);
  }
  
  private createHealthBar(): void {
    // Follow the billboarding example from three.js manual
    // Creating a canvas for the health bar
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 16;
    const context = canvas.getContext('2d');
    
    if (context) {
      // Draw the background (black)
      context.fillStyle = 'rgba(0,0,0,0.6)';
      context.fillRect(0, 0, 64, 16);
      
      // Draw the health bar (green)
      context.fillStyle = '#00FF00';
      context.fillRect(2, 2, 60, 12);
      
      // Create a texture from the canvas
      const texture = new THREE.CanvasTexture(canvas);
      
      // Store the canvas context for updating the health bar
      this.healthBarContext = context;
      this.healthBarTexture = texture;
      
      // Create a sprite material that uses the canvas texture
      const spriteMaterial = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
      });
      
      // Create a sprite that will always face the camera
      const sprite = new THREE.Sprite(spriteMaterial);
      
      // Position the sprite above the tank
      sprite.position.set(0, 3.0, 0);
      
      // Scale the sprite to an appropriate size
      sprite.scale.set(2.0, 0.5, 1.0);
      
      // Add the sprite to the tank
      this.tank.add(sprite);
      
      // Store the sprite for later reference
      this.healthBarSprite = sprite;
    }
    
    // Update health bar initially
    this.updateHealthBar();
  }
  
  private updateHealthBar(): void {
    if (!this.healthBarContext || !this.healthBarTexture) return;
    
    // Calculate health percentage
    const healthPercent = this.health / this.MAX_HEALTH;
    
    // Clear the canvas
    this.healthBarContext.clearRect(0, 0, 64, 16);
    
    // Draw background (black)
    this.healthBarContext.fillStyle = 'rgba(0,0,0,0.6)';
    this.healthBarContext.fillRect(0, 0, 64, 16);
    
    // Determine color based on health percentage
    if (healthPercent > 0.6) {
      this.healthBarContext.fillStyle = '#00FF00'; // Green
    } else if (healthPercent > 0.3) {
      this.healthBarContext.fillStyle = '#FFFF00'; // Yellow
    } else {
      this.healthBarContext.fillStyle = '#FF0000'; // Red
    }
    
    // Draw health bar with current percentage
    const barWidth = Math.floor(60 * healthPercent);
    this.healthBarContext.fillRect(2, 2, barWidth, 12);
    
    // Update the texture
    this.healthBarTexture.needsUpdate = true;
  }

  private createTank() {
    // Tank body
    const bodyGeometry = new THREE.BoxGeometry(2, 0.75, 3);
    const bodyMaterial = new THREE.MeshStandardMaterial({ 
      color: this.tankColor,
      roughness: 0.7,
      metalness: 0.3
    });
    this.tankBody = new THREE.Mesh(bodyGeometry, bodyMaterial);
    this.tankBody.position.y = 0.75 / 2;
    this.tankBody.castShadow = true;
    this.tankBody.receiveShadow = true;
    this.tank.add(this.tankBody);
    
    // Tracks (left and right)
    const trackGeometry = new THREE.BoxGeometry(0.4, 0.5, 3.2);
    const trackMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x333333, 
      roughness: 0.9,
      metalness: 0.2
    });
    
    const leftTrack = new THREE.Mesh(trackGeometry, trackMaterial);
    leftTrack.position.set(-1, 0.25, 0);
    leftTrack.castShadow = true;
    leftTrack.receiveShadow = true;
    this.tank.add(leftTrack);
    
    const rightTrack = new THREE.Mesh(trackGeometry, trackMaterial);
    rightTrack.position.set(1, 0.25, 0);
    rightTrack.castShadow = true;
    rightTrack.receiveShadow = true;
    this.tank.add(rightTrack);
    
    // Create turret group for Y-axis rotation
    this.turretPivot = new THREE.Group();
    this.turretPivot.position.set(0, 1.0, 0); // Position at top of tank body, slightly higher
    this.tank.add(this.turretPivot);
    
    // Turret base (dome)
    const turretGeometry = new THREE.CylinderGeometry(0.8, 0.8, 0.5, 16);
    const turretMaterial = new THREE.MeshStandardMaterial({ 
      color: this.getTurretColor(),
      roughness: 0.7,
      metalness: 0.3
    });
    this.turret = new THREE.Mesh(turretGeometry, turretMaterial);
    this.turret.castShadow = true;
    this.turret.receiveShadow = true;
    this.turretPivot.add(this.turret);
    
    // Create a group for the barrel - this will handle the elevation
    const barrelGroup = new THREE.Group();
    
    // Position the pivot point at the front edge of the turret (not the center)
    barrelGroup.position.set(0, 0, 0.8); // 0.8 is the radius of the turret
    this.turretPivot.add(barrelGroup);
    
    // Create the barrel using a rotated cylinder
    const barrelGeometry = new THREE.CylinderGeometry(0.2, 0.2, 2, 16);
    const barrelMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x333333, 
      roughness: 0.7,
      metalness: 0.5
    });
    
    this.barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
    
    // Rotate the cylinder to point forward (perpendicular to tank)
    this.barrel.rotation.x = Math.PI / 2;
    
    // Position the barrel so one end is at the pivot point
    this.barrel.position.set(0, 0, 1); // Half the length of the barrel
    
    this.barrel.castShadow = true;
    barrelGroup.add(this.barrel);
    
    // Store reference to the barrelGroup for elevation control
    this.barrelPivot = barrelGroup;
    
    // Set initial barrel elevation to exactly horizontal (0 degrees)
    this.barrelPivot.rotation.x = 0;
    
    // Ensure the barrel is properly oriented for horizontal firing
    this.barrel.rotation.x = Math.PI / 2; // Barrel cylinder points along z-axis
  }

  private getTurretColor(): number {
    // Make turret a darker shade of the tank color
    const color = new THREE.Color(this.tankColor);
    color.multiplyScalar(0.8);
    return color.getHex();
  }

  private setupPatrolPoints() {
    // Create a patrol path with 4-6 points around the tank's starting position
    const pointCount = Math.floor(Math.random() * 3) + 4;
    const radius = Math.random() * 50 + 50; // 50-100 units radius
    
    for (let i = 0; i < pointCount; i++) {
      const angle = (i / pointCount) * Math.PI * 2;
      const x = this.tank.position.x + Math.cos(angle) * radius;
      const z = this.tank.position.z + Math.sin(angle) * radius;
      this.patrolPoints.push(new THREE.Vector3(x, 0, z));
    }
    
    // Set initial target to first patrol point
    this.targetPosition.copy(this.patrolPoints[0]);
  }

  update(keys?: { [key: string]: boolean }, colliders?: ICollidable[]): Shell | null {
    this.movementTimer++;
    
    // If tank is destroyed, don't process movement or firing
    if (this.isDestroyed) {
      return null;
    }
    
    // Store the current position before movement
    this.lastPosition.copy(this.tank.position);
    
    // Handle reloading
    if (!this.canFire) {
      this.reloadCounter++;
      if (this.reloadCounter >= this.RELOAD_TIME) {
        this.canFire = true;
        this.reloadCounter = 0;
      }
    }
    
    // If we're in collision recovery mode, decrement the timer
    if (this.collisionResetTimer > 0) {
      this.collisionResetTimer--;
      
      // If timer expired, pick a new direction
      if (this.collisionResetTimer === 0) {
        this.currentDirection = Math.random() * Math.PI * 2;
      }
      
      // Don't move while in collision recovery
      return null;
    }
    
    // Update movement based on pattern
    switch (this.movementPattern) {
      case 'circle':
        this.moveInCircle();
        break;
      case 'zigzag':
        this.moveInZigzag();
        break;
      case 'random':
        this.moveRandomly();
        break;
      case 'patrol':
        this.moveInPatrol();
        break;
    }
    
    // Look for player tank to target
    let playerTank: ICollidable | null = null;
    if (colliders) {
      for (const collider of colliders) {
        // Skip self and non-tank objects
        if (collider === this || collider.getType() !== 'tank') continue;
        
        // Find the player tank (assumption: only one tank that's not an NPCTank)
        if (!(collider instanceof NPCTank)) {
          playerTank = collider;
          break;
        }
      }
    }
    
    // If we found the player tank and it's within targeting distance
    if (playerTank) {
      const distanceToPlayer = this.tank.position.distanceTo(playerTank.getPosition());
      
      if (distanceToPlayer < this.TARGETING_DISTANCE) {
        // Adjust turret to point toward player
        this.aimAtTarget(playerTank.getPosition());
        
        // Decide whether to fire
        if (this.canFire && Math.random() < this.FIRE_PROBABILITY) {
          return this.fireShell();
        }
      } else {
        // Randomly rotate the turret for visual interest if player not in range
        this.turretPivot.rotation.y += (Math.sin(this.movementTimer * 0.01) * 0.5) * this.turretRotationSpeed;
        
        // Randomly adjust barrel elevation
        const barrelTarget = Math.sin(this.movementTimer * 0.005) * (this.maxBarrelElevation - this.minBarrelElevation) / 2;
        this.barrelPivot.rotation.x += (barrelTarget - this.barrelPivot.rotation.x) * 0.01;
      }
    } else {
      // No player found, just rotate turret randomly
      this.turretPivot.rotation.y += (Math.sin(this.movementTimer * 0.01) * 0.5) * this.turretRotationSpeed;
      
      // Randomly adjust barrel elevation
      const barrelTarget = Math.sin(this.movementTimer * 0.005) * (this.maxBarrelElevation - this.minBarrelElevation) / 2;
      this.barrelPivot.rotation.x += (barrelTarget - this.barrelPivot.rotation.x) * 0.01;
    }
    
    // Update collider position
    this.collider.center.copy(this.tank.position);
    
    // Handle collisions
    if (colliders) {
      for (const collider of colliders) {
        // Skip self-collision
        if (collider === this) continue;
        
        // Check for collision
        if (this.checkCollision(collider)) {
          this.handleCollision();
          break;
        }
      }
    }
    
    return null;
  }
  
  private aimAtTarget(targetPosition: THREE.Vector3): void {
    // Calculate direction to target
    const direction = new THREE.Vector3().subVectors(targetPosition, this.tank.position);
    
    // Calculate turret angle (y-axis rotation)
    let targetTurretAngle = Math.atan2(direction.x, direction.z) - this.tank.rotation.y;
    
    // Normalize angle to between -PI and PI
    while (targetTurretAngle > Math.PI) targetTurretAngle -= Math.PI * 2;
    while (targetTurretAngle < -Math.PI) targetTurretAngle += Math.PI * 2;
    
    // Smooth rotation toward target
    const angleDifference = targetTurretAngle - this.turretPivot.rotation.y;
    
    // Normalize angle difference
    let normalizedDifference = angleDifference;
    while (normalizedDifference > Math.PI) normalizedDifference -= Math.PI * 2;
    while (normalizedDifference < -Math.PI) normalizedDifference += Math.PI * 2;
    
    // Apply rotation with speed limit
    const rotationAmount = Math.sign(normalizedDifference) * 
                          Math.min(Math.abs(normalizedDifference), this.turretRotationSpeed);
    this.turretPivot.rotation.y += rotationAmount;
    
    // Calculate barrel elevation
    // Get horizontal distance to target
    const horizontalDistance = new THREE.Vector2(direction.x, direction.z).length();
    // Target height difference
    const heightDifference = targetPosition.y - this.tank.position.y;
    
    // Calculate rough elevation angle needed
    let targetElevation = -Math.atan2(heightDifference, horizontalDistance);
    
    // Clamp to min/max elevation
    targetElevation = Math.max(this.minBarrelElevation, 
                             Math.min(this.maxBarrelElevation, targetElevation));
    
    // Smooth barrel movement
    const elevationDifference = targetElevation - this.barrelPivot.rotation.x;
    const elevationAmount = Math.sign(elevationDifference) * 
                           Math.min(Math.abs(elevationDifference), this.barrelElevationSpeed);
    this.barrelPivot.rotation.x += elevationAmount;
  }
  
  private fireShell(): Shell {
    // Set reload timer
    this.canFire = false;
    this.reloadCounter = 0;
    
    // Calculate barrel end position
    const barrelEndPosition = new THREE.Vector3(0, 0, this.BARREL_END_OFFSET);
    
    // Apply barrel pivot rotation
    barrelEndPosition.applyEuler(new THREE.Euler(
      this.barrelPivot.rotation.x,
      0,
      0
    ));
    
    // Apply turret rotation
    barrelEndPosition.applyEuler(new THREE.Euler(
      0,
      this.turretPivot.rotation.y,
      0
    ));
    
    // Apply tank rotation and position
    barrelEndPosition.applyEuler(new THREE.Euler(
      0,
      this.tank.rotation.y,
      0
    ));
    barrelEndPosition.add(this.turretPivot.position.clone().add(this.tank.position));
    
    // Calculate firing direction
    const direction = new THREE.Vector3();
    
    // Start with forward vector
    direction.set(0, 0, 1);
    
    // Apply barrel elevation
    direction.applyEuler(new THREE.Euler(
      this.barrelPivot.rotation.x,
      0,
      0
    ));
    
    // Apply turret rotation
    direction.applyEuler(new THREE.Euler(
      0,
      this.turretPivot.rotation.y,
      0
    ));
    
    // Apply tank rotation
    direction.applyEuler(new THREE.Euler(
      0,
      this.tank.rotation.y,
      0
    ));
    
    // Create and return new shell
    return new Shell(
      this.scene,
      barrelEndPosition,
      direction,
      this.SHELL_SPEED,
      this
    );
  }
  
  // Implement ICollidable interface
  getCollider(): THREE.Sphere {
    return this.collider;
  }
  
  getPosition(): THREE.Vector3 {
    return this.tank.position.clone();
  }
  
  getType(): string {
    return 'tank';
  }
  
  onCollision(other: ICollidable): void {
    this.handleCollision();
  }
  
  private handleCollision(): void {
    // Move back to last position
    this.tank.position.copy(this.lastPosition);
    this.collider.center.copy(this.lastPosition);
    
    // Start collision recovery timer
    this.collisionResetTimer = this.COLLISION_RESET_DELAY;
    
    // Pick a new random direction (approximately opposite to current direction)
    this.currentDirection = this.currentDirection + Math.PI + (Math.random() - 0.5);
  }
  
  private checkCollision(other: ICollidable): boolean {
    const otherCollider = other.getCollider();
    
    if (otherCollider instanceof THREE.Sphere) {
      // Sphere-Sphere collision
      const distance = this.tank.position.distanceTo(other.getPosition());
      return distance < (this.collider.radius + otherCollider.radius);
    } else if (otherCollider instanceof THREE.Box3) {
      // Sphere-Box collision
      return otherCollider.intersectsSphere(this.collider);
    }
    
    return false;
  }

  private moveInCircle() {
    // Move in a circular pattern
    this.currentDirection += 0.005;
    
    // Apply movement
    this.tank.position.x += Math.cos(this.currentDirection) * this.tankSpeed;
    this.tank.position.z += Math.sin(this.currentDirection) * this.tankSpeed;
    
    // Rotate tank to face movement direction
    this.tank.rotation.y = this.currentDirection + Math.PI / 2;
  }

  private moveInZigzag() {
    // Change direction at intervals
    if (this.movementTimer % this.changeDirectionInterval === 0) {
      this.currentDirection = Math.random() * Math.PI * 2;
    }
    
    // Apply zigzag by adding sine wave to movement
    const zigzagFactor = Math.sin(this.movementTimer * 0.1) * 0.5;
    
    // Calculate forward and side direction vectors
    const forwardX = Math.cos(this.currentDirection);
    const forwardZ = Math.sin(this.currentDirection);
    const sideX = Math.cos(this.currentDirection + Math.PI / 2);
    const sideZ = Math.sin(this.currentDirection + Math.PI / 2);
    
    // Apply movement with zigzag
    this.tank.position.x += (forwardX + sideX * zigzagFactor) * this.tankSpeed;
    this.tank.position.z += (forwardZ + sideZ * zigzagFactor) * this.tankSpeed;
    
    // Rotate tank to face movement direction
    const targetRotation = Math.atan2(forwardZ + sideZ * zigzagFactor, forwardX + sideX * zigzagFactor) + Math.PI / 2;
    this.tank.rotation.y += (targetRotation - this.tank.rotation.y) * 0.1;
  }

  private moveRandomly() {
    // Change direction at random intervals
    if (this.movementTimer % this.changeDirectionInterval === 0) {
      this.currentDirection = Math.random() * Math.PI * 2;
    }
    
    // Apply movement
    this.tank.position.x += Math.cos(this.currentDirection) * this.tankSpeed;
    this.tank.position.z += Math.sin(this.currentDirection) * this.tankSpeed;
    
    // Rotate tank to face movement direction
    const targetRotation = this.currentDirection + Math.PI / 2;
    this.tank.rotation.y += (targetRotation - this.tank.rotation.y) * 0.1;
  }

  private moveInPatrol() {
    if (this.patrolPoints.length === 0) return;
    
    // Move toward current patrol point
    const targetPoint = this.patrolPoints[this.currentPatrolIndex];
    const direction = new THREE.Vector2(
      targetPoint.x - this.tank.position.x,
      targetPoint.z - this.tank.position.z
    );
    
    // Check if we've reached the target (within 5 units)
    if (direction.length() < 5) {
      // Move to next patrol point
      this.currentPatrolIndex = (this.currentPatrolIndex + 1) % this.patrolPoints.length;
      return;
    }
    
    // Normalize direction
    direction.normalize();
    
    // Apply movement
    this.tank.position.x += direction.x * this.tankSpeed;
    this.tank.position.z += direction.y * this.tankSpeed;
    
    // Rotate tank to face movement direction
    const targetRotation = Math.atan2(direction.y, direction.x) + Math.PI / 2;
    this.tank.rotation.y += (targetRotation - this.tank.rotation.y) * 0.1;
  }

  dispose() {
    // Clean up resources
    this.scene.remove(this.tank);
    
    // Health bar is already attached to tank, so no need to remove it separately
    
    // Clean up any destroyed effects
    for (const effect of this.destroyedEffects) {
      this.scene.remove(effect);
    }
    this.destroyedEffects = [];
  }
  
  // Health methods
  takeDamage(amount: number): boolean {
    if (this.isDestroyed) return true;
    
    // Apply damage with safety check
    this.health = Math.max(0, this.health - amount);
    
    console.log(`NPC Tank taking damage: ${amount}, remaining health: ${this.health}`);
    
    if (this.health <= 0) {
      this.health = 0;
      this.isDestroyed = true;
      this.createDestroyedEffect();
      return true;
    }
    
    // Update health bar
    this.updateHealthBar();
    
    return false;
  }
  
  getHealth(): number {
    return this.health;
  }
  
  respawn(position?: THREE.Vector3): void {
    // Reset health
    this.health = this.MAX_HEALTH;
    this.isDestroyed = false;
    
    // Reset position if provided, otherwise use random position
    if (position) {
      this.tank.position.copy(position);
    } else {
      // Generate a random position within a wider radius
      const angle = Math.random() * Math.PI * 2;
      const distance = 200 + Math.random() * 600;
      this.tank.position.set(
        Math.cos(angle) * distance,
        0,
        Math.sin(angle) * distance
      );
    }
    
    // Make tank visible again
    this.tank.visible = true;
    
    // Reset collider
    this.collider.center.copy(this.tank.position);
    this.lastPosition.copy(this.tank.position);
    
    // Update health bar
    this.updateHealthBar();
    
    // Remove destroyed effects
    for (const effect of this.destroyedEffects) {
      this.scene.remove(effect);
    }
    this.destroyedEffects = [];
  }
  
  private createDestroyedEffect(): void {
    // Hide the tank
    this.tank.visible = false;
    
    // Hide the health bar sprite
    if (this.healthBarSprite) {
      this.healthBarSprite.visible = false;
    }
    
    // Create black smoke particle system
    const particleCount = 40;
    const smokeGeometry = new THREE.BufferGeometry();
    const smokePositions = new Float32Array(particleCount * 3);
    const smokeColors = new Float32Array(particleCount * 3);
    
    // Create random positions within a sphere
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      const radius = 1.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      
      smokePositions[i3] = this.tank.position.x + radius * Math.sin(phi) * Math.cos(theta);
      smokePositions[i3 + 1] = this.tank.position.y + radius * Math.cos(phi) + 1; // Slightly above ground
      smokePositions[i3 + 2] = this.tank.position.z + radius * Math.sin(phi) * Math.sin(theta);
      
      // Dark smoke color (dark gray to black)
      const darkness = 0.1 + Math.random() * 0.2;
      smokeColors[i3] = darkness;
      smokeColors[i3 + 1] = darkness;
      smokeColors[i3 + 2] = darkness;
    }
    
    smokeGeometry.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
    smokeGeometry.setAttribute('color', new THREE.BufferAttribute(smokeColors, 3));
    
    const smokeMaterial = new THREE.PointsMaterial({
      size: 0.7,
      vertexColors: true,
      transparent: true,
      opacity: 0.8
    });
    
    const smokeParticles = new THREE.Points(smokeGeometry, smokeMaterial);
    this.scene.add(smokeParticles);
    this.destroyedEffects.push(smokeParticles);
    
    // Create fire effect (orange-red particles)
    const fireCount = 25;
    const fireGeometry = new THREE.BufferGeometry();
    const firePositions = new Float32Array(fireCount * 3);
    const fireColors = new Float32Array(fireCount * 3);
    
    // Create random positions for fire (concentrated lower)
    for (let i = 0; i < fireCount; i++) {
      const i3 = i * 3;
      const radius = 1.0;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI / 2; // Concentrate in lower hemisphere
      
      firePositions[i3] = this.tank.position.x + radius * Math.sin(phi) * Math.cos(theta);
      firePositions[i3 + 1] = this.tank.position.y + 0.5; // Lower than smoke
      firePositions[i3 + 2] = this.tank.position.z + radius * Math.sin(phi) * Math.sin(theta);
      
      // Fire colors (orange to red)
      fireColors[i3] = 0.9 + Math.random() * 0.1; // Red
      fireColors[i3 + 1] = 0.3 + Math.random() * 0.3; // Green
      fireColors[i3 + 2] = 0; // No blue
    }
    
    fireGeometry.setAttribute('position', new THREE.BufferAttribute(firePositions, 3));
    fireGeometry.setAttribute('color', new THREE.BufferAttribute(fireColors, 3));
    
    const fireMaterial = new THREE.PointsMaterial({
      size: 0.5,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    
    const fireParticles = new THREE.Points(fireGeometry, fireMaterial);
    this.scene.add(fireParticles);
    this.destroyedEffects.push(fireParticles);
  }
}