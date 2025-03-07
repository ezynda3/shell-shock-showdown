import * as THREE from 'three';
import { ICollidable } from './tank';

export class Shell implements ICollidable {
  // Shell instance properties
  public mesh: THREE.Mesh;
  private velocity: THREE.Vector3;
  private scene: THREE.Scene;
  private collider: THREE.Sphere;
  private isActive: boolean = true;
  private lifeTime: number = 0;
  private readonly MAX_LIFETIME: number = 300; // 5 seconds at 60fps
  private readonly GRAVITY: number = 0.03; // Gravity strength
  private readonly COLLISION_RADIUS: number = 0.2;
  
  // Tank that fired this shell - used to prevent self-collision
  private owner: ICollidable;

  constructor(
    scene: THREE.Scene,
    position: THREE.Vector3,
    direction: THREE.Vector3,
    velocity: number,
    owner: ICollidable
  ) {
    this.scene = scene;
    this.owner = owner;
    
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
    this.velocity = direction.clone().normalize().multiplyScalar(velocity);
    
    // Create collision sphere
    this.collider = new THREE.Sphere(position.clone(), this.COLLISION_RADIUS);
    
    // Add to scene
    scene.add(this.mesh);
  }
  
  update(): boolean {
    if (!this.isActive) return false;
    
    // Increment lifetime counter
    this.lifeTime++;
    
    // Check if shell has expired
    if (this.lifeTime >= this.MAX_LIFETIME) {
      this.destroy();
      return false;
    }
    
    // Apply gravity to velocity
    this.velocity.y -= this.GRAVITY;
    
    // Update position based on velocity
    this.mesh.position.add(this.velocity);
    
    // Update collider position
    this.collider.center.copy(this.mesh.position);
    
    // Check if shell is below ground (y = 0)
    if (this.mesh.position.y < 0) {
      // Create explosion effect at ground level
      this.createExplosion(new THREE.Vector3(
        this.mesh.position.x,
        0,
        this.mesh.position.z
      ));
      
      this.destroy();
      return false;
    }
    
    return true;
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
    // Don't collide with the tank that fired it
    if (other === this.owner) return;
    
    // Create explosion effect
    this.createExplosion(this.mesh.position.clone());
    
    // Deactivate the shell
    this.destroy();
  }
  
  isAlive(): boolean {
    return this.isActive;
  }
  
  getOwner(): ICollidable {
    return this.owner;
  }
  
  private destroy(): void {
    // Remove from scene
    this.scene.remove(this.mesh);
    this.isActive = false;
  }
  
  private createExplosion(position: THREE.Vector3): void {
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
      size: 0.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.8
    });
    
    // Create particle system
    const particles = new THREE.Points(geometry, material);
    particles.position.copy(position);
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
      const scale = 1 + frame * 0.1;
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