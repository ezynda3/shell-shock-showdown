import * as THREE from 'three';
import { ICollidable, ITank, RemoteTank } from './tank';

export class Shell implements ICollidable {
  // Shell instance properties
  public mesh: THREE.Mesh;
  private velocity: THREE.Vector3;
  private scene: THREE.Scene;
  private collider: THREE.Sphere;
  private isActive: boolean = true;
  private lifeTime: number = 0;
  private readonly MAX_LIFETIME: number = 1200; // 20 seconds at 60fps - 5x longer range
  private readonly GRAVITY: number = 0.005; // Greatly reduced gravity for extreme arcs
  private readonly COLLISION_RADIUS: number = 0.2;
  
  // Unique shell ID for tracking and deduplication
  private shellId: string;
  
  // Reference to the tank that fired this shell
  private source: ITank;
  
  // Trail effect properties
  private trail: THREE.Points;
  private trailPositions: Float32Array;
  private trailColors: Float32Array;
  private trailGeometry: THREE.BufferGeometry;
  private readonly TRAIL_LENGTH: number = 40; // Number of trail segments - doubled for longer trails
  private readonly TRAIL_FADE_RATE: number = 0.96; // How quickly trail fades (0-1, higher = slower fade)
  
  // Tank that fired this shell - used to prevent self-collision
  private owner: ICollidable;
  
  // Direction the shell is traveling - needed for network sync
  private direction: THREE.Vector3;

  // Static shared geometry for all shells
  private static shellGeometry: THREE.SphereGeometry;
  private static shellMaterial: THREE.MeshStandardMaterial;
  
  constructor(
    scene: THREE.Scene,
    position: THREE.Vector3,
    direction: THREE.Vector3,
    velocity: number,
    owner: ICollidable,
    shellId?: string
  ) {
    this.scene = scene;
    this.owner = owner;
    this.source = owner as ITank;
    
    // Set shell ID (generate one if not provided)
    this.shellId = shellId || `shell_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Store initial direction (normalized)
    this.direction = direction.clone().normalize();
    
    // Create shell geometry - only create once statically to share across all shells
    if (!Shell.shellGeometry) {
      // Use lower-poly sphere (6 segments instead of 8)
      Shell.shellGeometry = new THREE.SphereGeometry(this.COLLISION_RADIUS, 6, 6);
      Shell.shellMaterial = new THREE.MeshStandardMaterial({
        color: 0x333333,
        roughness: 0.7,
        metalness: 0.5
      });
    }
    
    // Create mesh using shared geometry
    this.mesh = new THREE.Mesh(Shell.shellGeometry, Shell.shellMaterial);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.position.copy(position);
    
    // Initialize velocity vector based on direction and initial speed
    this.velocity = this.direction.clone().multiplyScalar(velocity);
    
    // Create collision sphere
    this.collider = new THREE.Sphere(position.clone(), this.COLLISION_RADIUS);
    
    // Initialize trail system
    this.initializeTrail(position.clone());
    
    // Add to scene
    scene.add(this.mesh);
  }
  
  // Get the direction of the shell (for network sync)
  getDirection(): THREE.Vector3 {
    return this.direction.clone();
  }
  
  // Get the shell's unique ID
  getShellId(): string {
    return this.shellId;
  }
  
  // Air resistance coefficient (higher = more drag)
  private airResistance: number = 0.001;
  // Wind effect (subtle)
  private windFactor = new THREE.Vector3(0.0005, 0, 0.0005);
  
  update(): boolean {
    // If shell is inactive or has already processed a collision, return false
    if (!this.isActive || this.hasProcessedCollision) return false;
    
    // Increment lifetime counter
    this.lifeTime++;
    
    // Check if shell has expired
    if (this.lifeTime >= this.MAX_LIFETIME) {
      // Create small fade-out explosion effect for expired shells
      this.createExplosion(this.mesh.position.clone(), 0.5);
      this.destroy();
      return false;
    }
    
    // Apply gravity with more realistic effects
    // Gravity increases slightly with velocity for more realistic arcs
    this.velocity.y -= this.GRAVITY * (1 + this.velocity.length() * 0.01);
    
    // Apply air resistance proportional to velocity squared (realistic drag)
    const speedSquared = this.velocity.lengthSq();
    const dragForce = this.velocity.clone().normalize().multiplyScalar(-this.airResistance * speedSquared);
    this.velocity.add(dragForce);
    
    // Apply subtle wind effects
    this.velocity.add(this.windFactor);
    
    // Update position based on adjusted velocity
    this.mesh.position.add(this.velocity);
    
    // Update collider position
    this.collider.center.copy(this.mesh.position);
    
    // Update trail
    this.updateTrail();
    
    // Check if shell is below ground (y = 0)
    if (this.mesh.position.y < 0) {
      // Create explosion effect at ground level with appropriate angle
      const hitPosition = new THREE.Vector3(
        this.mesh.position.x,
        0,
        this.mesh.position.z
      );
      
      // Calculate impact angle and speed for more realistic ground explosions
      const impactAngle = Math.atan2(-this.velocity.y, Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z));
      const impactSpeed = this.velocity.length();
      
      // Create explosion with size relative to impact speed and angle
      const explosionSize = 1.0 + (impactSpeed * 0.5) * Math.sin(impactAngle);
      this.createExplosion(hitPosition, explosionSize);
      
      // Create dust effect based on impact angle
      if (impactAngle < Math.PI / 4) { // Shallow impact
        this.createDustEffect(hitPosition);
      }
      
      // Immediately remove shell visuals
      this.scene.remove(this.mesh);
      if (this.trail) {
        this.scene.remove(this.trail);
      }
      
      this.destroy();
      return false;
    }
    
    return true;
  }
  
  // Create dust cloud effect for shallow impacts
  private createDustEffect(position: THREE.Vector3): void {
    const particleCount = 20;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    
    // Direction of dust spread (opposite of shell horizontal direction)
    const dustDirection = new THREE.Vector2(-this.velocity.x, -this.velocity.z).normalize();
    
    // Create positions and colors for dust particles
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      
      // Calculate spread based on shell velocity
      const spread = 2.0 * Math.random();
      const angle = Math.PI * 2 * Math.random();
      
      // Positions with directional bias
      positions[i3] = position.x + (Math.cos(angle) * spread) + (dustDirection.x * spread);
      positions[i3 + 1] = position.y + Math.random() * 0.5; // Low height
      positions[i3 + 2] = position.z + (Math.sin(angle) * spread) + (dustDirection.y * spread);
      
      // Dust color (tan/brown)
      const brightness = 0.5 + Math.random() * 0.3;
      colors[i3] = brightness; // Red
      colors[i3 + 1] = brightness * 0.9; // Green (slightly less for brown tint)
      colors[i3 + 2] = brightness * 0.7; // Blue (even less for brown tint)
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const material = new THREE.PointsMaterial({
      size: 0.5,
      vertexColors: true,
      transparent: true,
      opacity: 0.6
    });
    
    const particles = new THREE.Points(geometry, material);
    this.scene.add(particles);
    
    // Animate dust particles
    const dustDuration = 2000; // 2 seconds
    const startTime = Date.now();
    
    const animateDust = () => {
      const elapsed = Date.now() - startTime;
      const progress = elapsed / dustDuration;
      
      if (progress >= 1) {
        this.scene.remove(particles);
        return;
      }
      
      // Expand and rise
      const positions = geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < particleCount; i++) {
        const i3 = i * 3;
        // Slowly move outward
        positions[i3] += dustDirection.x * 0.01;
        // Slowly rise and slow down over time
        positions[i3 + 1] += 0.02 * (1 - progress);
        positions[i3 + 2] += dustDirection.y * 0.01;
      }
      
      // Fade out
      if (progress > 0.5) {
        material.opacity = 0.6 * (1 - (progress - 0.5) * 2);
      }
      
      geometry.attributes.position.needsUpdate = true;
      requestAnimationFrame(animateDust);
    };
    
    requestAnimationFrame(animateDust);
  }
  
  private updateTrail(): void {
    // Shift all trail segments one position back (from last to first)
    for (let i = this.TRAIL_LENGTH - 1; i > 0; i--) {
      const currentIdx = i * 3;
      const prevIdx = (i - 1) * 3;
      
      // Copy position from previous segment
      this.trailPositions[currentIdx] = this.trailPositions[prevIdx];
      this.trailPositions[currentIdx + 1] = this.trailPositions[prevIdx + 1];
      this.trailPositions[currentIdx + 2] = this.trailPositions[prevIdx + 2];
    }
    
    // Update the first segment with the current shell position
    this.trailPositions[0] = this.mesh.position.x;
    this.trailPositions[1] = this.mesh.position.y;
    this.trailPositions[2] = this.mesh.position.z;
    
    // Update the geometry
    (this.trailGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
  
  // Implement ICollidable interface
  getCollider(): THREE.Sphere {
    return this.collider;
  }
  
  getPosition(): THREE.Vector3 {
    return this.mesh.position.clone();
  }
  
  getType(): string {
    return 'shell';
  }
  
  // Track if we've already processed a collision to avoid duplication
  private hasProcessedCollision = false;
  
  onCollision(other: ICollidable): void {
    // Don't collide with the tank that fired it, or if already inactive
    // or if we've already processed a collision for this shell
    if (other === this.owner || !this.isActive || this.hasProcessedCollision) return;
    
    // If we hit a tank that's already destroyed, ignore the collision
    if (other.getType() === 'tank') {
      const tank = other as ITank;
      // Access the isDestroyed property
      if ((tank as any).isDestroyed) {
        return;
      }
    }
    
    // Immediately mark shell as inactive and that we've processed a collision
    this.isActive = false;
    this.hasProcessedCollision = true;
    
    // Immediately remove shell mesh from the scene
    this.scene.remove(this.mesh);
    
    // Remove trail immediately
    if (this.trail) {
      this.scene.remove(this.trail);
    }
    
    // Create explosion effect
    this.createExplosion(this.mesh.position.clone());
    
    // If hit a tank, create visual and sound effects but don't apply damage
    // Health changes are now managed by the server
    if (other.getType() === 'tank') {
      const tank = other as ITank;
      
      // Check if this is a player-tank hit or a remote/NPC tank hit
      const isPlayerTank = !(tank instanceof RemoteTank);
      
      // Determine hit location for visual effects only
      let hitLocation = "body";
      
      // Check for hit location with compound colliders if available (for visual effects only)
      if (tank.getDetailedColliders && tank.getDetailedColliders().length > 0) {
        // Get the shell's position for precise hit detection
        const shellPosition = this.mesh.position.clone();
        
        // Check each detailed collider to see which was hit
        for (const collider of tank.getDetailedColliders()) {
          const distance = shellPosition.distanceTo(collider.collider.center);
          if (distance < collider.collider.radius) {
            // This is the part we hit!
            hitLocation = collider.part;
            break;
          }
        }
        
        console.log(`Shell collision: ${isPlayerTank ? 'PLAYER' : 'NPC'} tank hit on ${hitLocation}. Current health: ${tank.getHealth()}`);
      } else {
        console.log(`Shell collision: ${isPlayerTank ? 'PLAYER' : 'NPC'} tank hit. Current health: ${tank.getHealth()}`);
      }
      
      // Fire tank-hit event for visual effects and sound only
      // Health changes will come from server state updates
      const hitEvent = new CustomEvent('tank-hit', {
        bubbles: true,
        composed: true,
        detail: {
          tank: tank,
          source: this.source,
          hitLocation: hitLocation
        }
      });
      document.dispatchEvent(hitEvent);
    }
  }
  
  isAlive(): boolean {
    return this.isActive;
  }
  
  getOwner(): ICollidable {
    return this.owner;
  }
  
  getOwnerId(): string {
    if (this.owner && (this.owner as any).playerId) {
      return (this.owner as any).playerId;
    }
    return "unknown";
  }
  
  private destroy(): void {
    // Set isActive to false and mark as processed
    this.isActive = false;
    this.hasProcessedCollision = true;
    
    // Remove from scene if not already removed
    if (this.mesh.parent) {
      this.scene.remove(this.mesh);
    }
    
    // Remove trail if not already removed
    if (this.trail && this.trail.parent) {
      this.scene.remove(this.trail);
    }
  }
  
  // Static shared material for trails
  private static trailMaterial: THREE.PointsMaterial;
  
  private initializeTrail(initialPosition: THREE.Vector3): void {
    // Reduce trail length for performance
    const trailLength = this.TRAIL_LENGTH * (window.innerWidth < 1000 ? 0.75 : 1.0);
    
    // Create arrays for trail positions and colors
    this.trailPositions = new Float32Array(trailLength * 3); // xyz * trail length
    this.trailColors = new Float32Array(trailLength * 3); // rgb * trail length
    
    // Initialize all trail positions to the starting position
    for (let i = 0; i < trailLength; i++) {
      const idx = i * 3;
      this.trailPositions[idx] = initialPosition.x;
      this.trailPositions[idx + 1] = initialPosition.y;
      this.trailPositions[idx + 2] = initialPosition.z;
      
      // Initialize color with decreasing opacity based on position in trail
      const alpha = Math.pow(this.TRAIL_FADE_RATE, i);
      this.trailColors[idx] = 1.0;         // Red component 
      this.trailColors[idx + 1] = 0.7;     // Green component (slight yellow tint)
      this.trailColors[idx + 2] = 0.3 * alpha; // Blue component with fading
    }
    
    // Create the geometry and set attributes
    this.trailGeometry = new THREE.BufferGeometry();
    this.trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trailGeometry.setAttribute('color', new THREE.BufferAttribute(this.trailColors, 3));
    
    // Create material for the trail (shared across all shells)
    if (!Shell.trailMaterial) {
      Shell.trailMaterial = new THREE.PointsMaterial({
        size: 0.25,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
    }
    
    // Create the trail points system with shared material
    this.trail = new THREE.Points(this.trailGeometry, Shell.trailMaterial);
    
    // Add trail to scene
    this.scene.add(this.trail);
  }
  
  // Cache for explosion materials
  private static explosionMaterial: THREE.PointsMaterial;
  
  private createExplosion(position: THREE.Vector3, sizeScale: number = 1.0): void {
    // Reduce particle count on low-end devices
    const isLowPerformance = (window as any).lowPerformanceMode || false;
    const particleCount = isLowPerformance ? 15 : 30; // Increased for more impressive explosions
    
    // Create enhanced explosion effect
    this.createFireballEffect(position, sizeScale);
    this.createShockwaveEffect(position, sizeScale);
    
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    
    // Create positions and colors for particles with more variation
    for (let i = 0; i < particleCount; i++) {
      // Random position in sphere with directional bias
      const i3 = i * 3;
      const phi = Math.random() * Math.PI * 2;
      const theta = Math.random() * Math.PI;
      const radius = Math.random() * 2 * sizeScale;
      
      positions[i3] = Math.sin(theta) * Math.cos(phi) * radius;
      positions[i3 + 1] = Math.cos(theta) * radius * 1.2; // More upward bias
      positions[i3 + 2] = Math.sin(theta) * Math.sin(phi) * radius;
      
      // Varied particle sizes
      sizes[i] = 0.1 + Math.random() * 0.3;
      
      // More vibrant color variation (yellow-orange-red with some bright spots)
      if (Math.random() > 0.7) {
        // Bright yellow/white cores
        colors[i3] = 1.0; // Full red
        colors[i3 + 1] = 0.9 + Math.random() * 0.1; // Almost full green (yellow)
        colors[i3 + 2] = Math.random() * 0.5; // Some blue (for white hot centers)
      } else {
        // Normal fire colors
        colors[i3] = Math.random() * 0.2 + 0.8; // Red component (0.8-1.0)
        colors[i3 + 1] = Math.random() * 0.6; // Green component (0-0.6) - more orange variation
        colors[i3 + 2] = 0; // No blue
      }
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    // Reuse explosion material
    if (!Shell.explosionMaterial) {
      Shell.explosionMaterial = new THREE.PointsMaterial({
        size: 0.2,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending, // Additive blending for brighter effect
        sizeAttenuation: true // Size varies with distance
      });
    }
    
    // Clone the material for this specific explosion (to allow independent opacity)
    const material = Shell.explosionMaterial.clone();
    material.size = 0.2 * sizeScale;
    
    // Create particle system
    const particles = new THREE.Points(geometry, material);
    particles.position.copy(position);
    
    // Apply initial scale
    particles.scale.set(sizeScale, sizeScale, sizeScale);
    
    this.scene.add(particles);
    
    // Animate explosion particles
    const MAX_FRAMES = isLowPerformance ? 15 : 25; // More frames for smoother animation
    
    // Use a single requestAnimationFrame to reduce overhead
    const startTime = performance.now();
    const duration = MAX_FRAMES * 16.7; // ~16.7ms per frame at 60fps
    
    const animateExplosion = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(1, elapsed / duration);
      
      if (progress >= 1) {
        this.scene.remove(particles);
        return;
      }
      
      // Update particle positions for more dynamic movement
      const positions = geometry.attributes.position.array as Float32Array;
      const sizes = geometry.attributes.size.array as Float32Array;
      
      for (let i = 0; i < particleCount; i++) {
        const i3 = i * 3;
        
        // Expand particles with some random variation
        const expansionRate = 0.03 * (1.0 - progress * 0.5); // Slows down over time
        const direction = new THREE.Vector3(
          positions[i3], 
          positions[i3 + 1], 
          positions[i3 + 2]
        ).normalize();
        
        positions[i3] += direction.x * expansionRate * (1 + Math.random() * 0.5);
        positions[i3 + 1] += direction.y * expansionRate * (1 + Math.random() * 0.5);
        positions[i3 + 2] += direction.z * expansionRate * (1 + Math.random() * 0.5);
        
        // Add slight upward drift for rising heat effect
        positions[i3 + 1] += 0.01 * (1.0 - progress);
        
        // Increase particle size slightly then shrink
        if (progress < 0.3) {
          sizes[i] *= 1.01;
        } else {
          sizes[i] *= 0.98;
        }
      }
      
      // Scale particles outward
      const scale = sizeScale * (1 + progress * 2);
      particles.scale.set(scale, scale, scale);
      
      // Fade out with non-linear curve for more natural look
      const opacity = Math.pow(1 - progress, 1.5);
      if (material.opacity !== undefined) {
        material.opacity = opacity;
      }
      
      // Update geometry attributes
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.size.needsUpdate = true;
      
      requestAnimationFrame(animateExplosion);
    };
    
    // Start animation
    requestAnimationFrame(animateExplosion);
    
    // Add sound effect using SpatialAudio system
    if (window.SpatialAudio) {
      try {
        // Create spatial audio for the explosion
        const explosionSound = new window.SpatialAudio(
          '/static/js/assets/sounds/shell-explosion.mp3', 
          false, // not looping 
          0.2 + (sizeScale * 0.3), // volume based on size
          200  // audible from far away
        );
        
        // Set the position of the explosion
        explosionSound.setSourcePosition(position);
        
        // Play the sound spatially
        explosionSound.cloneAndPlay();
      } catch(e) {
        console.warn('Spatial audio failed:', e);
        
        // Fallback to basic Audio API
        try {
          const explosionSound = new Audio('/static/js/assets/sounds/shell-explosion.mp3');
          explosionSound.volume = 0.2 + (sizeScale * 0.3);
          explosionSound.play().catch(e => console.warn('Audio play failed:', e));
        } catch(e) {
          console.warn('Audio not supported');
        }
      }
    } else {
      // Fallback if SpatialAudio isn't available
      try {
        const explosionSound = new Audio('/static/js/assets/sounds/shell-explosion.mp3');
        explosionSound.volume = 0.2 + (sizeScale * 0.3);
        explosionSound.play().catch(e => console.warn('Audio play failed:', e));
      } catch(e) {
        console.warn('Audio not supported');
      }
    }
  }
  
  // Create shockwave ring effect
  private createShockwaveEffect(position: THREE.Vector3, sizeScale: number): void {
    // Create a ring geometry for the shockwave
    const shockwaveGeometry = new THREE.RingGeometry(0.1, 0.5, 32);
    const shockwaveMaterial = new THREE.MeshBasicMaterial({
      color: 0xffcc66,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    
    const shockwave = new THREE.Mesh(shockwaveGeometry, shockwaveMaterial);
    shockwave.position.copy(position);
    shockwave.position.y += 0.1; // Slightly above ground
    shockwave.rotation.x = -Math.PI / 2; // Lay flat
    
    this.scene.add(shockwave);
    
    // Animate the shockwave
    const startTime = performance.now();
    const duration = 500; // Half a second
    const maxRadius = 8 * sizeScale;
    
    const animateShockwave = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(1, elapsed / duration);
      
      if (progress >= 1) {
        this.scene.remove(shockwave);
        return;
      }
      
      // Expand the ring
      const currentScale = progress * maxRadius;
      shockwave.scale.set(currentScale, currentScale, 1);
      
      // Fade out
      shockwaveMaterial.opacity = 0.7 * (1 - progress);
      
      requestAnimationFrame(animateShockwave);
    };
    
    requestAnimationFrame(animateShockwave);
  }
  
  // Create expanding fireball effect
  private createFireballEffect(position: THREE.Vector3, sizeScale: number): void {
    // Bright flash at explosion center
    const flashGeometry = new THREE.SphereGeometry(1 * sizeScale, 16, 16);
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffeeaa,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    
    const flash = new THREE.Mesh(flashGeometry, flashMaterial);
    flash.position.copy(position);
    this.scene.add(flash);
    
    // Animate flash
    const startTime = performance.now();
    const flashDuration = 300; // Very quick (0.3 seconds)
    
    const animateFlash = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(1, elapsed / flashDuration);
      
      if (progress >= 1) {
        this.scene.remove(flash);
        return;
      }
      
      // Quick expansion then fade
      const scale = sizeScale * (1 + progress * 3);
      flash.scale.set(scale, scale, scale);
      
      // Rapid fade out
      flashMaterial.opacity = 0.9 * (1 - progress * progress);
      
      requestAnimationFrame(animateFlash);
    };
    
    requestAnimationFrame(animateFlash);
  }
}