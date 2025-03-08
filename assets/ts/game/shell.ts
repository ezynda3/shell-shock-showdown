import * as THREE from 'three';
import { ICollidable, ITank, NPCTank } from './tank';

export class Shell implements ICollidable {
  // Shell instance properties
  public mesh: THREE.Mesh;
  private velocity: THREE.Vector3;
  private scene: THREE.Scene;
  private collider: THREE.Sphere;
  private isActive: boolean = true;
  private lifeTime: number = 0;
  private readonly MAX_LIFETIME: number = 600; // 10 seconds at 60fps - doubled for longer range
  private readonly GRAVITY: number = 0.01; // Reduced gravity for much longer arcs
  private readonly COLLISION_RADIUS: number = 0.2;
  
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

  constructor(
    scene: THREE.Scene,
    position: THREE.Vector3,
    direction: THREE.Vector3,
    velocity: number,
    owner: ICollidable
  ) {
    this.scene = scene;
    this.owner = owner;
    this.source = owner as ITank;
    
    // Store initial direction (normalized)
    this.direction = direction.clone().normalize();
    
    // Create shell geometry - small sphere
    const geometry = new THREE.SphereGeometry(this.COLLISION_RADIUS, 8, 8);
    const material = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.7,
      metalness: 0.5
    });
    
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = false; // No shadow for better performance
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
  
  update(): boolean {
    if (!this.isActive) return false;
    
    // Increment lifetime counter
    this.lifeTime++;
    
    // Check if shell has expired
    if (this.lifeTime >= this.MAX_LIFETIME) {
      // Create small fade-out explosion effect for expired shells
      this.createExplosion(this.mesh.position.clone(), 0.5);
      this.destroy();
      return false;
    }
    
    // Apply gravity to velocity
    this.velocity.y -= this.GRAVITY;
    
    // Update position based on velocity
    this.mesh.position.add(this.velocity);
    
    // Update collider position
    this.collider.center.copy(this.mesh.position);
    
    // Update trail
    this.updateTrail();
    
    // Check if shell is below ground (y = 0)
    if (this.mesh.position.y < 0) {
      // Create explosion effect at ground level
      this.createExplosion(new THREE.Vector3(
        this.mesh.position.x,
        0,
        this.mesh.position.z
      ));
      
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
  
  onCollision(other: ICollidable): void {
    // Don't collide with the tank that fired it, or if already inactive
    if (other === this.owner || !this.isActive) return;
    
    // Immediately mark shell as inactive to prevent multiple collisions
    this.isActive = false;
    
    // Immediately remove shell mesh from the scene
    this.scene.remove(this.mesh);
    
    // Remove trail immediately
    if (this.trail) {
      this.scene.remove(this.trail);
    }
    
    // Create explosion effect
    this.createExplosion(this.mesh.position.clone());
    
    // If hit a tank, apply damage
    if (other.getType() === 'tank') {
      const tank = other as ITank;
      
      // Check if this is a player-tank hit or an NPC-tank hit
      const isPlayerTank = !(tank instanceof NPCTank);
      
      // Calculate damage - 25% regardless, ensuring 4 hits to destroy
      const damageAmount = 25;
      
      console.log(`Shell collision: ${isPlayerTank ? 'PLAYER' : 'NPC'} tank hit with ${damageAmount} damage. Current health: ${tank.getHealth()}`);
      
      // Try to damage the tank
      const tankDestroyed = tank.takeDamage(damageAmount);
      console.log(`After hit: ${isPlayerTank ? 'PLAYER' : 'NPC'} tank health: ${tank.getHealth()}%, destroyed: ${tankDestroyed}`);
      
      // Since we don't have a direct reference to the player tank,
      // we'll add a custom event that game-component can listen for
      if (tankDestroyed) {
        const event = new CustomEvent('tank-destroyed', {
          bubbles: true,
          composed: true,
          detail: { 
            tank: tank,
            source: this.source 
          }
        });
        document.dispatchEvent(event);
      }
      
      // Fire tank-hit event to notify of damage (even if not destroyed)
      const hitEvent = new CustomEvent('tank-hit', {
        bubbles: true,
        composed: true,
        detail: {
          tank: tank,
          source: this.source,
          damageAmount: damageAmount
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
    // Set isActive to false
    this.isActive = false;
    
    // Remove from scene if not already removed
    if (this.mesh.parent) {
      this.scene.remove(this.mesh);
    }
    
    // Remove trail if not already removed
    if (this.trail && this.trail.parent) {
      this.scene.remove(this.trail);
    }
  }
  
  private initializeTrail(initialPosition: THREE.Vector3): void {
    // Create arrays for trail positions and colors
    this.trailPositions = new Float32Array(this.TRAIL_LENGTH * 3); // xyz * trail length
    this.trailColors = new Float32Array(this.TRAIL_LENGTH * 3); // rgb * trail length
    
    // Initialize all trail positions to the starting position
    for (let i = 0; i < this.TRAIL_LENGTH; i++) {
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
    
    // Create material for the trail
    const trailMaterial = new THREE.PointsMaterial({
      size: 0.25, // Increased from 0.15 for better visibility
      vertexColors: true,
      transparent: true,
      opacity: 0.8, // Increased from 0.6 for better visibility
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    
    // Create the trail points system
    this.trail = new THREE.Points(this.trailGeometry, trailMaterial);
    
    // Add trail to scene
    this.scene.add(this.trail);
  }
  
  private createExplosion(position: THREE.Vector3, sizeScale: number = 1.0): void {
    // Create explosion particle system
    const particleCount = 30;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    
    // Create positions and colors for particles
    for (let i = 0; i < particleCount; i++) {
      // Random position in sphere
      const i3 = i * 3;
      positions[i3] = (Math.random() - 0.5) * 2;
      positions[i3 + 1] = Math.random() * 2; // More upward
      positions[i3 + 2] = (Math.random() - 0.5) * 2;
      
      // Yellow-orange-red color gradient
      colors[i3] = Math.random() * 0.5 + 0.5; // Red component (0.5-1.0)
      colors[i3 + 1] = Math.random() * 0.5; // Green component (0-0.5)
      colors[i3 + 2] = 0; // No blue
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    // Material for particles
    const material = new THREE.PointsMaterial({
      size: 0.2 * sizeScale,
      vertexColors: true,
      transparent: true,
      opacity: 0.8
    });
    
    // Create particle system
    const particles = new THREE.Points(geometry, material);
    particles.position.copy(position);
    
    // Apply initial scale
    particles.scale.set(sizeScale, sizeScale, sizeScale);
    
    this.scene.add(particles);
    
    // Animate explosion particles
    let frame = 0;
    const MAX_FRAMES = 20;
    
    const animateExplosion = () => {
      if (frame >= MAX_FRAMES) {
        this.scene.remove(particles);
        return;
      }
      
      // Scale particles outward
      const scale = sizeScale * (1 + frame * 0.1);
      particles.scale.set(scale, scale, scale);
      
      // Fade out
      const opacity = 1 - (frame / MAX_FRAMES);
      if (material.opacity !== undefined) {
        material.opacity = opacity;
      }
      
      frame++;
      requestAnimationFrame(animateExplosion);
    };
    
    // Start animation
    animateExplosion();
  }
}