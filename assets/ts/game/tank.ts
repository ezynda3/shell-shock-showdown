import * as THREE from 'three';
import { Shell } from './shell';

// Audio helper for tank sounds with spatial awareness
export class SpatialAudio {
  private audio: HTMLAudioElement;
  private isPlaying: boolean = false;
  private sourcePosition: THREE.Vector3;
  private maxDistance: number = 100;
  private baseVolume: number = 1.0;
  private playbackRate: number = 1.0;
  private duration: number | null = null;  // Original duration 
  private trimEnd: number = 0;             // Seconds to trim from end
  
  // Shared listener position for all spatial audio
  private static globalListener: THREE.Vector3 | null = null;
  
  // Doppler effect constants
  private readonly DOPPLER_FACTOR: number = 0.05;
  private lastPosition: THREE.Vector3;
  private velocity: THREE.Vector3 = new THREE.Vector3();

  constructor(src: string, loop: boolean = false, volume: number = 1.0, maxDistance: number = 100, trimEndSeconds: number = 0) {
    this.audio = new Audio(src);
    this.audio.loop = loop;
    this.baseVolume = Math.max(0, Math.min(1, volume));
    this.audio.volume = this.baseVolume;
    this.maxDistance = maxDistance;
    this.sourcePosition = new THREE.Vector3();
    this.lastPosition = new THREE.Vector3();
    this.trimEnd = trimEndSeconds;
    
    // For looping sounds with trimming
    if (loop && trimEndSeconds > 0) {
      // We need to handle the manual looping
      this.audio.addEventListener('loadedmetadata', () => {
        this.duration = this.audio.duration;
        
        // Add timeupdate listener to handle manual looping with trimmed end
        if (this.duration && this.trimEnd > 0) {
          // This is the simpler looping approach: just reset to beginning
          // when we reach the loop point
          this.audio.addEventListener('timeupdate', () => {
            if (this.isPlaying && this.duration && this.trimEnd > 0) {
              const loopPoint = this.duration - this.trimEnd;
              
              // If we've reached the loop point, jump back to start
              if (this.audio.currentTime >= loopPoint) {
                // Add a small offset to avoid exact boundary 
                // which could cause looping issues
                this.audio.currentTime = 0.01;
              }
            }
          });
        }
      });
    }
  }

  setSourcePosition(position: THREE.Vector3) {
    // Calculate velocity for Doppler effect
    if (this.isPlaying && SpatialAudio.globalListener) {
      this.velocity.subVectors(position, this.lastPosition);
    }
    
    // Store last position before updating current
    this.lastPosition.copy(this.sourcePosition);
    
    // Update current position
    this.sourcePosition.copy(position);
    
    // Update volume and apply Doppler effect
    this.updateVolumeAndDoppler();
  }

  setListenerPosition(position: THREE.Vector3 | null) {
    SpatialAudio.globalListener = position ? position.clone() : null;
    this.updateVolumeAndDoppler();
  }
  
  // Set the global listener position for all spatial audio objects
  static setGlobalListener(position: THREE.Vector3 | null) {
    SpatialAudio.globalListener = position ? position.clone() : null;
  }

  play() {
    if (!this.isPlaying) {
      // For non-looping sounds, create a new Audio element each time
      if (!this.audio.loop) {
        this.audio = new Audio(this.audio.src);
        this.audio.volume = this.baseVolume;
        this.audio.playbackRate = this.playbackRate;
      }
      
      // Play the audio element
      this.audio.play().catch(e => console.warn('Audio play failed:', e));
      this.isPlaying = true;
    }
  }

  stop() {
    if (this.isPlaying) {
      // Stop the audio
      this.audio.pause();
      
      // Reset time position
      this.audio.currentTime = 0;
      
      this.isPlaying = false;
    }
  }

  updateVolumeAndDoppler() {
    if (!SpatialAudio.globalListener) {
      this.audio.volume = this.baseVolume;
      return;
    }

    // Calculate distance-based volume reduction
    const distance = this.sourcePosition.distanceTo(SpatialAudio.globalListener);
    const volumeFactor = Math.max(0, 1 - (distance / this.maxDistance));
    
    // Apply distance-based inverse square law attenuation (more realistic)
    this.audio.volume = this.baseVolume * volumeFactor * volumeFactor;
    
    // Apply Doppler effect if object is moving
    if (this.isPlaying && this.velocity.length() > 0.01) {
      // Calculate direction from listener to source
      const direction = new THREE.Vector3().subVectors(
        this.sourcePosition, 
        SpatialAudio.globalListener
      ).normalize();
      
      // Project velocity onto direction vector (positive = moving away, negative = moving toward)
      const relativeSpeed = this.velocity.dot(direction);
      
      // Apply Doppler shift
      const dopplerShift = 1.0 - (relativeSpeed * this.DOPPLER_FACTOR);
      
      // Apply shift to playback rate (within reasonable limits)
      const newRate = this.playbackRate * Math.max(0.8, Math.min(1.2, dopplerShift));
      
      // Only update if the change is significant
      if (Math.abs(this.audio.playbackRate - newRate) > 0.01) {
        this.audio.playbackRate = newRate;
      }
    }
  }

  isActive(): boolean {
    return this.isPlaying;
  }

  setVolume(volume: number) {
    this.baseVolume = Math.max(0, Math.min(1, volume));
    this.updateVolumeAndDoppler();
  }
  
  setPlaybackRate(rate: number) {
    this.playbackRate = Math.max(0.5, Math.min(2.0, rate));
    
    // Apply to audio
    if (this.audio && this.isPlaying) {
      this.audio.playbackRate = this.playbackRate;
    }
  }

  // For one-shot sounds, clone the audio to allow multiple overlapping sounds
  cloneAndPlay(): SpatialAudio {
    const clone = new SpatialAudio(this.audio.src, false, this.baseVolume, this.maxDistance, this.trimEnd);
    clone.setSourcePosition(this.sourcePosition);
    clone.setPlaybackRate(this.playbackRate);
    clone.play();
    return clone;
  }
  
  // Apply filter based on environment (for future expansion)
  applyEnvironmentalFilter(environmentType: 'indoor' | 'outdoor' | 'underwater' = 'outdoor') {
    if (typeof window.AudioContext === 'undefined' || !this.audio) {
      return; // Audio filter API not supported
    }
    
    // This would be implemented with Web Audio API filters
    // Left as a placeholder for future implementation
  }
}

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
  isMoving(): boolean; // Returns whether the tank is currently moving
  getVelocity?(): number; // Returns the current velocity of the tank
}

export class Tank implements ITank {
  // Tank components
  tank: THREE.Group;
  tankBody?: THREE.Mesh;
  turret?: THREE.Mesh;
  turretPivot: THREE.Group;
  barrel?: THREE.Mesh;
  barrelPivot: THREE.Group;
  
  // Audio components
  protected moveSound: SpatialAudio;
  protected fireSound: SpatialAudio;
  protected explodeSound: SpatialAudio;
  protected lastMoveSoundState: boolean = false;
  
  // Tank properties
  private tankSpeed = 2.5; // Increased 5x from original 0.15 for extreme speed
  private tankRotationSpeed = 0.04; // Reduced by 50% from 0.08 for more controlled turning
  private turretRotationSpeed = 0.1; // Increased from 0.04 for faster aiming
  private barrelElevationSpeed = 0.08; // Increased from 0.03 for quicker elevation changes
  private maxBarrelElevation = 0;           // Barrel can't go lower than starting position
  private minBarrelElevation = -Math.PI / 4; // Barrel pointing up limit
  private tankName: string;                  // Name to display above tank
  private tankColor: number = 0x4a7c59;      // Default tank color
  
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
  private readonly RELOAD_TIME = 30; // Half-second cooldown at 60fps - 2x faster firing
  private reloadCounter = 0;
  private lastFireTime: number = 0;
  private readonly FIRE_COOLDOWN_MS: number = 500; // Half-second cooldown in milliseconds
  private readonly SHELL_SPEED = 10.0; // Massively increased from 1.5 for extreme range
  private readonly BARREL_END_OFFSET = 1.5; // Distance from turret pivot to end of barrel
  
  // Health properties
  private health: number = 100; // Full health
  private readonly MAX_HEALTH: number = 100;
  private isDestroyed: boolean = false;
  private destroyedEffects: THREE.Object3D[] = [];
  
  // Movement tracking
  private isCurrentlyMoving: boolean = false;
  private velocity: number = 0;
  
  // Health bar display
  private healthBarSprite: THREE.Sprite;
  private healthBarContext: CanvasRenderingContext2D | null = null;
  private healthBarTexture: THREE.CanvasTexture | null = null;
  
  private scene: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;

  constructor(scene: THREE.Scene, camera?: THREE.PerspectiveCamera, name: string = "Player") {
    this.scene = scene;
    this.camera = camera;
    
    // Set player name
    this.tankName = name;
    
    // Initialize tank group
    this.tank = new THREE.Group();
    this.turretPivot = new THREE.Group();
    this.barrelPivot = new THREE.Group();
    
    // Create tank model
    this.createTank();
    
    // Initialize collision sphere
    this.collider = new THREE.Sphere(this.tank.position.clone(), this.collisionRadius);
    this.lastPosition = this.tank.position.clone();
    
    // No health bar for player tank - it's shown in the UI
    
    // Initialize sound effects
    // Trim 4 seconds from the end of the tank movement sound for smooth looping
    this.moveSound = new SpatialAudio('/static/js/assets/sounds/tank-move.mp3', true, 0.4, 120, 4.0);
    this.fireSound = new SpatialAudio('/static/js/assets/sounds/tank-fire.mp3', false, 0.7, 150);
    this.explodeSound = new SpatialAudio('/static/js/assets/sounds/tank-explode.mp3', false, 0.8, 200);
    
    // Add to scene
    scene.add(this.tank);
  }

  private createTank() {
    // Tank body - more detailed with beveled edges
    const bodyGeometry = new THREE.BoxGeometry(2, 0.75, 3, 1, 1, 2);
    const bodyMaterial = new THREE.MeshStandardMaterial({ 
      color: this.tankColor || 0x4a7c59,  // Dark green (or custom color)
      roughness: 0.3,  // Reduced roughness for more polished look
      metalness: 0.8,  // Increased metalness for more metallic appearance
      envMapIntensity: 1.2  // Enhance environmental reflections
    });
    this.tankBody = new THREE.Mesh(bodyGeometry, bodyMaterial);
    this.tankBody.position.y = 0.75 / 2;
    this.tankBody.castShadow = true;
    this.tankBody.receiveShadow = true;
    this.tank.add(this.tankBody);
    
    // Add armor plating details to the tank body
    this.addArmorPlates();
    
    // Tracks (left and right) - more detailed with tread segments
    this.createDetailedTracks();
    
    // Create turret group for Y-axis rotation
    this.turretPivot = new THREE.Group();
    this.turretPivot.position.set(0, 1.0, 0); // Position at top of tank body, slightly higher
    this.tank.add(this.turretPivot);
    
    // Turret base - more detailed with hatches and details
    this.createDetailedTurret();
    
    // Create a group for the barrel - this will handle the elevation
    const barrelGroup = new THREE.Group();
    
    // Position the pivot point at the front edge of the turret (not the center)
    barrelGroup.position.set(0, 0, 0.8); // 0.8 is the radius of the turret
    this.turretPivot.add(barrelGroup);
    
    // Create a more detailed barrel with muzzle brake
    this.createDetailedBarrel(barrelGroup);
    
    // Store reference to the barrelGroup for elevation control
    this.barrelPivot = barrelGroup;
    
    // Set initial barrel elevation to exactly horizontal (0 degrees)
    this.barrelPivot.rotation.x = 0;
  }
  
  private addArmorPlates(): void {
    // Front glacis plate
    const frontPlateGeometry = new THREE.BoxGeometry(1.9, 0.4, 0.2);
    const armorMaterial = new THREE.MeshStandardMaterial({
      color: this.tankColor || 0x4a7c59,
      roughness: 0.25, // Smoother for modern armor plating
      metalness: 0.85, // Very metallic for armored plates
      envMapIntensity: 1.3 // Enhanced reflections for armor plates
    });
    
    const frontPlate = new THREE.Mesh(frontPlateGeometry, armorMaterial);
    frontPlate.position.set(0, 0.5, -1.4);
    frontPlate.rotation.x = Math.PI / 8; // Angled slightly
    frontPlate.castShadow = true;
    this.tank.add(frontPlate);
    
    // Side skirt armor (left)
    const sideSkirtGeometry = new THREE.BoxGeometry(0.1, 0.3, 2.8);
    const leftSkirt = new THREE.Mesh(sideSkirtGeometry, armorMaterial);
    leftSkirt.position.set(-1.05, 0.4, 0);
    leftSkirt.castShadow = true;
    this.tank.add(leftSkirt);
    
    // Side skirt armor (right)
    const rightSkirt = new THREE.Mesh(sideSkirtGeometry, armorMaterial);
    rightSkirt.position.set(1.05, 0.4, 0);
    rightSkirt.castShadow = true;
    this.tank.add(rightSkirt);
  }
  
  private createDetailedTracks(): void {
    // Track base
    const trackBaseGeometry = new THREE.BoxGeometry(0.4, 0.5, 3.2);
    const trackMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x1a1a1a, // Darker color for better depth
      roughness: 0.6, // Slightly rough texture but still metallic
      metalness: 0.7, // More metallic for modern tank tracks
      envMapIntensity: 0.8 // Some reflections but not too shiny
    });
    
    // Left track base
    const leftTrack = new THREE.Mesh(trackBaseGeometry, trackMaterial);
    leftTrack.position.set(-1, 0.25, 0);
    leftTrack.castShadow = true;
    leftTrack.receiveShadow = true;
    this.tank.add(leftTrack);
    
    // Right track base
    const rightTrack = new THREE.Mesh(trackBaseGeometry, trackMaterial);
    rightTrack.position.set(1, 0.25, 0);
    rightTrack.castShadow = true;
    rightTrack.receiveShadow = true;
    this.tank.add(rightTrack);
    
    // Track treads - add segments for visual detail
    const treadsPerSide = this.TRACK_SEGMENT_COUNT; // Number of visible tread segments
    const treadSegmentGeometry = new THREE.BoxGeometry(0.5, 0.1, 0.32); // Slightly larger treads
    const treadMaterial = new THREE.MeshStandardMaterial({
      color: 0x111111, // Darker for better contrast
      roughness: 0.6, // More polished than before but still textured
      metalness: 0.65, // More metallic for modern tank tracks
      envMapIntensity: 0.7 // Some reflections but not too shiny
    });
    
    // Create tread segments for both tracks and store references for animation
    for (let i = 0; i < treadsPerSide; i++) {
      const leftTread = new THREE.Mesh(treadSegmentGeometry, treadMaterial);
      leftTread.position.set(-1, 0.05, -1.4 + i * (3 / treadsPerSide));
      leftTread.castShadow = true;
      this.tank.add(leftTread);
      this.trackSegments.push(leftTread);
      
      const rightTread = new THREE.Mesh(treadSegmentGeometry, treadMaterial);
      rightTread.position.set(1, 0.05, -1.4 + i * (3 / treadsPerSide));
      rightTread.castShadow = true;
      this.tank.add(rightTread);
      this.trackSegments.push(rightTread);
    }
    
    // Add drive wheels at the front and back
    const wheelGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 18); // More segments for smoother wheels
    const wheelMaterial = new THREE.MeshStandardMaterial({
      color: 0x222222, // Darker for contrast and depth
      roughness: 0.4, // Smoother for modern tank wheels
      metalness: 0.8, // More metallic for realistic wheels
      envMapIntensity: 1.2 // Better reflections for wheels
    });
    
    // Front wheels
    const leftFrontWheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    leftFrontWheel.rotation.z = Math.PI / 2;
    leftFrontWheel.position.set(-1, 0.3, -1.4);
    this.tank.add(leftFrontWheel);
    this.wheels.push(leftFrontWheel);
    
    const rightFrontWheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    rightFrontWheel.rotation.z = Math.PI / 2;
    rightFrontWheel.position.set(1, 0.3, -1.4);
    this.tank.add(rightFrontWheel);
    this.wheels.push(rightFrontWheel);
    
    // Rear wheels
    const leftRearWheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    leftRearWheel.rotation.z = Math.PI / 2;
    leftRearWheel.position.set(-1, 0.3, 1.4);
    this.tank.add(leftRearWheel);
    this.wheels.push(leftRearWheel);
    
    const rightRearWheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    rightRearWheel.rotation.z = Math.PI / 2;
    rightRearWheel.position.set(1, 0.3, 1.4);
    this.tank.add(rightRearWheel);
    this.wheels.push(rightRearWheel);
    
    // Add road wheels in between
    const smallWheelGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.08, 8);
    const roadWheelPositions = [-0.8, -0.2, 0.4, 1.0]; // Z positions along track
    
    for (const zPos of roadWheelPositions) {
      const leftRoadWheel = new THREE.Mesh(smallWheelGeometry, wheelMaterial);
      leftRoadWheel.rotation.z = Math.PI / 2;
      leftRoadWheel.position.set(-1, 0.25, zPos);
      this.tank.add(leftRoadWheel);
      this.wheels.push(leftRoadWheel);
      
      const rightRoadWheel = new THREE.Mesh(smallWheelGeometry, wheelMaterial);
      rightRoadWheel.rotation.z = Math.PI / 2;
      rightRoadWheel.position.set(1, 0.25, zPos);
      this.tank.add(rightRoadWheel);
      this.wheels.push(rightRoadWheel);
    }
  }
  
  // Animate track segments and wheels based on movement
  private animateTracks(): void {
    // Calculate rotation speed based on velocity
    this.trackRotationSpeed = this.velocity * 0.5;
    
    // Move track segments
    const segmentSpacing = 3 / this.TRACK_SEGMENT_COUNT;
    let leftSegments = this.trackSegments.filter((_, i) => i % 2 === 0);
    let rightSegments = this.trackSegments.filter((_, i) => i % 2 === 1);
    
    // Update left track segments
    leftSegments.forEach(segment => {
      // Move segment backward/forward
      segment.position.z += this.trackRotationSpeed;
      
      // If segment moves beyond the track length, wrap it around to the front
      if (this.trackRotationSpeed > 0 && segment.position.z > 1.6) {
        segment.position.z = -1.6 + (segment.position.z - 1.6);
      } 
      // If segment moves beyond the front, wrap it around to the back
      else if (this.trackRotationSpeed < 0 && segment.position.z < -1.6) {
        segment.position.z = 1.6 + (segment.position.z + 1.6);
      }
    });
    
    // Update right track segments (same logic as left)
    rightSegments.forEach(segment => {
      segment.position.z += this.trackRotationSpeed;
      if (this.trackRotationSpeed > 0 && segment.position.z > 1.6) {
        segment.position.z = -1.6 + (segment.position.z - 1.6);
      } else if (this.trackRotationSpeed < 0 && segment.position.z < -1.6) {
        segment.position.z = 1.6 + (segment.position.z + 1.6);
      }
    });
    
    // Rotate wheels based on velocity
    this.wheels.forEach(wheel => {
      wheel.rotation.y += this.trackRotationSpeed * 2; // Wheels turn faster than track movement
    });
  }
  
  private createDetailedTurret(): void {
    // Main turret body - slightly more complex shape
    const turretGeometry = new THREE.CylinderGeometry(0.8, 0.8, 0.5, 24); // Increased segments for smoother appearance
    const turretMaterial = new THREE.MeshStandardMaterial({ 
      color: this.tankColor ? new THREE.Color(this.tankColor).multiplyScalar(0.85).getHex() : 0x3f5e49,
      roughness: 0.2, // Highly polished surface
      metalness: 0.9, // Very metallic appearance
      envMapIntensity: 1.4 // Enhanced reflections for turret
    });
    
    this.turret = new THREE.Mesh(turretGeometry, turretMaterial);
    this.turret.castShadow = true;
    this.turret.receiveShadow = true;
    this.turretPivot.add(this.turret);
    
    // Add turret details - commander's hatch
    const hatchGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 8);
    const hatchMaterial = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.8,
      metalness: 0.4
    });
    
    const hatch = new THREE.Mesh(hatchGeometry, hatchMaterial);
    hatch.position.set(0, 0.3, 0);
    hatch.castShadow = true;
    this.turretPivot.add(hatch);
    
    // Add antenna
    const antennaGeometry = new THREE.CylinderGeometry(0.02, 0.01, 1.0, 4);
    const antennaMaterial = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.5,
      metalness: 0.8
    });
    
    const antenna = new THREE.Mesh(antennaGeometry, antennaMaterial);
    antenna.position.set(-0.5, 0.6, -0.2);
    antenna.castShadow = true;
    this.turretPivot.add(antenna);
    
    // Add mantlet at barrel base
    const mantletGeometry = new THREE.BoxGeometry(0.8, 0.6, 0.35); // Slightly larger for more presence
    const mantletMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a, // Darker color for better contrast
      roughness: 0.2, // Smoother for modern tank mantlet
      metalness: 0.9, // Highly metallic for professional look
      envMapIntensity: 1.5 // Strong reflections for mantlet
    });
    
    const mantlet = new THREE.Mesh(mantletGeometry, mantletMaterial);
    mantlet.position.set(0, 0, 0.8);
    mantlet.castShadow = true;
    this.turretPivot.add(mantlet);
  }
  
  private createDetailedBarrel(barrelGroup: THREE.Group): void {
    // Main barrel (thicker at base, thinner at muzzle)
    const barrelGeometry = new THREE.CylinderGeometry(0.2, 0.15, 2.2, 16); // More segments for smoother barrel
    const barrelMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x222222, // Darker color for better contrast
      roughness: 0.1, // Very smooth for gun barrel
      metalness: 0.95, // Highly metallic for realistic gun barrel
      envMapIntensity: 1.6 // Strong reflections
    });
    
    this.barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
    
    // Rotate the cylinder to point forward
    this.barrel.rotation.x = Math.PI / 2;
    
    // Position the barrel so one end is at the pivot point
    this.barrel.position.set(0, 0, 1.1); // Half the length of the barrel
    
    this.barrel.castShadow = true;
    barrelGroup.add(this.barrel);
    
    // Add muzzle brake
    const muzzleBrakeGeometry = new THREE.CylinderGeometry(0.25, 0.25, 0.35, 16); // Larger, smoother muzzle brake
    const muzzleBrakeMaterial = new THREE.MeshStandardMaterial({
      color: 0x111111, // Darker for contrast
      roughness: 0.15, // Very smooth
      metalness: 0.98, // Almost fully metallic
      envMapIntensity: 1.8 // Strong reflections for muzzle
    });
    
    const muzzleBrake = new THREE.Mesh(muzzleBrakeGeometry, muzzleBrakeMaterial);
    muzzleBrake.rotation.x = Math.PI / 2;
    muzzleBrake.position.set(0, 0, 2.2);
    barrelGroup.add(muzzleBrake);
  }


  // Track movement physics properties
  private acceleration: number = 0;
  private maxAcceleration: number = 0.15; // Increased 5x from original 0.01 for lightning acceleration
  private maxDeceleration: number = 0.2; // Increased 5x from original 0.02 for superior handling
  private engineRPM: number = 0;
  private trackRotationSpeed: number = 0;
  private readonly MAX_ENGINE_RPM: number = 1.5;
  private readonly TRACK_SEGMENT_COUNT: number = 8; // Must match the value in createDetailedTracks
  private trackSegments: THREE.Mesh[] = [];
  private wheels: THREE.Mesh[] = [];
  
  // Method to handle physics-based movement
  private updateMovementWithPhysics(keys: {[key: string]: boolean}) {
    // Reset velocity variables
    this.velocity = 0;
    
    // Determine target acceleration based on inputs
    const targetAcceleration = 
      keys['w'] || keys['W'] ? this.maxAcceleration : 
      keys['s'] || keys['S'] ? -this.maxAcceleration : 0;
    
    // Gradually change acceleration (smoother feel)
    this.acceleration = this.acceleration * 0.9 + targetAcceleration * 0.1;
    
    // Apply velocity changes based on acceleration
    this.velocity += this.acceleration;
    
    // Apply friction/drag when no input
    if (!keys['w'] && !keys['W'] && !keys['s'] && !keys['S']) {
      this.velocity *= 0.92; // Quicker slowdown for better control at high speeds
    }
    
    // Clamp velocity to max speed
    const maxSpeed = 3.0; // Increased 5x from original 0.2 for extreme max speed
    this.velocity = Math.max(-maxSpeed, Math.min(maxSpeed, this.velocity));
    
    // Update position based on velocity and tank rotation
    if (Math.abs(this.velocity) > 0.001) {
      this.tank.position.x += Math.sin(this.tank.rotation.y) * this.velocity;
      this.tank.position.z += Math.cos(this.tank.rotation.y) * this.velocity;
      this.isCurrentlyMoving = true;
      
      // Update engine sound pitch based on velocity
      this.engineRPM = Math.min(this.MAX_ENGINE_RPM, 0.8 + Math.abs(this.velocity) * 5);
    } else {
      this.isCurrentlyMoving = false;
      this.velocity = 0;
      this.engineRPM = 0;
    }
    
    // Tank rotation with inertia
    if (keys['a'] || keys['A']) {
      this.tank.rotation.y += this.tankRotationSpeed * (1.0 - Math.abs(this.velocity) * 0.5); // Slower rotation at high speed
      this.isCurrentlyMoving = true;
    }
    
    if (keys['d'] || keys['D']) {
      this.tank.rotation.y -= this.tankRotationSpeed * (1.0 - Math.abs(this.velocity) * 0.5); // Slower rotation at high speed
      this.isCurrentlyMoving = true;
    }
  }
  
  update(keys: { [key: string]: boolean }, colliders?: ICollidable[]): Shell | null {
    // If tank is destroyed, don't process movement or firing
    if (this.isDestroyed) {
      return null;
    }
    
    // Store the current position before movement
    this.lastPosition.copy(this.tank.position);
    
    // Update sound source positions
    this.updateSoundPositions();
    
    // Handle reloading using timestamps instead of frame counting
    if (!this.canFire) {
      const currentTime = Date.now();
      if (currentTime - this.lastFireTime >= this.FIRE_COOLDOWN_MS) {
        this.canFire = true;
      }
    }
    
    // Reset movement flag - will be set to true if any movement occurs
    this.isCurrentlyMoving = false;
    
    // Apply physics-based movement with acceleration and inertia
    this.updateMovementWithPhysics(keys);
    
    // Animate tracks if moving
    if (Math.abs(this.velocity) > 0.01) {
      this.animateTracks();
    }
    
    // Update movement sound based on movement status and engine RPM
    if (this.isCurrentlyMoving) {
      if (!this.lastMoveSoundState) {
        this.moveSound.play();
        this.lastMoveSoundState = true;
      }
      // Update engine sound pitch based on RPM
      this.moveSound.setPlaybackRate(0.8 + this.engineRPM * 0.7);
    } else if (this.lastMoveSoundState) {
      this.moveSound.stop();
      this.lastMoveSoundState = false;
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
      // Play firing sound
      this.fireSound.setSourcePosition(this.tank.position);
      this.fireSound.cloneAndPlay();
      
      // Create a unique shell ID
      const shellId = `shell_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Create the shell with this ID
      const newShell = this.fireShell(shellId);
      
      // Create a unique ID for this firing event to prevent duplicates
      const fireEventId = `fire_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Only dispatch the event if we haven't seen this fire action before
      if (!window._processedFireEvents) {
        window._processedFireEvents = new Set();
      }
      
      if (!window._processedFireEvents.has(fireEventId)) {
        // Mark this fire event as processed
        window._processedFireEvents.add(fireEventId);
        
        // Create an event for this shell being fired
        const shellFiredEvent = new CustomEvent('shell-fired', {
          bubbles: true,
          composed: true,
          detail: {
            shellId: newShell.getShellId(), // Use the shell's ID from the shell object
            position: {
              x: newShell.mesh.position.x,
              y: newShell.mesh.position.y,
              z: newShell.mesh.position.z
            },
            direction: {
              x: newShell.getDirection().x,
              y: newShell.getDirection().y,
              z: newShell.getDirection().z
            },
            speed: this.SHELL_SPEED
          }
        });
        
        // Dispatch the event
        document.dispatchEvent(shellFiredEvent);
        
        // Clean up old fire event IDs to prevent memory leaks
        if (window._processedFireEvents.size > 100) {
          // Keep only the most recent 50 events
          const oldEvents = Array.from(window._processedFireEvents).slice(0, 50);
          for (const oldEvent of oldEvents) {
            window._processedFireEvents.delete(oldEvent);
          }
        }
      }
      
      return newShell;
    }
    
    return null;
  }
  
  private fireShell(): Shell {
    // Set reload timer
    this.canFire = false;
    this.lastFireTime = Date.now();
    
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
  
  private createHealthBar(): void {
    // Creating a canvas for the health bar and name tag
    const canvas = document.createElement('canvas');
    canvas.width = 256;  // Wider canvas to fit the name
    canvas.height = 32;  // Taller canvas for name + health bar
    const context = canvas.getContext('2d');
    
    if (context) {
      // Clear the entire canvas
      context.clearRect(0, 0, 128, 32);
      
      // Draw the tank name
      context.font = 'bold 18px Arial';
      context.textAlign = 'center';
      context.fillStyle = 'white';
      context.strokeStyle = 'black';
      context.lineWidth = 2;
      context.strokeText(this.tankName, 64, 12);
      context.fillText(this.tankName, 64, 12);
      
      // Draw the background (black) for health bar
      context.fillStyle = 'rgba(0,0,0,0.6)';
      context.fillRect(0, 16, 128, 16);
      
      // Draw the health bar (green)
      context.fillStyle = '#00FF00';
      context.fillRect(2, 18, 124, 12);
      
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
      sprite.position.set(0, 3.5, 0); // Higher position to make room for name
      
      // Scale the sprite to an appropriate size
      sprite.scale.set(3.0, 1.0, 1.0); // Wider to accommodate name
      
      // Add the sprite to the tank
      this.tank.add(sprite);
      
      // Store the sprite for later reference
      this.healthBarSprite = sprite;
    }
  }
  
  private updateHealthBar(): void {
    if (!this.healthBarContext || !this.healthBarTexture) return;
    
    // Calculate health percentage
    const healthPercent = this.health / this.MAX_HEALTH;
    
    // Clear only the health bar portion (bottom half of the canvas)
    this.healthBarContext.clearRect(0, 16, 128, 16);
    
    // Draw background (black) for health bar
    this.healthBarContext.fillStyle = 'rgba(0,0,0,0.6)';
    this.healthBarContext.fillRect(0, 16, 128, 16);
    
    // Determine color based on health percentage
    if (healthPercent > 0.6) {
      this.healthBarContext.fillStyle = '#00FF00'; // Green
    } else if (healthPercent > 0.3) {
      this.healthBarContext.fillStyle = '#FFFF00'; // Yellow
    } else {
      this.healthBarContext.fillStyle = '#FF0000'; // Red
    }
    
    // Draw health bar with current percentage
    const barWidth = Math.floor(124 * healthPercent);
    this.healthBarContext.fillRect(2, 18, barWidth, 12);
    
    // Update the texture
    this.healthBarTexture.needsUpdate = true;
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
      
      // Play explosion sound
      this.explodeSound.setSourcePosition(this.tank.position);
      this.explodeSound.cloneAndPlay();
      
      // Stop movement sound if it was playing
      if (this.lastMoveSoundState) {
        this.moveSound.stop();
        this.lastMoveSoundState = false;
      }
      
      return true;
    }
    
    // Player's health bar is shown in the UI, not above the tank
    
    return false;
  }
  
  // Set health directly (for remote players)
  setHealth(health: number): void {
    if (this.isDestroyed) return;
    
    // Set health value
    this.health = Math.max(0, Math.min(this.MAX_HEALTH, health));
    
    // Update health bar if it exists
    this.updateHealthBar();
    
    // Check if destroyed
    if (this.health <= 0 && !this.isDestroyed) {
      this.health = 0;
      this.isDestroyed = true;
      this.createDestroyedEffect();
    }
  }
  
  getHealth(): number {
    return this.health;
  }
  
  // Add property to store tank's owner ID
  private ownerId?: string;
  
  // Getter for tank owner ID
  getOwnerId(): string | undefined {
    return this.ownerId;
  }
  
  // Setter for tank owner ID
  setOwnerId(id: string) {
    this.ownerId = id;
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
    
    // Reset collider
    this.collider.center.copy(this.tank.position);
    
    // Remove destroyed effects
    for (const effect of this.destroyedEffects) {
      this.scene.remove(effect);
    }
    this.destroyedEffects = [];
    
    // Dispatch tank respawn event
    const respawnEvent = new CustomEvent('tank-respawn', {
      bubbles: true,
      composed: true,
      detail: { 
        playerId: this.ownerId || 'player',
        position: {
          x: this.tank.position.x,
          y: this.tank.position.y,
          z: this.tank.position.z
        }
      }
    });
    document.dispatchEvent(respawnEvent);
  }
  
  private createDestroyedEffect(): void {
    // Hide the tank
    this.tank.visible = false;
    
    // Hide health bar sprite
    if (this.healthBarSprite) {
      this.healthBarSprite.visible = false;
    }
    
    // 1. Add initial explosion flash
    this.createExplosionFlash();
    
    // 2. Create debris particles (tank parts flying off)
    this.createDebrisParticles();
    
    // 3. Create enhanced smoke system
    this.createSmokeEffect();
    
    // 4. Create enhanced fire effect
    this.createFireEffect();
    
    // 5. Create shockwave effect
    this.createShockwaveEffect();
    
    // 6. Create sparks effect
    this.createSparksEffect();
    
    // Optional - Play sound effects if audio system available
    if (typeof Audio !== 'undefined') {
      try {
        const explosion = new Audio();
        explosion.src = '/static/js/assets/explosion.mp3';  // This is hypothetical - would need to be added to assets
        explosion.volume = 0.7;
        explosion.play().catch(e => console.log('Audio play failed:', e));
      } catch (e) {
        console.log('Audio not supported');
      }
    }
  }
  
  private createExplosionFlash(): void {
    // Create a sphere for the initial flash
    const flashGeometry = new THREE.SphereGeometry(3.5, 32, 32);
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff99,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    
    const flash = new THREE.Mesh(flashGeometry, flashMaterial);
    flash.position.copy(this.tank.position);
    flash.position.y += 1.0; // Slightly above ground
    this.scene.add(flash);
    this.destroyedEffects.push(flash);
    
    // Create animation to fade out the flash
    const fadeOut = () => {
      if (!flash.material) return;
      
      const material = flash.material as THREE.MeshBasicMaterial;
      material.opacity -= 0.05;
      
      if (material.opacity <= 0) {
        // Remove flash when completely faded
        this.scene.remove(flash);
        return;
      }
      
      // Continue animation on next frame
      requestAnimationFrame(fadeOut);
    };
    
    // Start the fade-out animation
    requestAnimationFrame(fadeOut);
  }
  
  private createDebrisParticles(): void {
    // Create debris particles representing tank parts
    const debrisCount = 20;
    const debrisGeometry = new THREE.BufferGeometry();
    const debrisPositions = new Float32Array(debrisCount * 3);
    const debrisSizes = new Float32Array(debrisCount);
    const debrisColors = new Float32Array(debrisCount * 3);
    const debrisVelocities: Array<THREE.Vector3> = [];
    
    // Create random debris particles
    for (let i = 0; i < debrisCount; i++) {
      const i3 = i * 3;
      
      // Start at tank position with small random offset
      debrisPositions[i3] = this.tank.position.x + (Math.random() - 0.5) * 1.5;
      debrisPositions[i3 + 1] = this.tank.position.y + Math.random() * 1.5;
      debrisPositions[i3 + 2] = this.tank.position.z + (Math.random() - 0.5) * 1.5;
      
      // Random sizes for debris
      debrisSizes[i] = 0.2 + Math.random() * 0.5;
      
      // Tank colors (mostly metal gray with some colored parts)
      if (Math.random() > 0.7) {
        // Use tank body color for some debris
        const tankColor = new THREE.Color(this.tankColor || 0x4a7c59);
        debrisColors[i3] = tankColor.r;
        debrisColors[i3 + 1] = tankColor.g;
        debrisColors[i3 + 2] = tankColor.b;
      } else {
        // Dark metal for most debris
        const darkness = 0.2 + Math.random() * 0.3;
        debrisColors[i3] = darkness;
        debrisColors[i3 + 1] = darkness;
        debrisColors[i3 + 2] = darkness;
      }
      
      // Random velocity for debris
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.1 + Math.random() * 0.3;
      const velocity = new THREE.Vector3(
        Math.cos(angle) * speed,
        0.1 + Math.random() * 0.4, // Upward velocity
        Math.sin(angle) * speed
      );
      debrisVelocities.push(velocity);
    }
    
    debrisGeometry.setAttribute('position', new THREE.BufferAttribute(debrisPositions, 3));
    debrisGeometry.setAttribute('size', new THREE.BufferAttribute(debrisSizes, 1));
    debrisGeometry.setAttribute('color', new THREE.BufferAttribute(debrisColors, 3));
    
    const debrisMaterial = new THREE.PointsMaterial({
      size: 1.0,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      sizeAttenuation: true
    });
    
    const debrisParticles = new THREE.Points(debrisGeometry, debrisMaterial);
    this.scene.add(debrisParticles);
    this.destroyedEffects.push(debrisParticles);
    
    // Animate debris
    const updateDebris = () => {
      const positions = debrisGeometry.attributes.position.array as Float32Array;
      
      for (let i = 0; i < debrisCount; i++) {
        const i3 = i * 3;
        const velocity = debrisVelocities[i];
        
        // Apply velocity
        positions[i3] += velocity.x;
        positions[i3 + 1] += velocity.y;
        positions[i3 + 2] += velocity.z;
        
        // Apply gravity
        velocity.y -= 0.01;
        
        // Slight drag
        velocity.x *= 0.99;
        velocity.z *= 0.99;
        
        // Ground collision
        if (positions[i3 + 1] < 0.1) {
          positions[i3 + 1] = 0.1;
          velocity.y = 0;
          
          // Reduce horizontal speed when on ground
          velocity.x *= 0.7;
          velocity.z *= 0.7;
        }
      }
      
      debrisGeometry.attributes.position.needsUpdate = true;
      
      // Continue animation
      requestAnimationFrame(updateDebris);
    };
    
    // Start animation
    requestAnimationFrame(updateDebris);
  }
  
  private createSmokeEffect(): void {
    // Enhanced smoke particle system
    const particleCount = 80; // Increased from 50
    const smokeGeometry = new THREE.BufferGeometry();
    const smokePositions = new Float32Array(particleCount * 3);
    const smokeSizes = new Float32Array(particleCount);
    const smokeColors = new Float32Array(particleCount * 3);
    const smokeVelocities: Array<THREE.Vector3> = [];
    const smokeCreationTimes: Array<number> = [];
    const currentTime = Date.now();
    
    // Create random positions within a sphere
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      const radius = 1.8; // Slightly larger than before
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      
      smokePositions[i3] = this.tank.position.x + radius * Math.sin(phi) * Math.cos(theta);
      smokePositions[i3 + 1] = this.tank.position.y + radius * Math.cos(phi) + 1.2; // Slightly above ground
      smokePositions[i3 + 2] = this.tank.position.z + radius * Math.sin(phi) * Math.sin(theta);
      
      // Variable smoke sizes
      smokeSizes[i] = 0.7 + Math.random() * 1.2;
      
      // Dark smoke color (dark gray to black) with slightly more variation
      const darkness = 0.1 + Math.random() * 0.25;
      smokeColors[i3] = darkness;
      smokeColors[i3 + 1] = darkness;
      smokeColors[i3 + 2] = darkness;
      
      // Add random velocity to each particle
      const upwardVelocity = 0.03 + Math.random() * 0.05;
      const horizontalVelocity = 0.01 + Math.random() * 0.02;
      const angle = Math.random() * Math.PI * 2;
      smokeVelocities.push(new THREE.Vector3(
        Math.cos(angle) * horizontalVelocity,
        upwardVelocity,
        Math.sin(angle) * horizontalVelocity
      ));
      
      // Stagger creation times
      smokeCreationTimes.push(currentTime + Math.random() * 1000); // Stagger over 1 second
    }
    
    smokeGeometry.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
    smokeGeometry.setAttribute('size', new THREE.BufferAttribute(smokeSizes, 1));
    smokeGeometry.setAttribute('color', new THREE.BufferAttribute(smokeColors, 3));
    
    const smokeMaterial = new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true
    });
    
    const smokeParticles = new THREE.Points(smokeGeometry, smokeMaterial);
    this.scene.add(smokeParticles);
    this.destroyedEffects.push(smokeParticles);
    
    // Animate smoke
    const smokeDuration = 8000; // 8 seconds
    const updateSmoke = () => {
      const currentTime = Date.now();
      const positions = smokeGeometry.attributes.position.array as Float32Array;
      const sizes = smokeGeometry.attributes.size.array as Float32Array;
      
      for (let i = 0; i < particleCount; i++) {
        // Only activate particles when their time arrives
        if (currentTime < smokeCreationTimes[i]) continue;
        
        const i3 = i * 3;
        const velocity = smokeVelocities[i];
        const age = currentTime - smokeCreationTimes[i];
        
        // Apply velocity with wind drift
        positions[i3] += velocity.x + Math.sin(age * 0.001) * 0.01;
        positions[i3 + 1] += velocity.y;
        positions[i3 + 2] += velocity.z + Math.cos(age * 0.001) * 0.01;
        
        // Grow particles over time
        if (age < 2000) {
          sizes[i] = Math.min(3.0, sizes[i] * 1.01);
        }
        
        // Fade out particles after a certain age
        if (age > smokeDuration * 0.6) {
          smokeMaterial.opacity = Math.max(0, 0.8 - (age - smokeDuration * 0.6) / (smokeDuration * 0.4) * 0.8);
        }
      }
      
      smokeGeometry.attributes.position.needsUpdate = true;
      smokeGeometry.attributes.size.needsUpdate = true;
      
      // Continue animation if smoke is still visible
      if (smokeMaterial.opacity > 0) {
        requestAnimationFrame(updateSmoke);
      } else {
        this.scene.remove(smokeParticles);
      }
    };
    
    // Start animation
    requestAnimationFrame(updateSmoke);
  }
  
  private createFireEffect(): void {
    // Enhanced fire effect with more dynamic particles
    const fireCount = 60; // Doubled
    const fireGeometry = new THREE.BufferGeometry();
    const firePositions = new Float32Array(fireCount * 3);
    const fireSizes = new Float32Array(fireCount);
    const fireColors = new Float32Array(fireCount * 3);
    const fireVelocities: Array<THREE.Vector3> = [];
    const fireCreationTimes: Array<number> = [];
    const currentTime = Date.now();
    
    // Create random positions for fire
    for (let i = 0; i < fireCount; i++) {
      const i3 = i * 3;
      const radius = 1.2;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI / 2; // Concentrate in lower hemisphere
      
      firePositions[i3] = this.tank.position.x + radius * Math.sin(phi) * Math.cos(theta);
      firePositions[i3 + 1] = this.tank.position.y + 0.5; // Lower than smoke
      firePositions[i3 + 2] = this.tank.position.z + radius * Math.sin(phi) * Math.sin(theta);
      
      // Variable fire sizes
      fireSizes[i] = 0.5 + Math.random() * 1.0;
      
      // More vibrant fire colors with variation
      if (Math.random() > 0.7) {
        // Yellow flames
        fireColors[i3] = 1.0; // Red
        fireColors[i3 + 1] = 0.8 + Math.random() * 0.2; // Green
        fireColors[i3 + 2] = 0.1 + Math.random() * 0.2; // A bit of blue
      } else {
        // Orange-red flames
        fireColors[i3] = 0.9 + Math.random() * 0.1; // Red
        fireColors[i3 + 1] = 0.3 + Math.random() * 0.3; // Green
        fireColors[i3 + 2] = 0; // No blue
      }
      
      // Add velocity
      const upwardVelocity = 0.05 + Math.random() * 0.08;
      const horizontalVelocity = 0.01 + Math.random() * 0.03;
      const angle = Math.random() * Math.PI * 2;
      fireVelocities.push(new THREE.Vector3(
        Math.cos(angle) * horizontalVelocity,
        upwardVelocity,
        Math.sin(angle) * horizontalVelocity
      ));
      
      // Stagger creation times for continuous flame effect
      fireCreationTimes.push(currentTime + Math.random() * 1500);
    }
    
    fireGeometry.setAttribute('position', new THREE.BufferAttribute(firePositions, 3));
    fireGeometry.setAttribute('size', new THREE.BufferAttribute(fireSizes, 1));
    fireGeometry.setAttribute('color', new THREE.BufferAttribute(fireColors, 3));
    
    const fireMaterial = new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });
    
    const fireParticles = new THREE.Points(fireGeometry, fireMaterial);
    this.scene.add(fireParticles);
    this.destroyedEffects.push(fireParticles);
    
    // Animate fire
    const fireDuration = 4000; // 4 seconds - shorter than smoke
    const updateFire = () => {
      const currentTime = Date.now();
      const positions = fireGeometry.attributes.position.array as Float32Array;
      const sizes = fireGeometry.attributes.size.array as Float32Array;
      
      for (let i = 0; i < fireCount; i++) {
        // Only activate particles when their time arrives
        if (currentTime < fireCreationTimes[i]) continue;
        
        const i3 = i * 3;
        const velocity = fireVelocities[i];
        const age = currentTime - fireCreationTimes[i];
        
        // Apply velocity with flickering
        positions[i3] += velocity.x + (Math.random() - 0.5) * 0.05;
        positions[i3 + 1] += velocity.y;
        positions[i3 + 2] += velocity.z + (Math.random() - 0.5) * 0.05;
        
        // Shrink particles as they rise (fire consumes)
        if (age > 500) {
          sizes[i] = Math.max(0.1, sizes[i] * 0.98);
        }
        
        // Fade out particles after a certain age
        if (age > fireDuration * 0.5) {
          fireMaterial.opacity = Math.max(0, 0.9 - (age - fireDuration * 0.5) / (fireDuration * 0.5) * 0.9);
        }
      }
      
      fireGeometry.attributes.position.needsUpdate = true;
      fireGeometry.attributes.size.needsUpdate = true;
      
      // Continue animation if fire is still visible
      if (fireMaterial.opacity > 0) {
        requestAnimationFrame(updateFire);
      } else {
        this.scene.remove(fireParticles);
      }
    };
    
    // Start animation
    requestAnimationFrame(updateFire);
  }
  
  private createShockwaveEffect(): void {
    // Create an expanding ring for the shockwave
    const shockwaveGeometry = new THREE.RingGeometry(0.1, 0.5, 32);
    const shockwaveMaterial = new THREE.MeshBasicMaterial({
      color: 0xffcc66,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    
    const shockwave = new THREE.Mesh(shockwaveGeometry, shockwaveMaterial);
    shockwave.rotation.x = -Math.PI / 2; // Lay flat on the ground
    shockwave.position.copy(this.tank.position);
    shockwave.position.y = 0.1; // Just above ground
    this.scene.add(shockwave);
    this.destroyedEffects.push(shockwave);
    
    // Animate shockwave
    const shockwaveDuration = 1000; // 1 second
    const startTime = Date.now();
    const maxRadius = 10;
    
    const updateShockwave = () => {
      const currentTime = Date.now();
      const elapsed = currentTime - startTime;
      const progress = Math.min(1, elapsed / shockwaveDuration);
      
      // Expand the ring
      const innerRadius = progress * maxRadius;
      const outerRadius = innerRadius + 0.5 + progress * 2;
      
      shockwave.scale.set(innerRadius, innerRadius, 1);
      
      // Fade out
      shockwaveMaterial.opacity = 0.7 * (1 - progress);
      
      if (progress < 1) {
        requestAnimationFrame(updateShockwave);
      } else {
        this.scene.remove(shockwave);
      }
    };
    
    // Start animation
    requestAnimationFrame(updateShockwave);
  }
  
  private createSparksEffect(): void {
    // Create sparks (bright, fast particles)
    const sparkCount = 30;
    const sparkGeometry = new THREE.BufferGeometry();
    const sparkPositions = new Float32Array(sparkCount * 3);
    const sparkSizes = new Float32Array(sparkCount);
    const sparkColors = new Float32Array(sparkCount * 3);
    const sparkVelocities: Array<THREE.Vector3> = [];
    
    // Create random spark particles
    for (let i = 0; i < sparkCount; i++) {
      const i3 = i * 3;
      
      // Start at tank position
      sparkPositions[i3] = this.tank.position.x;
      sparkPositions[i3 + 1] = this.tank.position.y + 1;
      sparkPositions[i3 + 2] = this.tank.position.z;
      
      // Small bright sparks
      sparkSizes[i] = 0.2 + Math.random() * 0.3;
      
      // Bright yellow/white colors
      sparkColors[i3] = 1.0;  // Red
      sparkColors[i3 + 1] = 0.9 + Math.random() * 0.1; // Green
      sparkColors[i3 + 2] = 0.6 + Math.random() * 0.4; // Blue
      
      // High velocity in random directions
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const speed = 0.2 + Math.random() * 0.4;
      const velocity = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.cos(phi) * speed,
        Math.sin(phi) * Math.sin(theta) * speed
      );
      sparkVelocities.push(velocity);
    }
    
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
    sparkGeometry.setAttribute('size', new THREE.BufferAttribute(sparkSizes, 1));
    sparkGeometry.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3));
    
    const sparkMaterial = new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });
    
    const sparkParticles = new THREE.Points(sparkGeometry, sparkMaterial);
    this.scene.add(sparkParticles);
    this.destroyedEffects.push(sparkParticles);
    
    // Animate sparks
    const sparkDuration = 1500; // 1.5 seconds
    const startTime = Date.now();
    
    const updateSparks = () => {
      const currentTime = Date.now();
      const elapsed = currentTime - startTime;
      const progress = elapsed / sparkDuration;
      
      const positions = sparkGeometry.attributes.position.array as Float32Array;
      const sizes = sparkGeometry.attributes.size.array as Float32Array;
      
      for (let i = 0; i < sparkCount; i++) {
        const i3 = i * 3;
        const velocity = sparkVelocities[i];
        
        // Apply velocity
        positions[i3] += velocity.x;
        positions[i3 + 1] += velocity.y;
        positions[i3 + 2] += velocity.z;
        
        // Apply gravity
        velocity.y -= 0.015;
        
        // Shrink sparks over time
        sizes[i] *= 0.98;
      }
      
      // Fade out toward the end
      if (progress > 0.7) {
        sparkMaterial.opacity = 1.0 - ((progress - 0.7) / 0.3);
      }
      
      sparkGeometry.attributes.position.needsUpdate = true;
      sparkGeometry.attributes.size.needsUpdate = true;
      
      if (progress < 1) {
        requestAnimationFrame(updateSparks);
      } else {
        this.scene.remove(sparkParticles);
      }
    };
    
    // Start animation
    requestAnimationFrame(updateSparks);
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
  
  // Implement movement status method
  isMoving(): boolean {
    return this.isCurrentlyMoving;
  }
  
  // Implement velocity getter method
  getVelocity(): number {
    return this.velocity;
  }
  
  // Update all sound positions based on tank position
  protected updateSoundPositions(): void {
    const position = this.tank.position;
    this.moveSound.setSourcePosition(position);
    this.fireSound.setSourcePosition(position);
    this.explodeSound.setSourcePosition(position);
  }
}

// Helper function to generate random tank names
function generateRandomTankName(): string {
  const adjectives = [
    "Rusty", "Mighty", "Swift", "Iron", "Steel", "Thunder", "Lightning", "Shadow", "Desert", "Arctic",
    "Jungle", "Mountain", "Blazing", "Frozen", "Silent", "Roaring", "Ancient", "Phantom", "Savage", "Noble",
    "Fierce", "Crimson", "Stormy", "Golden", "Silver", "Bronze", "Heavy", "Rapid", "Relentless", "Vigilant"
  ];
  
  const nouns = [
    "Panther", "Tiger", "Dragon", "Serpent", "Ghost", "Falcon", "Eagle", "Wolf", "Rhino", "Mammoth",
    "Titan", "Colossus", "Hunter", "Stalker", "Crusher", "Smasher", "Destroyer", "Guardian", "Sentinel", "Avenger",
    "Hammer", "Blade", "Thunder", "Viper", "Cobra", "Scorpion", "Shark", "Raven", "Phoenix", "Barracuda"
  ];
  
  const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
  
  return `${randomAdjective} ${randomNoun}`;
}

export class NPCTank implements ITank {
  // Tank components
  tank: THREE.Group;
  tankBody?: THREE.Mesh;
  turret?: THREE.Mesh;
  turretPivot: THREE.Group;
  barrel?: THREE.Mesh;
  barrelPivot: THREE.Group;
  
  // Add owner ID property
  private ownerId?: string;
  
  // Getter for tank owner ID
  getOwnerId(): string | undefined {
    return this.ownerId;
  }
  
  // Setter for tank owner ID
  setOwnerId(id: string) {
    this.ownerId = id;
  }
  
  // Implement required interface methods
  getMinBarrelElevation(): number {
    return this.minBarrelElevation;
  }
  
  getMaxBarrelElevation(): number {
    return this.maxBarrelElevation;
  }
  
  isMoving(): boolean {
    // Returns whether the tank is currently moving
    return this.isCurrentlyMoving;
  }
  
  getVelocity(): number {
    // Returns the current velocity of the tank
    return this.velocity;
  }
  
  // Tank properties
  private tankSpeed = 0.1;
  private tankRotationSpeed = 0.03;
  private turretRotationSpeed = 0.02;
  private barrelElevationSpeed = 0.01;
  private maxBarrelElevation = 0;
  private minBarrelElevation = -Math.PI / 4;
  private velocity: number = 0;
  private isCurrentlyMoving: boolean = false;
  
  // NPC behavior properties
  private movementPattern: 'circle' | 'zigzag' | 'random' | 'patrol';
  private movementTimer = 0;
  private changeDirectionInterval: number;
  private currentDirection = 0; // Angle in radians
  private targetPosition = new THREE.Vector3();
  private patrolPoints: THREE.Vector3[] = [];
  private currentPatrolIndex = 0;
  private tankColor: number;
  tankName: string; // Public to allow access from game component
  
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
  private lastFireTime: number = 0;
  private readonly FIRE_COOLDOWN_MS: number = 3000; // 3 second cooldown in milliseconds
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

  constructor(scene: THREE.Scene, position: THREE.Vector3, color = 0xff0000, name?: string) {
    this.scene = scene;
    this.tankColor = color;
    
    // Initialize tank name (use provided name or generate a random one)
    this.tankName = name || generateRandomTankName();
    
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
    
    // Initialize sound effects (at lower volume than player tank)
    // Trim 4 seconds from the end of the tank movement sound for smooth looping
    this.moveSound = new SpatialAudio('/static/js/assets/sounds/tank-move.mp3', true, 0.3, 120, 4.0);
    this.fireSound = new SpatialAudio('/static/js/assets/sounds/tank-fire.mp3', false, 0.5, 150);
    this.explodeSound = new SpatialAudio('/static/js/assets/sounds/tank-explode.mp3', false, 0.6, 200);
    
    // Create health bar with tank name
    this.createHealthBar();
    
    // Add to scene
    scene.add(this.tank);
  }
  
  private createHealthBar(): void {
    // Follow the billboarding example from three.js manual
    // Creating a canvas for the health bar and name tag
    const canvas = document.createElement('canvas');
    canvas.width = 256;  // Much wider canvas to fit the player ID
    canvas.height = 48;  // Taller canvas for name + health bar
    const context = canvas.getContext('2d');
    
    if (context) {
      // Clear the entire canvas
      context.clearRect(0, 0, 256, 48);
      
      // Draw the tank name
      context.font = 'bold 20px Arial'; // Larger font
      context.textAlign = 'center';
      context.fillStyle = 'white';
      context.strokeStyle = 'black';
      context.lineWidth = 3; // Thicker outline for better visibility
      context.strokeText(this.tankName, 128, 20); // Centered text
      context.fillText(this.tankName, 128, 20);
      
      // Draw the background (black) for health bar
      context.fillStyle = 'rgba(0,0,0,0.7)'; // Slightly more opaque
      context.fillRect(0, 28, 256, 20); // Taller health bar
      
      // Draw the health bar (green)
      context.fillStyle = '#00FF00';
      context.fillRect(4, 30, 248, 16); // Adjusted position and size
      
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
      sprite.position.set(0, 3.7, 0); // Higher position to make room for name
      
      // Scale the sprite to an appropriate size
      sprite.scale.set(4.0, 1.5, 1.0); // Wider and taller to accommodate name
      
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
    
    // Clear only the health bar portion (bottom half of the canvas)
    this.healthBarContext.clearRect(0, 28, 256, 20);
    
    // Draw background (black) for health bar
    this.healthBarContext.fillStyle = 'rgba(0,0,0,0.7)';
    this.healthBarContext.fillRect(0, 28, 256, 20);
    
    // Determine color based on health percentage
    if (healthPercent > 0.6) {
      this.healthBarContext.fillStyle = '#00FF00'; // Green
    } else if (healthPercent > 0.3) {
      this.healthBarContext.fillStyle = '#FFFF00'; // Yellow
    } else {
      this.healthBarContext.fillStyle = '#FF0000'; // Red
    }
    
    // Draw health bar with current percentage
    const barWidth = Math.floor(248 * healthPercent);
    this.healthBarContext.fillRect(4, 30, barWidth, 16);
    
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
    
    // Update sound positions
    this.updateSoundPositions();
    
    // Reset movement state
    this.isCurrentlyMoving = false;
    this.velocity = 0;
    
    // Handle reloading using timestamps instead of frame counting
    if (!this.canFire) {
      const currentTime = Date.now();
      if (currentTime - this.lastFireTime >= this.FIRE_COOLDOWN_MS) {
        this.canFire = true;
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
    
    // Update movement sound based on movement status
    if (this.isCurrentlyMoving) {
      if (!this.lastMoveSoundState) {
        this.moveSound.play();
        this.lastMoveSoundState = true;
      }
    } else if (this.lastMoveSoundState) {
      this.moveSound.stop();
      this.lastMoveSoundState = false;
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
          // Play firing sound
          this.fireSound.setSourcePosition(this.tank.position);
          this.fireSound.cloneAndPlay();
          
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
    this.lastFireTime = Date.now();
    
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
    
    // Update movement status
    this.isCurrentlyMoving = true;
    this.velocity = this.tankSpeed;
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
    
    // Update movement status
    this.isCurrentlyMoving = true;
    this.velocity = this.tankSpeed;
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
    
    // Update movement status
    this.isCurrentlyMoving = true;
    this.velocity = this.tankSpeed;
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
    
    // Update movement status
    this.isCurrentlyMoving = true;
    this.velocity = this.tankSpeed;
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
      
      // Play explosion sound
      this.explodeSound.setSourcePosition(this.tank.position);
      this.explodeSound.cloneAndPlay();
      
      // Stop movement sound if it was playing
      if (this.lastMoveSoundState) {
        this.moveSound.stop();
        this.lastMoveSoundState = false;
      }
      
      return true;
    }
    
    // Update health bar
    this.updateHealthBar();
    
    return false;
  }
  
  getHealth(): number {
    return this.health;
  }
  
  // Set health directly (for remote players)
  setHealth(health: number): void {
    if (this.isDestroyed) return;
    
    // Set health value
    this.health = Math.max(0, Math.min(this.MAX_HEALTH, health));
    
    // Update health bar if it exists
    this.updateHealthBar();
    
    // Check if destroyed
    if (this.health <= 0 && !this.isDestroyed) {
      this.health = 0;
      this.isDestroyed = true;
      this.createDestroyedEffect();
    }
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
    
    // Dispatch tank respawn event if this is a remote player (has owner ID)
    if (this.ownerId) {
      const respawnEvent = new CustomEvent('tank-respawn', {
        bubbles: true,
        composed: true,
        detail: { 
          playerId: this.ownerId,
          position: {
            x: this.tank.position.x,
            y: this.tank.position.y,
            z: this.tank.position.z
          }
        }
      });
      document.dispatchEvent(respawnEvent);
    }
  }
  
  private createDestroyedEffect(): void {
    // Hide the tank
    this.tank.visible = false;
    
    // Hide the health bar sprite
    if (this.healthBarSprite) {
      this.healthBarSprite.visible = false;
    }
    
    // 1. Add initial explosion flash
    this.createExplosionFlash();
    
    // 2. Create debris particles (tank parts flying off)
    this.createDebrisParticles();
    
    // 3. Create enhanced smoke system
    this.createSmokeEffect();
    
    // 4. Create enhanced fire effect
    this.createFireEffect();
    
    // 5. Create shockwave effect
    this.createShockwaveEffect();
    
    // 6. Create sparks effect
    this.createSparksEffect();
  }
  
  private createExplosionFlash(): void {
    // Create a sphere for the initial flash
    const flashGeometry = new THREE.SphereGeometry(3.5, 32, 32);
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff99,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    
    const flash = new THREE.Mesh(flashGeometry, flashMaterial);
    flash.position.copy(this.tank.position);
    flash.position.y += 1.0; // Slightly above ground
    this.scene.add(flash);
    this.destroyedEffects.push(flash);
    
    // Create animation to fade out the flash
    const fadeOut = () => {
      if (!flash.material) return;
      
      const material = flash.material as THREE.MeshBasicMaterial;
      material.opacity -= 0.05;
      
      if (material.opacity <= 0) {
        // Remove flash when completely faded
        this.scene.remove(flash);
        return;
      }
      
      // Continue animation on next frame
      requestAnimationFrame(fadeOut);
    };
    
    // Start the fade-out animation
    requestAnimationFrame(fadeOut);
  }
  
  private createDebrisParticles(): void {
    // Create debris particles representing tank parts
    const debrisCount = 20;
    const debrisGeometry = new THREE.BufferGeometry();
    const debrisPositions = new Float32Array(debrisCount * 3);
    const debrisSizes = new Float32Array(debrisCount);
    const debrisColors = new Float32Array(debrisCount * 3);
    const debrisVelocities: Array<THREE.Vector3> = [];
    
    // Create random debris particles
    for (let i = 0; i < debrisCount; i++) {
      const i3 = i * 3;
      
      // Start at tank position with small random offset
      debrisPositions[i3] = this.tank.position.x + (Math.random() - 0.5) * 1.5;
      debrisPositions[i3 + 1] = this.tank.position.y + Math.random() * 1.5;
      debrisPositions[i3 + 2] = this.tank.position.z + (Math.random() - 0.5) * 1.5;
      
      // Random sizes for debris
      debrisSizes[i] = 0.2 + Math.random() * 0.5;
      
      // Tank colors (mostly metal gray with some colored parts)
      if (Math.random() > 0.7) {
        // Use tank body color for some debris
        const tankColor = new THREE.Color(this.tankColor || 0x4a7c59);
        debrisColors[i3] = tankColor.r;
        debrisColors[i3 + 1] = tankColor.g;
        debrisColors[i3 + 2] = tankColor.b;
      } else {
        // Dark metal for most debris
        const darkness = 0.2 + Math.random() * 0.3;
        debrisColors[i3] = darkness;
        debrisColors[i3 + 1] = darkness;
        debrisColors[i3 + 2] = darkness;
      }
      
      // Random velocity for debris
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.1 + Math.random() * 0.3;
      const velocity = new THREE.Vector3(
        Math.cos(angle) * speed,
        0.1 + Math.random() * 0.4, // Upward velocity
        Math.sin(angle) * speed
      );
      debrisVelocities.push(velocity);
    }
    
    debrisGeometry.setAttribute('position', new THREE.BufferAttribute(debrisPositions, 3));
    debrisGeometry.setAttribute('size', new THREE.BufferAttribute(debrisSizes, 1));
    debrisGeometry.setAttribute('color', new THREE.BufferAttribute(debrisColors, 3));
    
    const debrisMaterial = new THREE.PointsMaterial({
      size: 1.0,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      sizeAttenuation: true
    });
    
    const debrisParticles = new THREE.Points(debrisGeometry, debrisMaterial);
    this.scene.add(debrisParticles);
    this.destroyedEffects.push(debrisParticles);
    
    // Animate debris
    const updateDebris = () => {
      const positions = debrisGeometry.attributes.position.array as Float32Array;
      
      for (let i = 0; i < debrisCount; i++) {
        const i3 = i * 3;
        const velocity = debrisVelocities[i];
        
        // Apply velocity
        positions[i3] += velocity.x;
        positions[i3 + 1] += velocity.y;
        positions[i3 + 2] += velocity.z;
        
        // Apply gravity
        velocity.y -= 0.01;
        
        // Slight drag
        velocity.x *= 0.99;
        velocity.z *= 0.99;
        
        // Ground collision
        if (positions[i3 + 1] < 0.1) {
          positions[i3 + 1] = 0.1;
          velocity.y = 0;
          
          // Reduce horizontal speed when on ground
          velocity.x *= 0.7;
          velocity.z *= 0.7;
        }
      }
      
      debrisGeometry.attributes.position.needsUpdate = true;
      
      // Continue animation
      requestAnimationFrame(updateDebris);
    };
    
    // Start animation
    requestAnimationFrame(updateDebris);
  }
  
  private createSmokeEffect(): void {
    // Enhanced smoke particle system
    const particleCount = 80;
    const smokeGeometry = new THREE.BufferGeometry();
    const smokePositions = new Float32Array(particleCount * 3);
    const smokeSizes = new Float32Array(particleCount);
    const smokeColors = new Float32Array(particleCount * 3);
    const smokeVelocities: Array<THREE.Vector3> = [];
    const smokeCreationTimes: Array<number> = [];
    const currentTime = Date.now();
    
    // Create random positions within a sphere
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      const radius = 1.8;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      
      smokePositions[i3] = this.tank.position.x + radius * Math.sin(phi) * Math.cos(theta);
      smokePositions[i3 + 1] = this.tank.position.y + radius * Math.cos(phi) + 1.2; // Slightly above ground
      smokePositions[i3 + 2] = this.tank.position.z + radius * Math.sin(phi) * Math.sin(theta);
      
      // Variable smoke sizes
      smokeSizes[i] = 0.7 + Math.random() * 1.2;
      
      // Dark smoke color (dark gray to black) with slightly more variation
      const darkness = 0.1 + Math.random() * 0.25;
      smokeColors[i3] = darkness;
      smokeColors[i3 + 1] = darkness;
      smokeColors[i3 + 2] = darkness;
      
      // Add random velocity to each particle
      const upwardVelocity = 0.03 + Math.random() * 0.05;
      const horizontalVelocity = 0.01 + Math.random() * 0.02;
      const angle = Math.random() * Math.PI * 2;
      smokeVelocities.push(new THREE.Vector3(
        Math.cos(angle) * horizontalVelocity,
        upwardVelocity,
        Math.sin(angle) * horizontalVelocity
      ));
      
      // Stagger creation times
      smokeCreationTimes.push(currentTime + Math.random() * 1000);
    }
    
    smokeGeometry.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
    smokeGeometry.setAttribute('size', new THREE.BufferAttribute(smokeSizes, 1));
    smokeGeometry.setAttribute('color', new THREE.BufferAttribute(smokeColors, 3));
    
    const smokeMaterial = new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true
    });
    
    const smokeParticles = new THREE.Points(smokeGeometry, smokeMaterial);
    this.scene.add(smokeParticles);
    this.destroyedEffects.push(smokeParticles);
    
    // Animate smoke
    const smokeDuration = 8000; // 8 seconds
    const updateSmoke = () => {
      const currentTime = Date.now();
      const positions = smokeGeometry.attributes.position.array as Float32Array;
      const sizes = smokeGeometry.attributes.size.array as Float32Array;
      
      for (let i = 0; i < particleCount; i++) {
        // Only activate particles when their time arrives
        if (currentTime < smokeCreationTimes[i]) continue;
        
        const i3 = i * 3;
        const velocity = smokeVelocities[i];
        const age = currentTime - smokeCreationTimes[i];
        
        // Apply velocity with wind drift
        positions[i3] += velocity.x + Math.sin(age * 0.001) * 0.01;
        positions[i3 + 1] += velocity.y;
        positions[i3 + 2] += velocity.z + Math.cos(age * 0.001) * 0.01;
        
        // Grow particles over time
        if (age < 2000) {
          sizes[i] = Math.min(3.0, sizes[i] * 1.01);
        }
        
        // Fade out particles after a certain age
        if (age > smokeDuration * 0.6) {
          smokeMaterial.opacity = Math.max(0, 0.8 - (age - smokeDuration * 0.6) / (smokeDuration * 0.4) * 0.8);
        }
      }
      
      smokeGeometry.attributes.position.needsUpdate = true;
      smokeGeometry.attributes.size.needsUpdate = true;
      
      // Continue animation if smoke is still visible
      if (smokeMaterial.opacity > 0) {
        requestAnimationFrame(updateSmoke);
      } else {
        this.scene.remove(smokeParticles);
      }
    };
    
    // Start animation
    requestAnimationFrame(updateSmoke);
  }
  
  private createFireEffect(): void {
    // Enhanced fire effect with more dynamic particles
    const fireCount = 60;
    const fireGeometry = new THREE.BufferGeometry();
    const firePositions = new Float32Array(fireCount * 3);
    const fireSizes = new Float32Array(fireCount);
    const fireColors = new Float32Array(fireCount * 3);
    const fireVelocities: Array<THREE.Vector3> = [];
    const fireCreationTimes: Array<number> = [];
    const currentTime = Date.now();
    
    // Create random positions for fire
    for (let i = 0; i < fireCount; i++) {
      const i3 = i * 3;
      const radius = 1.2;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI / 2; // Concentrate in lower hemisphere
      
      firePositions[i3] = this.tank.position.x + radius * Math.sin(phi) * Math.cos(theta);
      firePositions[i3 + 1] = this.tank.position.y + 0.5; // Lower than smoke
      firePositions[i3 + 2] = this.tank.position.z + radius * Math.sin(phi) * Math.sin(theta);
      
      // Variable fire sizes
      fireSizes[i] = 0.5 + Math.random() * 1.0;
      
      // More vibrant fire colors with variation
      if (Math.random() > 0.7) {
        // Yellow flames
        fireColors[i3] = 1.0; // Red
        fireColors[i3 + 1] = 0.8 + Math.random() * 0.2; // Green
        fireColors[i3 + 2] = 0.1 + Math.random() * 0.2; // A bit of blue
      } else {
        // Orange-red flames
        fireColors[i3] = 0.9 + Math.random() * 0.1; // Red
        fireColors[i3 + 1] = 0.3 + Math.random() * 0.3; // Green
        fireColors[i3 + 2] = 0; // No blue
      }
      
      // Add velocity
      const upwardVelocity = 0.05 + Math.random() * 0.08;
      const horizontalVelocity = 0.01 + Math.random() * 0.03;
      const angle = Math.random() * Math.PI * 2;
      fireVelocities.push(new THREE.Vector3(
        Math.cos(angle) * horizontalVelocity,
        upwardVelocity,
        Math.sin(angle) * horizontalVelocity
      ));
      
      // Stagger creation times for continuous flame effect
      fireCreationTimes.push(currentTime + Math.random() * 1500);
    }
    
    fireGeometry.setAttribute('position', new THREE.BufferAttribute(firePositions, 3));
    fireGeometry.setAttribute('size', new THREE.BufferAttribute(fireSizes, 1));
    fireGeometry.setAttribute('color', new THREE.BufferAttribute(fireColors, 3));
    
    const fireMaterial = new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });
    
    const fireParticles = new THREE.Points(fireGeometry, fireMaterial);
    this.scene.add(fireParticles);
    this.destroyedEffects.push(fireParticles);
    
    // Animate fire
    const fireDuration = 4000; // 4 seconds - shorter than smoke
    const updateFire = () => {
      const currentTime = Date.now();
      const positions = fireGeometry.attributes.position.array as Float32Array;
      const sizes = fireGeometry.attributes.size.array as Float32Array;
      
      for (let i = 0; i < fireCount; i++) {
        // Only activate particles when their time arrives
        if (currentTime < fireCreationTimes[i]) continue;
        
        const i3 = i * 3;
        const velocity = fireVelocities[i];
        const age = currentTime - fireCreationTimes[i];
        
        // Apply velocity with flickering
        positions[i3] += velocity.x + (Math.random() - 0.5) * 0.05;
        positions[i3 + 1] += velocity.y;
        positions[i3 + 2] += velocity.z + (Math.random() - 0.5) * 0.05;
        
        // Shrink particles as they rise (fire consumes)
        if (age > 500) {
          sizes[i] = Math.max(0.1, sizes[i] * 0.98);
        }
        
        // Fade out particles after a certain age
        if (age > fireDuration * 0.5) {
          fireMaterial.opacity = Math.max(0, 0.9 - (age - fireDuration * 0.5) / (fireDuration * 0.5) * 0.9);
        }
      }
      
      fireGeometry.attributes.position.needsUpdate = true;
      fireGeometry.attributes.size.needsUpdate = true;
      
      // Continue animation if fire is still visible
      if (fireMaterial.opacity > 0) {
        requestAnimationFrame(updateFire);
      } else {
        this.scene.remove(fireParticles);
      }
    };
    
    // Start animation
    requestAnimationFrame(updateFire);
  }
  
  private createShockwaveEffect(): void {
    // Create an expanding ring for the shockwave
    const shockwaveGeometry = new THREE.RingGeometry(0.1, 0.5, 32);
    const shockwaveMaterial = new THREE.MeshBasicMaterial({
      color: 0xffcc66,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    
    const shockwave = new THREE.Mesh(shockwaveGeometry, shockwaveMaterial);
    shockwave.rotation.x = -Math.PI / 2; // Lay flat on the ground
    shockwave.position.copy(this.tank.position);
    shockwave.position.y = 0.1; // Just above ground
    this.scene.add(shockwave);
    this.destroyedEffects.push(shockwave);
    
    // Animate shockwave
    const shockwaveDuration = 1000; // 1 second
    const startTime = Date.now();
    const maxRadius = 10;
    
    const updateShockwave = () => {
      const currentTime = Date.now();
      const elapsed = currentTime - startTime;
      const progress = Math.min(1, elapsed / shockwaveDuration);
      
      // Expand the ring
      const innerRadius = progress * maxRadius;
      const outerRadius = innerRadius + 0.5 + progress * 2;
      
      shockwave.scale.set(innerRadius, innerRadius, 1);
      
      // Fade out
      shockwaveMaterial.opacity = 0.7 * (1 - progress);
      
      if (progress < 1) {
        requestAnimationFrame(updateShockwave);
      } else {
        this.scene.remove(shockwave);
      }
    };
    
    // Start animation
    requestAnimationFrame(updateShockwave);
  }
  
  private createSparksEffect(): void {
    // Create sparks (bright, fast particles)
    const sparkCount = 30;
    const sparkGeometry = new THREE.BufferGeometry();
    const sparkPositions = new Float32Array(sparkCount * 3);
    const sparkSizes = new Float32Array(sparkCount);
    const sparkColors = new Float32Array(sparkCount * 3);
    const sparkVelocities: Array<THREE.Vector3> = [];
    
    // Create random spark particles
    for (let i = 0; i < sparkCount; i++) {
      const i3 = i * 3;
      
      // Start at tank position
      sparkPositions[i3] = this.tank.position.x;
      sparkPositions[i3 + 1] = this.tank.position.y + 1;
      sparkPositions[i3 + 2] = this.tank.position.z;
      
      // Small bright sparks
      sparkSizes[i] = 0.2 + Math.random() * 0.3;
      
      // Bright yellow/white colors
      sparkColors[i3] = 1.0;  // Red
      sparkColors[i3 + 1] = 0.9 + Math.random() * 0.1; // Green
      sparkColors[i3 + 2] = 0.6 + Math.random() * 0.4; // Blue
      
      // High velocity in random directions
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const speed = 0.2 + Math.random() * 0.4;
      const velocity = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.cos(phi) * speed,
        Math.sin(phi) * Math.sin(theta) * speed
      );
      sparkVelocities.push(velocity);
    }
    
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
    sparkGeometry.setAttribute('size', new THREE.BufferAttribute(sparkSizes, 1));
    sparkGeometry.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3));
    
    const sparkMaterial = new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });
    
    const sparkParticles = new THREE.Points(sparkGeometry, sparkMaterial);
    this.scene.add(sparkParticles);
    this.destroyedEffects.push(sparkParticles);
    
    // Animate sparks
    const sparkDuration = 1500; // 1.5 seconds
    const startTime = Date.now();
    
    const updateSparks = () => {
      const currentTime = Date.now();
      const elapsed = currentTime - startTime;
      const progress = elapsed / sparkDuration;
      
      const positions = sparkGeometry.attributes.position.array as Float32Array;
      const sizes = sparkGeometry.attributes.size.array as Float32Array;
      
      for (let i = 0; i < sparkCount; i++) {
        const i3 = i * 3;
        const velocity = sparkVelocities[i];
        
        // Apply velocity
        positions[i3] += velocity.x;
        positions[i3 + 1] += velocity.y;
        positions[i3 + 2] += velocity.z;
        
        // Apply gravity
        velocity.y -= 0.015;
        
        // Shrink sparks over time
        sizes[i] *= 0.98;
      }
      
      // Fade out toward the end
      if (progress > 0.7) {
        sparkMaterial.opacity = 1.0 - ((progress - 0.7) / 0.3);
      }
      
      sparkGeometry.attributes.position.needsUpdate = true;
      sparkGeometry.attributes.size.needsUpdate = true;
      
      if (progress < 1) {
        requestAnimationFrame(updateSparks);
      } else {
        this.scene.remove(sparkParticles);
      }
    };
    
    // Start animation
    requestAnimationFrame(updateSparks);
  }
}
