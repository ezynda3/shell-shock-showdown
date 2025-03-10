import * as THREE from 'three';
import { Shell } from './shell';

/**
 * Tank Classes Hierarchy
 * ---------------------
 * This file implements a class hierarchy for tank entities:
 * 
 * - ITank: Interface defining the common API for all tank types
 * - BaseTank: Abstract base class that implements common tank functionality shared by all tank types
 * - Tank: Player-controlled tank with camera following and user input controls
 * - RemoteTank: Remote player-controlled tank that receives movement data over the network
 * - NPCTank: AI-controlled tank with autonomous movement patterns (extends RemoteTank)
 * 
 * The tanks have common rendering logic, collision detection, and health management,
 * while differing in their control mechanisms (user input vs network vs AI) and specific behaviors.
 */

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
  
  // Audio listener management
  private static globalListener: THREE.Vector3 | null = null;
  private static localListeners: Map<string, THREE.Vector3> = new Map();
  
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

  setListenerPosition(position: THREE.Vector3 | null, listenerId: string = 'global') {
    if (position) {
      if (listenerId === 'global') {
        SpatialAudio.globalListener = position.clone();
      } else {
        SpatialAudio.localListeners.set(listenerId, position.clone());
      }
    } else {
      if (listenerId === 'global') {
        SpatialAudio.globalListener = null;
      } else {
        SpatialAudio.localListeners.delete(listenerId);
      }
    }
    this.updateVolumeAndDoppler();
  }
  
  // Set the global listener position for all spatial audio objects
  static setGlobalListener(position: THREE.Vector3 | null) {
    SpatialAudio.globalListener = position ? position.clone() : null;
  }
  
  // Set a listener position for a specific player
  static setPlayerListener(playerId: string, position: THREE.Vector3 | null) {
    if (position) {
      SpatialAudio.localListeners.set(playerId, position.clone());
    } else {
      SpatialAudio.localListeners.delete(playerId);
    }
  }
  
  // Get all active listeners
  static getActiveListeners(): Map<string, THREE.Vector3> {
    const listeners = new Map<string, THREE.Vector3>();
    
    // Add global listener if available
    if (SpatialAudio.globalListener) {
      listeners.set('global', SpatialAudio.globalListener);
    }
    
    // Add all local listeners
    SpatialAudio.localListeners.forEach((position, id) => {
      listeners.set(id, position);
    });
    
    return listeners;
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
    // Get all active listeners
    const activeListeners = SpatialAudio.getActiveListeners();
    
    // If we have no listeners, use default volume
    if (activeListeners.size === 0) {
      this.audio.volume = this.baseVolume;
      return;
    }

    // Find the closest listener for volume calculation
    let closestDistance = Infinity;
    let closestListener: THREE.Vector3 | null = null;
    
    for (const [_, listenerPos] of activeListeners) {
      const distance = this.sourcePosition.distanceTo(listenerPos);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestListener = listenerPos;
      }
    }
    
    // Safety check - this should never happen
    if (!closestListener) {
      this.audio.volume = this.baseVolume;
      return;
    }
    
    // Calculate distance-based volume reduction
    const volumeFactor = Math.max(0, 1 - (closestDistance / this.maxDistance));
    
    // Apply distance-based inverse square law attenuation (more realistic)
    this.audio.volume = this.baseVolume * volumeFactor * volumeFactor;
    
    // Apply Doppler effect if object is moving
    if (this.isPlaying && this.velocity.length() > 0.01) {
      // Calculate direction from closest listener to source
      const direction = new THREE.Vector3().subVectors(
        this.sourcePosition, 
        closestListener
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
    
    // Update the clone with all active listeners
    const activeListeners = SpatialAudio.getActiveListeners();
    for (const [listenerId, position] of activeListeners) {
      clone.setListenerPosition(position, listenerId);
    }
    
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
  // Tank components
  tank: THREE.Group;
  turretPivot: THREE.Group;
  barrelPivot: THREE.Group;
  
  // Core methods
  update(keys?: { [key: string]: boolean }, colliders?: ICollidable[]): Shell | null;
  dispose(): void;
  
  // Health and damage methods
  takeDamage(amount: number): boolean; // Returns true if tank is destroyed
  getHealth(): number; // Returns current health percentage (0-100)
  setHealth(health: number): void; // Set the tank's health directly
  respawn(position?: THREE.Vector3): void; // Respawn the tank
  
  // Barrel properties
  getMinBarrelElevation(): number; // Get minimum barrel elevation angle
  getMaxBarrelElevation(): number; // Get maximum barrel elevation angle
  
  // Movement properties
  isMoving(): boolean; // Returns whether the tank is currently moving
  getVelocity(): number; // Returns the current velocity of the tank
  
  // Sound and effects
  updateSoundPositions(): void; // Updates positions of all attached sound effects
  
  // Collision detection
  getDetailedColliders?(): {
    part: string;
    collider: THREE.Sphere;
    damageMultiplier: number;
  }[]; // Returns detailed colliders for precise hit detection
  
  // Tank ownership
  getOwnerId(): string | undefined; // Get the tank's owner ID
  setOwnerId(id: string): void; // Set the tank's owner ID
}

/**
 * BaseTank - Abstract base class that implements shared functionality
 * between player-controlled Tank and AI/remote controlled RemoteTank classes
 */
export abstract class BaseTank implements ITank {
  // Tank components
  tank: THREE.Group;
  tankBody?: THREE.Mesh;
  turret?: THREE.Mesh;
  turretPivot: THREE.Group;
  barrel?: THREE.Mesh;
  barrelPivot: THREE.Group;
  
  // Tank properties
  protected tankSpeed: number;
  protected tankRotationSpeed: number;
  protected turretRotationSpeed: number;
  protected barrelElevationSpeed: number;
  protected maxBarrelElevation: number = 0; // Horizontal is the highest position (no elevation)
  protected minBarrelElevation: number = -Math.PI / 4; // Allow negative elevation for distant targets
  protected tankName: string;
  protected tankColor: number;
  
  // Audio components
  protected moveSound: SpatialAudio | null = null;
  protected fireSound: SpatialAudio | null = null;
  protected explodeSound: SpatialAudio | null = null;
  protected lastMoveSoundState: boolean = false;
  
  // Track movement properties
  protected trackSegments: THREE.Mesh[] = [];
  protected wheels: THREE.Mesh[] = [];
  protected readonly TRACK_SEGMENT_COUNT: number = 8;
  protected trackRotationSpeed: number = 0;
  
  // Collision properties
  protected collider: THREE.Sphere;
  protected collisionRadius = 2.0;
  protected lastPosition = new THREE.Vector3();
  
  // Firing properties
  protected canFire = true;
  protected RELOAD_TIME: number;
  protected reloadCounter = 0;
  protected lastFireTime: number = 0;
  protected FIRE_COOLDOWN_MS: number;
  protected SHELL_SPEED: number;
  protected readonly BARREL_END_OFFSET = 1.5;
  
  // Health properties
  protected health: number = 100;
  protected readonly MAX_HEALTH: number = 100;
  protected isDestroyed: boolean = false;
  protected destroyedEffects: THREE.Object3D[] = [];
  
  // Movement tracking
  protected isCurrentlyMoving: boolean = false;
  protected velocity: number = 0;
  
  // Health bar display
  protected healthBarSprite: THREE.Sprite;
  protected healthBarContext: CanvasRenderingContext2D | null = null;
  protected healthBarTexture: THREE.CanvasTexture | null = null;
  
  // Tank owner ID
  protected ownerId?: string;
  
  // Reference to the scene
  protected scene: THREE.Scene;

  constructor(
    scene: THREE.Scene, 
    position: THREE.Vector3,
    color: number = 0x4a7c59,
    name: string = "Tank"
  ) {
    this.scene = scene;
    this.tankColor = color;
    this.tankName = name;
    
    // Initialize tank groups
    this.tank = new THREE.Group();
    this.turretPivot = new THREE.Group();
    this.barrelPivot = new THREE.Group();
    
    // Set initial position if provided
    if (position) {
      this.tank.position.copy(position);
    }
    
    // Initialize collision sphere
    this.collider = new THREE.Sphere(this.tank.position.clone(), this.collisionRadius);
    this.lastPosition = this.tank.position.clone();
    
    // Add to scene
    scene.add(this.tank);
  }
  
  // Abstract methods that must be implemented by derived classes
  abstract update(keys?: { [key: string]: boolean }, colliders?: ICollidable[]): Shell | null;
  
  //----------------------------------------------
  // Common methods for all tank types
  //----------------------------------------------
  
  // Tank creation methods (shared between Tank and RemoteTank)
  protected addArmorPlates(): void {
    // Front glacis plate
    const frontPlateGeometry = new THREE.BoxGeometry(1.9, 0.4, 0.2);
    const armorMaterial = new THREE.MeshStandardMaterial({
      color: this.tankColor || 0x4a7c59,
      roughness: 0.25,
      metalness: 0.85,
      envMapIntensity: 1.3
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
  
  protected createDetailedTracks(): void {
    // Track base
    const trackBaseGeometry = new THREE.BoxGeometry(0.4, 0.5, 3.2);
    const trackMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x1a1a1a,
      roughness: 0.6,
      metalness: 0.7,
      envMapIntensity: 0.8
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
    const treadsPerSide = this.TRACK_SEGMENT_COUNT;
    const treadSegmentGeometry = new THREE.BoxGeometry(0.5, 0.1, 0.32);
    const treadMaterial = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.6,
      metalness: 0.65,
      envMapIntensity: 0.7
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
    const wheelGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 18);
    const wheelMaterial = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.4,
      metalness: 0.8,
      envMapIntensity: 1.2
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
  
  protected createDetailedTurret(): void {
    // Get turret color (darker variant of tank color)
    const turretColor = this.getTurretColor();
    
    // Main turret body
    const turretGeometry = new THREE.CylinderGeometry(0.8, 0.8, 0.5, 24);
    const turretMaterial = new THREE.MeshStandardMaterial({ 
      color: turretColor,
      roughness: 0.2,
      metalness: 0.9,
      envMapIntensity: 1.4
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
    const mantletGeometry = new THREE.BoxGeometry(0.8, 0.6, 0.35);
    const mantletMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.2,
      metalness: 0.9,
      envMapIntensity: 1.5
    });
    
    const mantlet = new THREE.Mesh(mantletGeometry, mantletMaterial);
    mantlet.position.set(0, 0, 0.8);
    mantlet.castShadow = true;
    this.turretPivot.add(mantlet);
  }
  
  protected createDetailedBarrel(barrelGroup: THREE.Group): void {
    // Main barrel
    const barrelGeometry = new THREE.CylinderGeometry(0.2, 0.15, 2.2, 16);
    const barrelMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x222222,
      roughness: 0.1,
      metalness: 0.95,
      envMapIntensity: 1.6
    });
    
    this.barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
    
    // Rotate the cylinder to point forward
    this.barrel.rotation.x = Math.PI / 2;
    
    // Position the barrel so one end is at the pivot point
    this.barrel.position.set(0, 0, 1.1);
    
    this.barrel.castShadow = true;
    barrelGroup.add(this.barrel);
    
    // Add muzzle brake
    const muzzleBrakeGeometry = new THREE.CylinderGeometry(0.25, 0.25, 0.35, 16);
    const muzzleBrakeMaterial = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.15,
      metalness: 0.98,
      envMapIntensity: 1.8
    });
    
    const muzzleBrake = new THREE.Mesh(muzzleBrakeGeometry, muzzleBrakeMaterial);
    muzzleBrake.rotation.x = Math.PI / 2;
    muzzleBrake.position.set(0, 0, 2.2);
    barrelGroup.add(muzzleBrake);
    
    // Set initial barrel elevation to horizontal position
    barrelGroup.rotation.x = 0; // Perfectly horizontal (no depression)
  }
  
  protected getTurretColor(): number {
    // Make turret a darker shade of the tank color
    const color = new THREE.Color(this.tankColor);
    color.multiplyScalar(0.8);
    return color.getHex();
  }
  
  protected fireShell(): Shell {
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
  
  // Health bar methods
  // Add roundRect polyfill for older browsers that may not support it
  private ensureRoundRectMethod(ctx: CanvasRenderingContext2D): void {
    // Add roundRect polyfill if not available
    if (!ctx.roundRect) {
      // Define the method on the prototype
      CanvasRenderingContext2D.prototype.roundRect = function(
        x: number, y: number, w: number, h: number, r: number
      ) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        this.beginPath();
        this.moveTo(x + r, y);
        this.arcTo(x + w, y, x + w, y + h, r);
        this.arcTo(x + w, y + h, x, y + h, r);
        this.arcTo(x, y + h, x, y, r);
        this.arcTo(x, y, x + w, y, r);
        this.closePath();
        return this;
      };
    }
  }
  
  protected createHealthBar(): void {
    // Creating a canvas for the health bar and name tag
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64; // Increased height for better visual separation
    const context = canvas.getContext('2d');
    
    if (context) {
      // Add roundRect polyfill for browser compatibility
      this.ensureRoundRectMethod(context);
      // Clear the entire canvas
      context.clearRect(0, 0, 256, 64);
      
      // Draw name background with slight color tint based on tank color
      const tankColorObj = new THREE.Color(this.tankColor);
      context.fillStyle = `rgba(${Math.floor(tankColorObj.r * 50)}, ${Math.floor(tankColorObj.g * 50)}, ${Math.floor(tankColorObj.b * 50)}, 0.7)`;
      context.roundRect(32, 4, 192, 30, 6);
      context.fill();
      
      // Draw the tank name with better styling
      context.font = 'bold 18px Arial';
      context.textAlign = 'center';
      context.fillStyle = 'white';
      context.strokeStyle = 'rgba(0,0,0,0.8)';
      context.lineWidth = 3;
      context.strokeText(this.tankName, 128, 24);
      context.fillText(this.tankName, 128, 24);
      
      // Add an icon or badge based on tank type
      const isTankTypeRemote = this instanceof RemoteTank;
      const isTankTypeNPC = this instanceof NPCTank;
      
      if (isTankTypeRemote || isTankTypeNPC) {
        // Draw a small icon next to the name (badge)
        const badgeColor = isTankTypeNPC ? 'rgba(255,70,70,0.9)' : 'rgba(70,70,255,0.9)';
        context.fillStyle = badgeColor;
        context.beginPath();
        context.arc(208, 18, 8, 0, Math.PI * 2);
        context.fill();
        
        // Add a letter inside the badge
        context.font = 'bold 12px Arial';
        context.fillStyle = 'white';
        context.textAlign = 'center';
        context.fillText(isTankTypeNPC ? 'A' : 'P', 208, 22);
      }
      
      // Draw health bar container with 3D effect
      // Outer frame with shadow
      context.fillStyle = 'rgba(30,30,30,0.85)';
      context.roundRect(0, 36, 256, 26, 4);
      context.fill();
      
      // Inner frame
      context.fillStyle = 'rgba(50,50,50,0.9)';
      context.roundRect(2, 38, 252, 22, 3);
      context.fill();
      
      // Draw a pure black background for the health bar
      context.fillStyle = '#000000';
      context.roundRect(4, 40, 248, 18, 2);
      context.fill();
      
      // Calculate health percentage (force to 0-1 range)
      const healthPercent = Math.max(0, Math.min(1, this.health / this.MAX_HEALTH));
      
      // Accurately calculate colored health bar width
      const barWidth = Math.max(0, Math.floor(244 * healthPercent));
      
      // Only draw the colored bar if there's any health left
      if (barWidth > 0) {
        // Determine colors based on health percentage
        let startColor, endColor;
        if (healthPercent > 0.6) {
          startColor = '#32CD32'; // Lime green
          endColor = '#00FF00';   // Bright green
        } else if (healthPercent > 0.3) {
          startColor = '#FFD700'; // Gold
          endColor = '#FFA500';   // Orange
        } else {
          startColor = '#FF4500'; // Orange Red
          endColor = '#FF0000';   // Red
        }
        
        // Create gradient
        const gradient = context.createLinearGradient(4, 40, 4, 58);
        gradient.addColorStop(0, startColor);
        gradient.addColorStop(1, endColor);
        context.fillStyle = gradient;
        
        // Draw the colored health bar (will be shorter as health decreases)
        context.beginPath();
        context.roundRect(6, 42, barWidth, 14, 2);
        context.fill();
        
        // Add a white outline for better visibility
        context.strokeStyle = 'rgba(255,255,255,0.4)';
        context.lineWidth = 1;
        context.stroke();
      }
      
      // Add health percentage text
      context.font = 'bold 12px Arial';
      context.textAlign = 'center';
      context.fillStyle = 'white';
      context.strokeStyle = 'rgba(0,0,0,0.5)';
      context.lineWidth = 2;
      context.strokeText(`${Math.floor(healthPercent * 100)}%`, 128, 54);
      context.fillText(`${Math.floor(healthPercent * 100)}%`, 128, 54);
      
      // Create a texture from the canvas
      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter; // Better quality scaling
      
      // Store the canvas context for updating the health bar
      this.healthBarContext = context;
      this.healthBarTexture = texture;
      
      // Create a sprite material that uses the canvas texture
      const spriteMaterial = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false // Always render on top
      });
      
      // Create a sprite that will always face the camera
      const sprite = new THREE.Sprite(spriteMaterial);
      
      // Position the sprite above the tank at consistent height
      sprite.position.set(0, 3.7, 0);
      
      // Scale the sprite to an appropriate size
      sprite.scale.set(4.0, 2.0, 1.0);
      
      // Add the sprite to the tank
      this.tank.add(sprite);
      
      // Store the sprite for later reference
      this.healthBarSprite = sprite;
    }
    
    // Update health bar initially
    this.updateHealthBar();
  }
  
  protected updateHealthBar(): void {
    if (!this.healthBarContext || !this.healthBarTexture) return;
    
    // Ensure roundRect is available
    this.ensureRoundRectMethod(this.healthBarContext);
    
    // Calculate health percentage (force to 0-1 range)
    const healthPercent = Math.max(0, Math.min(1, this.health / this.MAX_HEALTH));
    
    // Clear only the health bar portion (not the name)
    this.healthBarContext.clearRect(0, 36, 256, 26);
    
    // Draw health bar container with 3D effect
    // Outer frame with shadow
    this.healthBarContext.fillStyle = 'rgba(30,30,30,0.85)';
    this.healthBarContext.roundRect(0, 36, 256, 26, 4);
    this.healthBarContext.fill();
    
    // Inner frame
    this.healthBarContext.fillStyle = 'rgba(50,50,50,0.9)';
    this.healthBarContext.roundRect(2, 38, 252, 22, 3);
    this.healthBarContext.fill();
    
    // Draw a pure black background for the health bar
    this.healthBarContext.fillStyle = '#000000';
    this.healthBarContext.roundRect(4, 40, 248, 18, 2);
    this.healthBarContext.fill();
    
    // Accurately calculate colored health bar width
    const barWidth = Math.max(0, Math.floor(244 * healthPercent));
    
    // Only draw the colored bar if there's any health left
    if (barWidth > 0) {
      // Determine colors based on health percentage
      let startColor, endColor;
      if (healthPercent > 0.6) {
        startColor = '#32CD32'; // Lime green
        endColor = '#00FF00';   // Bright green
      } else if (healthPercent > 0.3) {
        startColor = '#FFD700'; // Gold
        endColor = '#FFA500';   // Orange
      } else {
        startColor = '#FF4500'; // Orange Red
        endColor = '#FF0000';   // Red
      }
      
      // Create gradient
      const gradient = this.healthBarContext.createLinearGradient(4, 40, 4, 58);
      gradient.addColorStop(0, startColor);
      gradient.addColorStop(1, endColor);
      this.healthBarContext.fillStyle = gradient;
      
      // Draw the colored health bar (will be shorter as health decreases)
      this.healthBarContext.beginPath();
      this.healthBarContext.roundRect(6, 42, barWidth, 14, 2);
      this.healthBarContext.fill();
      
      // Add a white outline for better visibility
      this.healthBarContext.strokeStyle = 'rgba(255,255,255,0.4)';
      this.healthBarContext.lineWidth = 1;
      this.healthBarContext.stroke();
    }
    
    // Force texture update to ensure changes are displayed
    this.healthBarTexture.needsUpdate = true;
    
    // Add health percentage text
    this.healthBarContext.font = 'bold 12px Arial';
    this.healthBarContext.textAlign = 'center';
    this.healthBarContext.fillStyle = 'white';
    this.healthBarContext.strokeStyle = 'rgba(0,0,0,0.5)';
    this.healthBarContext.lineWidth = 2;
    this.healthBarContext.strokeText(`${Math.floor(healthPercent * 100)}%`, 128, 54);
    this.healthBarContext.fillText(`${Math.floor(healthPercent * 100)}%`, 128, 54);
    
    // Update the texture
    this.healthBarTexture.needsUpdate = true;
  }
  
  // Collision detection methods
  protected checkCollision(other: ICollidable): boolean {
    // Skip collision detection if this tank is destroyed
    if (this.isDestroyed) {
      return false;
    }
    
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

  // Destruction effects
  protected createDestroyedEffect(): void {
    // Hide the tank
    this.tank.visible = false;
    
    // Hide health bar sprite
    if (this.healthBarSprite) {
      this.healthBarSprite.visible = false;
    }
    
    // Add initial explosion flash
    this.createExplosionFlash();
    
    // Create debris particles
    this.createDebrisParticles();
    
    // Create smoke effect
    this.createSmokeEffect();
    
    // Create fire effect
    this.createFireEffect();
    
    // Create shockwave effect
    this.createShockwaveEffect();
    
    // Create sparks effect
    this.createSparksEffect();
    
    // Play explosion sound
    if (this.explodeSound) {
      this.explodeSound.setSourcePosition(this.tank.position);
      this.explodeSound.cloneAndPlay();
    }
    
    // Stop movement sound if it was playing
    if (this.lastMoveSoundState && this.moveSound) {
      this.moveSound.stop();
      this.lastMoveSoundState = false;
    }
  }
  
  // Interface implementations
  dispose(): void {
    // Clean up resources
    this.scene.remove(this.tank);
    
    // Clean up any destroyed effects
    for (const effect of this.destroyedEffects) {
      this.scene.remove(effect);
    }
    this.destroyedEffects = [];
  }
  
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
  
  setHealth(health: number): void {
    if (this.isDestroyed) return;
    
    // Set health value
    this.health = Math.max(0, Math.min(this.MAX_HEALTH, health));
    
    // Update health bar
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
  
  respawn(position?: THREE.Vector3): void {
    // Reset health
    this.health = this.MAX_HEALTH;
    this.isDestroyed = false;
    
    // Reset position if provided
    if (position) {
      this.tank.position.copy(position);
    }
    
    // Make tank visible again
    this.tank.visible = true;
    
    // Make health bar sprite visible again
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
    
    // Update health bar
    this.updateHealthBar();
    
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
  
  // ICollidable implementation
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
    // Skip collision handling if tank is destroyed
    if (this.isDestroyed) {
      return;
    }
    
    if (other.getType() === 'shell') {
      // For shell collisions, handled by the shell's onCollision method
      return;
    }
    
    // For other collisions (tank-tank, tank-environment)
    // Move back to last position
    this.tank.position.copy(this.lastPosition);
    this.collider.center.copy(this.lastPosition);
  }
  
  // Movement status
  isMoving(): boolean {
    return this.isCurrentlyMoving;
  }
  
  getVelocity(): number {
    return this.velocity;
  }
  
  // Barrel elevation
  getMinBarrelElevation(): number {
    return this.minBarrelElevation;
  }
  
  getMaxBarrelElevation(): number {
    return this.maxBarrelElevation;
  }
  
  // Sound position updates
  updateSoundPositions(): void {
    const position = this.tank.position;
    if (this.moveSound) this.moveSound.setSourcePosition(position);
    if (this.fireSound) this.fireSound.setSourcePosition(position);
    if (this.explodeSound) this.explodeSound.setSourcePosition(position);
  }
  
  /**
   * Creates a floating marker triangle above a tank
   * This is used for both RemoteTank and NPCTank to visually identify them
   * @param customColor Optional custom color for the marker
   */
  public addFloatingIdentifierMarker(customColor?: number): void {
    // This method has been modified to do nothing, removing floating triangles 
    // from NPC and Remote tanks as requested.
    
    // The implementation below is empty to keep the method available in case
    // other code calls it, but it won't create any visible markers.
  }
  
  // Tank owner ID
  getOwnerId(): string | undefined {
    return this.ownerId;
  }
  
  setOwnerId(id: string): void {
    this.ownerId = id;
  }
  
  // Destruction effect methods
  protected createExplosionFlash(): void {
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
  
  protected createDebrisParticles(): void {
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
  
  protected createSmokeEffect(): void {
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
  
  protected createFireEffect(): void {
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
  
  protected createShockwaveEffect(): void {
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
  
  protected createSparksEffect(): void {
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
  
  // Create a complete tank model by combining all the component methods
  protected createTank(): void {
    // Tank body - more detailed with beveled edges
    const bodyGeometry = new THREE.BoxGeometry(2, 0.75, 3, 1, 1, 2);
    const bodyMaterial = new THREE.MeshStandardMaterial({ 
      color: this.tankColor || 0x4a7c59,
      roughness: 0.3,
      metalness: 0.8,
      envMapIntensity: 1.2
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
    this.turretPivot.position.set(0, 1.0, 0);
    this.tank.add(this.turretPivot);
    
    // Turret base - more detailed with hatches and details
    this.createDetailedTurret();
    
    // Create a group for the barrel - this will handle the elevation
    const barrelGroup = new THREE.Group();
    
    // Position the pivot point at the front edge of the turret (not the center)
    barrelGroup.position.set(0, 0, 0.8);
    this.turretPivot.add(barrelGroup);
    
    // Create a more detailed barrel with muzzle brake
    this.createDetailedBarrel(barrelGroup);
    
    // Store reference to the barrelGroup for elevation control
    this.barrelPivot = barrelGroup;
    
    // Set initial barrel elevation to exactly horizontal (0 degrees)
    this.barrelPivot.rotation.x = 0;
  }
}

export class Tank extends BaseTank {
  // Camera for player-controlled tank
  private camera?: THREE.PerspectiveCamera;
  
  // Compound collision system for more precise hit detection
  private compoundColliders: {
    part: string;
    collider: THREE.Sphere;
    damageMultiplier: number;
  }[] = [];

  constructor(scene: THREE.Scene, camera?: THREE.PerspectiveCamera, name: string = "Player") {
    // Initialize with base class constructor
    super(scene, new THREE.Vector3(0, 0, 0), 0x4a7c59, name);
    this.camera = camera;
    
    // Override values from base class with player-specific settings
    this.tankSpeed = 2.5;                 // Increased 5x from original for extreme speed
    this.tankRotationSpeed = 0.04;        // Reduced by 50% for more controlled turning
    this.turretRotationSpeed = 0.1;       // Increased for faster aiming
    this.barrelElevationSpeed = 0.08;     // Increased for quicker elevation changes
    this.RELOAD_TIME = 30;                // Half-second cooldown at 60fps
    this.FIRE_COOLDOWN_MS = 500;          // Half-second cooldown in milliseconds
    this.SHELL_SPEED = 10.0;              // Increased for extreme range
    
    // Create tank model
    this.createTank();
    
    // Initialize compound colliders for more precise hit detection
    this.initializeCompoundColliders();
    
    // Initialize sound effects with higher volume for player
    this.moveSound = new SpatialAudio('/static/js/assets/sounds/tank-move.mp3', true, 0.4, 120);
    this.fireSound = new SpatialAudio('/static/js/assets/sounds/tank-fire.mp3', false, 0.39375, 150);
    this.explodeSound = new SpatialAudio('/static/js/assets/sounds/tank-explode.mp3', false, 0.8, 200);
    
    // Initialize sound positions
    this.updateSoundPositions();
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
      wheel.rotation.x += this.trackRotationSpeed * 2; // Wheels turn faster than track movement
    });
  }
  
  private createDetailedTurret(): void {
    // Main turret body - slightly more complex shape
    const turretGeometry = new THREE.CylinderGeometry(0.8, 0.8, 0.5, 24); // Increased segments for smoother appearance
    
    // Calculate darker tank color for turret
    const turretColor = this.tankColor ? new THREE.Color(this.tankColor).multiplyScalar(0.85).getHex() : 0x3f5e49;
    
    const turretMaterial = new THREE.MeshStandardMaterial({ 
      color: turretColor,
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
      metalness: 0.4,
      envMapIntensity: 1.0
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
  
  // New input intensity properties for analog control from touch joysticks
  private inputIntensities: {[key: string]: number} = {
    'forward': 0,
    'backward': 0,
    'left': 0,
    'right': 0
  };
  
  // Method to set input intensity for analog control (called from joystick handlers)
  public setInputIntensity(direction: 'forward' | 'backward' | 'left' | 'right', intensity: number): void {
    this.inputIntensities[direction] = Math.max(0, Math.min(1, intensity));
  }
  
  // Method to handle physics-based movement
  private updateMovementWithPhysics(keys: {[key: string]: boolean}) {
    // Reset velocity variables
    this.velocity = 0;
    
    // Determine target acceleration based on inputs - now considers both key presses and analog intensity
    let forwardInput = keys['w'] || keys['W'] ? 1 : this.inputIntensities['forward'];
    let backwardInput = keys['s'] || keys['S'] ? 1 : this.inputIntensities['backward'];
    
    // Digital input overrides analog
    const targetAcceleration = forwardInput > 0 ? 
                              this.maxAcceleration * forwardInput : 
                              backwardInput > 0 ? 
                              -this.maxAcceleration * backwardInput : 0;
    
    // Gradually change acceleration (smoother feel)
    this.acceleration = this.acceleration * 0.9 + targetAcceleration * 0.1;
    
    // Apply velocity changes based on acceleration
    this.velocity += this.acceleration;
    
    // Apply friction/drag when no input
    if (forwardInput < 0.05 && backwardInput < 0.05) {
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
    
    // Tank rotation with inertia - combine keyboard and analog inputs
    let leftInput = keys['a'] || keys['A'] ? 1 : this.inputIntensities['left'];
    let rightInput = keys['d'] || keys['D'] ? 1 : this.inputIntensities['right'];
    
    // Apply left rotation with variable intensity
    if (leftInput > 0.05) {
      const rotationModifier = 1.0 - Math.abs(this.velocity) * 0.5; // Slower rotation at high speed
      this.tank.rotation.y += this.tankRotationSpeed * leftInput * rotationModifier;
      this.isCurrentlyMoving = true;
    }
    
    // Apply right rotation with variable intensity
    if (rightInput > 0.05) {
      const rotationModifier = 1.0 - Math.abs(this.velocity) * 0.5; // Slower rotation at high speed
      this.tank.rotation.y -= this.tankRotationSpeed * rightInput * rotationModifier;
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
    
    // Update compound colliders to match tank's current position and rotation
    this.updateCompoundColliders();
    
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
      if (!this.lastMoveSoundState && this.moveSound) {
        this.moveSound.play();
        this.lastMoveSoundState = true;
      }
      // Update engine sound pitch based on RPM
      if (this.moveSound) {
        this.moveSound.setPlaybackRate(0.8 + this.engineRPM * 0.7);
      }
    } else if (this.lastMoveSoundState && this.moveSound) {
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
      // Move barrel up (increasing rotation.x value toward 0/horizontal)
      this.barrelPivot.rotation.x = Math.min(
        this.maxBarrelElevation,  // 0 is horizontal (max elevation)
        this.barrelPivot.rotation.x + this.barrelElevationSpeed
      );
    }
    
    if (keys['arrowdown'] || keys['ArrowDown']) {
      // Move barrel down (decreasing rotation.x value below 0/horizontal)
      this.barrelPivot.rotation.x = Math.max(
        this.minBarrelElevation,  // -Math.PI/4 is max depression
        this.barrelPivot.rotation.x - this.barrelElevationSpeed
      );
    }
    
    
    // Update collider position
    this.collider.center.copy(this.tank.position);
    
    // Update visual collider position if it exists
    if (this.colliderVisual) {
      this.colliderVisual.position.copy(this.tank.position);
    }
    
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
      if (this.fireSound) {
        this.fireSound.setSourcePosition(this.tank.position);
        this.fireSound.cloneAndPlay();
      }
      
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
    // Still return the main collider for broad-phase detection
    return this.collider;
  }
  
  // New method to get all detailed colliders for precise hit detection
  getDetailedColliders() {
    return this.compoundColliders;
  }
  
  getPosition(): THREE.Vector3 {
    return this.tank.position.clone();
  }
  
  getType(): string {
    return 'tank';
  }
  
  onCollision(other: ICollidable): void {
    if (other.getType() === 'shell') {
      // For shell collisions, we'll check precise hit detection in Shell.ts
      // This is handled by the shell's onCollision method
      return;
    }
    
    // For other collisions (tank-tank, tank-environment)
    // Move back to last position
    this.tank.position.copy(this.lastPosition);
    this.collider.center.copy(this.lastPosition);
    
    // Update compound colliders
    this.updateCompoundColliders();
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
  
  // Initialize compound colliders for more precise hit detection
  private initializeCompoundColliders(): void {
    // Clear any existing compound colliders
    this.compoundColliders = [];
    
    // Body collider - slightly smaller than the main collider
    this.compoundColliders.push({
      part: 'body',
      collider: new THREE.Sphere(this.tank.position.clone(), 1.4),
      damageMultiplier: 1.0 // Normal damage
    });
    
    // Turret collider - positioned above the body
    const turretPosition = this.tank.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    this.compoundColliders.push({
      part: 'turret',
      collider: new THREE.Sphere(turretPosition, 0.9),
      damageMultiplier: 1.2 // More damage to the turret
    });
    
    // Barrel collider - positioned in front of the turret
    const barrelPosition = this.tank.position.clone().add(new THREE.Vector3(0, 1.0, 1.0));
    this.compoundColliders.push({
      part: 'barrel',
      collider: new THREE.Sphere(barrelPosition, 0.4),
      damageMultiplier: 0.8 // Less damage to the barrel
    });
    
    // Tracks colliders - positioned on both sides of the tank
    const leftTrackPosition = this.tank.position.clone().add(new THREE.Vector3(-1.0, 0.5, 0));
    this.compoundColliders.push({
      part: 'leftTrack',
      collider: new THREE.Sphere(leftTrackPosition, 0.6),
      damageMultiplier: 1.5 // More damage to the tracks for mobility hits
    });
    
    const rightTrackPosition = this.tank.position.clone().add(new THREE.Vector3(1.0, 0.5, 0));
    this.compoundColliders.push({
      part: 'rightTrack',
      collider: new THREE.Sphere(rightTrackPosition, 0.6),
      damageMultiplier: 1.5 // More damage to the tracks
    });
    
    // Rear collider - positioned behind the tank
    const rearPosition = this.tank.position.clone().add(new THREE.Vector3(0, 0.8, -1.5));
    this.compoundColliders.push({
      part: 'rear',
      collider: new THREE.Sphere(rearPosition, 0.8),
      damageMultiplier: 1.8 // Critical hit from behind
    });
    
  }
  
  // Update compound colliders to match the tank's current position and rotation
  private updateCompoundColliders(): void {
    // Make sure we have compound colliders initialized
    if (this.compoundColliders.length === 0) {
      this.initializeCompoundColliders();
      return;
    }
    
    // Get current rotation of tank and turret
    const tankRotation = this.tank.rotation.y;
    const turretRotation = this.turretPivot.rotation.y + tankRotation; // Combined rotation
    
    // Update each compound collider
    for (const collider of this.compoundColliders) {
      switch (collider.part) {
        case 'body':
          // Body stays centered on the tank
          collider.collider.center.copy(this.tank.position);
          break;
        
        case 'turret':
          // Turret rotates with the turret pivot
          // Calculate offset based on turret rotation
          const turretOffset = new THREE.Vector3(0, 1.2, 0);
          // No need to rotate vertical offset
          collider.collider.center.copy(this.tank.position).add(turretOffset);
          break;
        
        case 'barrel':
          // Barrel follows turret rotation
          const barrelOffset = new THREE.Vector3(0, 1.0, 1.0);
          barrelOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), turretRotation);
          collider.collider.center.copy(this.tank.position).add(barrelOffset);
          break;
          
        case 'leftTrack':
          // Left track follows tank rotation
          const leftTrackOffset = new THREE.Vector3(-1.0, 0.5, 0);
          leftTrackOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), tankRotation);
          collider.collider.center.copy(this.tank.position).add(leftTrackOffset);
          break;
          
        case 'rightTrack':
          // Right track follows tank rotation
          const rightTrackOffset = new THREE.Vector3(1.0, 0.5, 0);
          rightTrackOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), tankRotation);
          collider.collider.center.copy(this.tank.position).add(rightTrackOffset);
          break;
          
        case 'rear':
          // Rear follows tank rotation
          const rearOffset = new THREE.Vector3(0, 0.8, -1.5);
          rearOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), tankRotation);
          collider.collider.center.copy(this.tank.position).add(rearOffset);
          break;
      }
    }
  }

  updateCamera(camera: THREE.PerspectiveCamera) {
    // Camera follows tank and turret direction with lower height for proper perspective
    const cameraOffset = new THREE.Vector3(0, 2.5, -8);
    
    // Calculate the combined rotation of tank body and turret
    const combinedAngle = this.tank.rotation.y + this.turretPivot.rotation.y;
    
    // Rotate the offset based on the combined rotation
    const rotatedOffset = cameraOffset.clone();
    rotatedOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), combinedAngle);
    
    // Apply the offset to the tank's position
    camera.position.copy(this.tank.position).add(rotatedOffset);
    
    // Calculate a look target that considers both tank position and turret direction
    const lookDirection = new THREE.Vector3(0, 0, 10);
    lookDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), combinedAngle);
    
    // Set the target position with consistent height adjustment (lower than before)
    const targetPosition = this.tank.position.clone().add(lookDirection).add(new THREE.Vector3(0, 1, 0));
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
      
      // Position the sprite above the tank at a consistent height
      sprite.position.set(0, 3.2, 0); // Standardized height for all tanks
      
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
      if (this.explodeSound) {
        this.explodeSound.setSourcePosition(this.tank.position);
        this.explodeSound.cloneAndPlay();
      }
      
      // Stop movement sound if it was playing
      if (this.lastMoveSoundState && this.moveSound) {
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
  updateSoundPositions(): void {
    const position = this.tank.position;
    if (this.moveSound) this.moveSound.setSourcePosition(position);
    if (this.fireSound) this.fireSound.setSourcePosition(position);
    if (this.explodeSound) this.explodeSound.setSourcePosition(position);
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

export class RemoteTank extends BaseTank {
  // Remote tank properties
  protected movementPattern: 'circle' | 'zigzag' | 'random' | 'patrol';
  protected movementTimer = 0;
  protected changeDirectionInterval: number;
  protected currentDirection = 0; // Angle in radians
  protected targetPosition = new THREE.Vector3();
  protected patrolPoints: THREE.Vector3[] = [];
  protected currentPatrolIndex = 0;
  protected collisionResetTimer = 0;
  protected readonly COLLISION_RESET_DELAY = 60; // Frames to wait after collision before trying new direction
  
  // Targeting properties
  protected readonly FIRE_PROBABILITY = 0.03; // 3% chance to fire each frame when canFire is true
  protected readonly TARGETING_DISTANCE = 500; // Distance at which the remote tank starts targeting the player

  constructor(scene: THREE.Scene, position: THREE.Vector3, color = 0xff0000, name?: string) {
    // Generate a random name if none provided
    const tankName = name || generateRandomTankName();
    
    // Initialize with base class constructor
    super(scene, position, color, tankName);
    
    // Override values from base class with more aggressive NPC-specific settings
    this.tankSpeed = 0.2;              // Faster movement
    this.tankRotationSpeed = 0.04;     // Faster rotation
    this.turretRotationSpeed = 0.03;   // Faster turret rotation
    this.barrelElevationSpeed = 0.02;  // Faster barrel adjustment
    this.RELOAD_TIME = 120;            // 2 second cooldown at 60fps - quicker reloading
    this.FIRE_COOLDOWN_MS = 2000;      // 2 second cooldown in milliseconds
    this.SHELL_SPEED = 5.5;            // Faster shells
    
    // Create tank model
    this.createTank();
    
    // Pick a random movement pattern
    const patterns: ('circle' | 'zigzag' | 'random' | 'patrol')[] = ['circle', 'zigzag', 'random', 'patrol'];
    this.movementPattern = patterns[Math.floor(Math.random() * patterns.length)];
    
    // Set random change direction interval (between 2-5 seconds at 60fps)
    this.changeDirectionInterval = Math.floor(Math.random() * 180) + 120;
    
    // If patrol pattern, set up patrol points
    if (this.movementPattern === 'patrol') {
      this.setupPatrolPoints();
    }
    
    // Initialize sound effects at lower volume than player tank
    try {
      this.moveSound = new SpatialAudio('/static/js/assets/sounds/tank-move.mp3', true, 0.3, 120);
      this.fireSound = new SpatialAudio('/static/js/assets/sounds/tank-fire.mp3', false, 0.28125, 150);
      this.explodeSound = new SpatialAudio('/static/js/assets/sounds/tank-explode.mp3', false, 0.6, 200);
      
      // Initialize sound positions
      this.updateSoundPositions();
    } catch (error) {
      console.error('Error initializing sounds for remote tank:', error);
      // Continue with tank creation even if sounds fail
    }
    
    // Create health bar with tank name
    this.createHealthBar();
  }
  
  // Health bar rendering is now consolidated in the BaseTank class

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
  
  private createDetailedTurret(): void {
    // Main turret body - slightly more complex shape
    const turretGeometry = new THREE.CylinderGeometry(0.8, 0.8, 0.5, 24); // Increased segments for smoother appearance
    
    // Get darker tank color for turret
    const turretColor = this.getTurretColor();
    
    const turretMaterial = new THREE.MeshStandardMaterial({ 
      color: turretColor,
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

  private getTurretColor(): number {
    // Make turret a darker shade of the tank color
    const color = new THREE.Color(this.tankColor);
    color.multiplyScalar(0.8);
    return color.getHex();
  }

  private setupPatrolPoints() {
    // Create a patrol path with 4-8 points around the tank's starting position
    const pointCount = Math.floor(Math.random() * 5) + 4;
    const baseRadius = Math.random() * 100 + 80; // 80-180 units radius
    
    for (let i = 0; i < pointCount; i++) {
      const angle = (i / pointCount) * Math.PI * 2;
      
      // Vary each point's radius to create more interesting paths
      const pointRadius = baseRadius * (0.7 + Math.random() * 0.6);
      
      // Create patrol point
      const x = this.tank.position.x + Math.cos(angle) * pointRadius;
      const z = this.tank.position.z + Math.sin(angle) * pointRadius;
      this.patrolPoints.push(new THREE.Vector3(x, 0, z));
    }
    
    // Add some intermediate points for more complex paths
    if (Math.random() < 0.5 && this.patrolPoints.length > 3) {
      // Create a couple of extra points between existing ones
      const extraPoints: THREE.Vector3[] = [];
      
      for (let i = 0; i < 2; i++) {
        const idx1 = Math.floor(Math.random() * this.patrolPoints.length);
        const idx2 = (idx1 + 1) % this.patrolPoints.length;
        
        // Create a point between two existing points with some offset
        const p1 = this.patrolPoints[idx1];
        const p2 = this.patrolPoints[idx2];
        
        const midX = (p1.x + p2.x) / 2 + (Math.random() - 0.5) * 30;
        const midZ = (p1.z + p2.z) / 2 + (Math.random() - 0.5) * 30;
        
        extraPoints.push(new THREE.Vector3(midX, 0, midZ));
      }
      
      // Add the extra points to the path
      this.patrolPoints = this.patrolPoints.concat(extraPoints);
    }
    
    // Randomize start point
    this.currentPatrolIndex = Math.floor(Math.random() * this.patrolPoints.length);
    
    // Set initial target
    this.targetPosition.copy(this.patrolPoints[this.currentPatrolIndex]);
  }

  update(keys?: { [key: string]: boolean }, colliders?: ICollidable[]): Shell | null {
    this.movementTimer++;
    
    // If tank is destroyed, don't process movement or firing
    if (this.isDestroyed) {
      return null;
    }
    
    // Store the current position before movement
    this.lastPosition.copy(this.tank.position);
    
    // Update compound colliders to match tank's current position and rotation
    this.updateCompoundColliders();
    
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
        
        // Find the player tank (assumption: only one tank that's not a RemoteTank)
        if (!(collider instanceof RemoteTank)) {
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
    
    // Add small random offsets for imperfect aiming (more realistic)
    const aimVariation = 0.05; // Lower = more accurate
    direction.x += (Math.random() - 0.5) * aimVariation * direction.length();
    direction.z += (Math.random() - 0.5) * aimVariation * direction.length();
    
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
    
    // Apply rotation with speed limit and smoother movement
    const rotationAmount = Math.sign(normalizedDifference) * 
                          Math.min(Math.abs(normalizedDifference), this.turretRotationSpeed);
    this.turretPivot.rotation.y += rotationAmount;
    
    // Calculate barrel elevation
    // Get horizontal distance to target
    const horizontalDistance = new THREE.Vector2(direction.x, direction.z).length();
    // Target height difference
    const heightDifference = targetPosition.y - this.tank.position.y;
    
    // Calculate elevation angle needed (allowing only depression or horizontal)
    // Use negative of atan2 because of how the barrel coordinate system works
    let targetElevation = Math.min(0, -Math.atan2(heightDifference, horizontalDistance));
    
    // Add slight random variation to elevation for imperfect aiming
    targetElevation += (Math.random() - 0.5) * 0.04;
    
    // Clamp to min/max elevation
    targetElevation = Math.max(this.minBarrelElevation, 
                             Math.min(this.maxBarrelElevation, targetElevation));
    
    // Smooth barrel movement with variable speed based on distance to target angle
    const elevationDifference = targetElevation - this.barrelPivot.rotation.x;
    
    // Faster movement when far from target angle, slower when close (smoother aiming)
    const elevationSpeedFactor = Math.min(1, 0.3 + Math.abs(elevationDifference) * 2);
    const elevationAmount = Math.sign(elevationDifference) * 
                           Math.min(Math.abs(elevationDifference), 
                                   this.barrelElevationSpeed * elevationSpeedFactor);
    
    this.barrelPivot.rotation.x += elevationAmount;
    
    // Add slight random wobble to aiming for more realistic effect
    this.turretPivot.rotation.y += (Math.random() - 0.5) * 0.002;
    this.barrelPivot.rotation.x += (Math.random() - 0.5) * 0.001;
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
    // Move in a circular pattern with varying radius
    this.currentDirection += 0.008; // Faster circular movement
    
    // Add some variation to the movement with sine wave
    const speedVariation = 1.0 + Math.sin(this.movementTimer * 0.02) * 0.3;
    
    // Apply movement with variation
    this.tank.position.x += Math.cos(this.currentDirection) * this.tankSpeed * speedVariation;
    this.tank.position.z += Math.sin(this.currentDirection) * this.tankSpeed * speedVariation;
    
    // Rotate tank to face movement direction
    this.tank.rotation.y = this.currentDirection + Math.PI / 2;
    
    // Update movement status
    this.isCurrentlyMoving = true;
    this.velocity = this.tankSpeed * speedVariation;
  }

  private moveInZigzag() {
    // Change direction at intervals but with some randomness
    if (this.movementTimer % this.changeDirectionInterval === 0 || Math.random() < 0.005) {
      this.currentDirection = Math.random() * Math.PI * 2;
    }
    
    // Apply zigzag by adding sine wave to movement with more pronounced effect
    const zigzagFactor = Math.sin(this.movementTimer * 0.15) * 0.7;
    
    // Calculate forward and side direction vectors
    const forwardX = Math.cos(this.currentDirection);
    const forwardZ = Math.sin(this.currentDirection);
    const sideX = Math.cos(this.currentDirection + Math.PI / 2);
    const sideZ = Math.sin(this.currentDirection + Math.PI / 2);
    
    // Speed varies over time for more natural movement
    const speedVariation = 1.0 + Math.sin(this.movementTimer * 0.03) * 0.2;
    
    // Apply movement with zigzag
    this.tank.position.x += (forwardX + sideX * zigzagFactor) * this.tankSpeed * speedVariation;
    this.tank.position.z += (forwardZ + sideZ * zigzagFactor) * this.tankSpeed * speedVariation;
    
    // Rotate tank to face movement direction more responsively
    const targetRotation = Math.atan2(forwardZ + sideZ * zigzagFactor, forwardX + sideX * zigzagFactor) + Math.PI / 2;
    this.tank.rotation.y += (targetRotation - this.tank.rotation.y) * 0.2; // Faster turning
    
    // Update movement status
    this.isCurrentlyMoving = true;
    this.velocity = this.tankSpeed * speedVariation;
  }

  private moveRandomly() {
    // Change direction at random intervals with occasional spontaneous changes
    if (this.movementTimer % this.changeDirectionInterval === 0 || Math.random() < 0.01) {
      this.currentDirection = Math.random() * Math.PI * 2;
      
      // Sometimes perform a quick burst of speed after changing direction
      if (Math.random() < 0.3) {
        this.tankSpeed *= 1.5; // Temporary speed boost
        
        // Reset speed after a short delay (20 frames)
        setTimeout(() => {
          this.tankSpeed = 0.2; // Reset to base speed
        }, 333); // ~20 frames at 60fps
      }
    }
    
    // Add some slight steering randomness
    this.currentDirection += (Math.random() - 0.5) * 0.05;
    
    // Speed varies based on a sine wave and random factor
    const speedVariation = 1.0 + Math.sin(this.movementTimer * 0.02) * 0.15 + Math.random() * 0.1;
    
    // Apply movement
    this.tank.position.x += Math.cos(this.currentDirection) * this.tankSpeed * speedVariation;
    this.tank.position.z += Math.sin(this.currentDirection) * this.tankSpeed * speedVariation;
    
    // Rotate tank to face movement direction with more responsive turning
    const targetRotation = this.currentDirection + Math.PI / 2;
    this.tank.rotation.y += (targetRotation - this.tank.rotation.y) * 0.15;
    
    // Update movement status
    this.isCurrentlyMoving = true;
    this.velocity = this.tankSpeed * speedVariation;
  }

  private moveInPatrol() {
    if (this.patrolPoints.length === 0) return;
    
    // Get current target patrol point
    const targetPoint = this.patrolPoints[this.currentPatrolIndex];
    const direction = new THREE.Vector2(
      targetPoint.x - this.tank.position.x,
      targetPoint.z - this.tank.position.z
    );
    
    // Check if we've reached the target (within 5 units)
    if (direction.length() < 5) {
      // Move to next patrol point
      this.currentPatrolIndex = (this.currentPatrolIndex + 1) % this.patrolPoints.length;
      
      // Occasionally pause at patrol points
      if (Math.random() < 0.3) {
        this.collisionResetTimer = 30; // Stop for a moment
        
        // Turn turret randomly while stopped
        this.turretPivot.rotation.y += (Math.random() - 0.5) * 0.5;
      }
      return;
    }
    
    // Normalize direction
    direction.normalize();
    
    // Add some slight variability to patrol path
    const variationX = Math.sin(this.movementTimer * 0.05) * 0.2;
    const variationZ = Math.cos(this.movementTimer * 0.04) * 0.2;
    
    // Speed varies slightly for more natural movement
    const speedVariation = 1.0 + Math.sin(this.movementTimer * 0.03) * 0.15;
    
    // Apply movement with variation
    this.tank.position.x += (direction.x + variationX) * this.tankSpeed * speedVariation;
    this.tank.position.z += (direction.y + variationZ) * this.tankSpeed * speedVariation;
    
    // Rotate tank to face movement direction with smoother turning
    const targetRotation = Math.atan2(direction.y, direction.x) + Math.PI / 2;
    this.tank.rotation.y += (targetRotation - this.tank.rotation.y) * 0.15;
    
    // Update movement status
    this.isCurrentlyMoving = true;
    this.velocity = this.tankSpeed * speedVariation;
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
      if (this.explodeSound) {
        this.explodeSound.setSourcePosition(this.tank.position);
        this.explodeSound.cloneAndPlay();
      }
      
      // Stop movement sound if it was playing
      if (this.lastMoveSoundState && this.moveSound) {
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

/**
 * NPCTank - AI controlled tank that moves autonomously
 * Extends RemoteTank to inherit remote tank functionality but adds AI behavior
 */
export class NPCTank extends RemoteTank {
  // AI-specific behavior properties
  private readonly AI_AGGRESSION: number = 0.6; // 0-1 scale of how aggressive the AI is
  private readonly AI_MOVEMENT_CHANGE_CHANCE: number = 0.005; // Chance to change movement pattern
  private readonly AI_TARGETING_ACCURACY: number = 0.8; // 0-1 scale of aiming accuracy
  
  constructor(scene: THREE.Scene, position: THREE.Vector3, color = 0xff0000, name?: string) {
    // Call parent constructor
    super(scene, position, color, name);
    
    // Override with more aggressive settings for NPCs
    this.FIRE_PROBABILITY = 0.05; // Higher fire rate than remote tanks
    
    // Make tanks move a bit faster
    this.tankSpeed = 0.3; // Faster than RemoteTank's default of 0.2
    
    // Randomize movement pattern for each NPC tank
    const patterns: ('circle' | 'zigzag' | 'random' | 'patrol')[] = ['circle', 'zigzag', 'random', 'patrol'];
    this.movementPattern = patterns[Math.floor(Math.random() * patterns.length)];
    
    // Randomize direction change interval (2-5 seconds at 60fps)
    this.changeDirectionInterval = Math.floor(Math.random() * 180) + 120;
    
    // If patrol pattern is selected, set up patrol points
    if (this.movementPattern === 'patrol') {
      this.setupPatrolPoints();
    }
  }
  
  // Override update method to add more autonomous behavior
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
    
    // Handle reloading using timestamps
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
    
    // Randomly change movement pattern occasionally
    if (Math.random() < this.AI_MOVEMENT_CHANGE_CHANCE) {
      const patterns: ('circle' | 'zigzag' | 'random' | 'patrol')[] = ['circle', 'zigzag', 'random', 'patrol'];
      this.movementPattern = patterns[Math.floor(Math.random() * patterns.length)];
      
      // If switching to patrol, set up patrol points
      if (this.movementPattern === 'patrol') {
        this.setupPatrolPoints();
      }
    }
    
    // Execute movement based on pattern
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
      if (!this.lastMoveSoundState && this.moveSound) {
        this.moveSound.play();
        this.lastMoveSoundState = true;
      }
    } else if (this.lastMoveSoundState && this.moveSound) {
      this.moveSound.stop();
      this.lastMoveSoundState = false;
    }
    
    // Look for player tank to target
    let playerTank: ICollidable | null = null;
    if (colliders) {
      for (const collider of colliders) {
        // Skip self and non-tank objects
        if (collider === this || collider.getType() !== 'tank') continue;
        
        // Find the player tank (assumption: only one tank that's not a RemoteTank)
        if (!(collider instanceof RemoteTank)) {
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
          if (this.fireSound) {
            this.fireSound.setSourcePosition(this.tank.position);
            this.fireSound.cloneAndPlay();
          }
          
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
  
  // Override aiming for better AI control
  protected aimAtTarget(targetPosition: THREE.Vector3): void {
    // Get base targeting logic from parent
    super.aimAtTarget(targetPosition);
    
    // Add AI-specific accuracy variation based on AI_TARGETING_ACCURACY
    // Lower accuracy means more variation in aiming
    const accuracyVariation = (1 - this.AI_TARGETING_ACCURACY) * 0.1;
    
    // Add random variation to turret rotation
    this.turretPivot.rotation.y += (Math.random() - 0.5) * accuracyVariation;
    
    // Add random variation to barrel elevation
    this.barrelPivot.rotation.x += (Math.random() - 0.5) * accuracyVariation;
  }
}
