import * as THREE from 'three';
import { ICollidable } from './tank';

export class CollisionSystem {
  private colliders: ICollidable[] = [];
  
  constructor() {}
  
  addCollider(collider: ICollidable): void {
    this.colliders.push(collider);
  }
  
  removeCollider(collider: ICollidable): void {
    const index = this.colliders.indexOf(collider);
    if (index !== -1) {
      this.colliders.splice(index, 1);
    }
  }
  
  getColliders(): ICollidable[] {
    return this.colliders;
  }
  
  // Cache activeColliders and update only when collection changes
  private activeCollidersCache: ICollidable[] = [];
  private collidersDirty = true;
  private frameCounter = 0;
  
  addCollider(collider: ICollidable): void {
    this.colliders.push(collider);
    this.collidersDirty = true;
  }
  
  removeCollider(collider: ICollidable): void {
    const index = this.colliders.indexOf(collider);
    if (index !== -1) {
      this.colliders.splice(index, 1);
      this.collidersDirty = true;
    }
  }
  
  checkCollisions(): void {
    this.frameCounter++;
    
    // Update the active colliders cache only when needed
    if (this.collidersDirty) {
      // Filter out inactive shells before processing collisions
      this.activeCollidersCache = this.colliders.filter(collider => {
        if (collider.getType() === 'shell') {
          const shell = collider as any;
          if (shell.isAlive && !shell.isAlive()) {
            return false; // Skip inactive shells
          }
          if (shell.hasProcessedCollision) {
            return false; // Skip shells that have already processed a collision
          }
        }
        return true;
      });
      
      this.collidersDirty = false;
    }
    
    const activeColliders = this.activeCollidersCache;
    
    // Process collisions prioritizing moving objects and shells
    const shells = activeColliders.filter(c => c.getType() === 'shell');
    const tanks = activeColliders.filter(c => c.getType() === 'tank');
    const staticObjects = activeColliders.filter(c => c.getType() !== 'shell' && c.getType() !== 'tank');
    
    // Check shell-tank collisions first (most important for gameplay)
    for (const shell of shells) {
      for (const tank of tanks) {
        // Skip collision with owner
        if (this.shouldSkipCollision(shell, tank)) {
          continue;
        }
        
        if (this.testCollision(shell, tank)) {
          if (shell.onCollision) {
            shell.onCollision(tank);
          }
        }
      }
    }
    
    // Check shell-static collisions next
    for (const shell of shells) {
      // Skip testing inactive shells
      if ((shell as any).hasProcessedCollision) continue;
      
      for (const staticObj of staticObjects) {
        if (this.testCollision(shell, staticObj)) {
          if (shell.onCollision) {
            shell.onCollision(staticObj);
          }
        }
      }
    }
    
    // Check tank-tank collisions only every other frame to reduce calculations
    if (this.frameCounter % 2 === 0) {
      for (let i = 0; i < tanks.length; i++) {
        const tankA = tanks[i];
        
        for (let j = i + 1; j < tanks.length; j++) {
          const tankB = tanks[j];
          
          if (this.testCollision(tankA, tankB)) {
            if (tankA.onCollision) tankA.onCollision(tankB);
            if (tankB.onCollision) tankB.onCollision(tankA);
          }
        }
      }
    }
    
    // Check tank-static collisions every frame but only for tanks that are moving
    for (const tank of tanks) {
      // Skip non-moving tanks for static collision tests
      // This assumes tank has isMoving method or property
      const isMoving = (tank as any).isMoving?.() ?? true;
      if (!isMoving) continue;
      
      for (const staticObj of staticObjects) {
        if (this.testCollision(tank, staticObj)) {
          if (tank.onCollision) tank.onCollision(staticObj);
        }
      }
    }
    
    // Mark the cache as dirty if shells were checked (they might be inactive now)
    if (shells.length > 0) {
      this.collidersDirty = true;
    }
  }
  
  private shouldSkipCollision(objA: ICollidable, objB: ICollidable): boolean {
    const typeA = objA.getType();
    const typeB = objB.getType();
    
    // Skip collision between static environment objects
    // Static objects should not collide with each other
    if ((typeA === 'tree' && typeB === 'tree') || 
        (typeA === 'rock' && typeB === 'rock') ||
        (typeA === 'tree' && typeB === 'rock') ||
        (typeA === 'rock' && typeB === 'tree') ||
        (typeA === 'building' && typeB === 'building') ||
        (typeA === 'building' && typeB === 'tree') ||
        (typeA === 'tree' && typeB === 'building') ||
        (typeA === 'building' && typeB === 'rock') ||
        (typeA === 'rock' && typeB === 'building')) {
      return true;
    }
    
    // Special case for shells - check if shell colliding with its owner tank
    if (typeA === 'shell' && typeB === 'tank') {
      // Try to get the shell's owner - using type casting and checking for getOwner method
      const shell = objA as any;
      if (shell.getOwner && shell.getOwner() === objB) {
        return true; // Skip collision with owner
      }
    }
    
    // Same check but reversed
    if (typeA === 'tank' && typeB === 'shell') {
      const shell = objB as any;
      if (shell.getOwner && shell.getOwner() === objA) {
        return true; // Skip collision with owner
      }
    }
    
    return false;
  }
  
  private testCollision(objA: ICollidable, objB: ICollidable): boolean {
    const colliderA = objA.getCollider();
    const colliderB = objB.getCollider();
    
    // Sphere-Sphere collision
    if (colliderA instanceof THREE.Sphere && colliderB instanceof THREE.Sphere) {
      const distance = objA.getPosition().distanceTo(objB.getPosition());
      return distance < (colliderA.radius + colliderB.radius);
    }
    
    // Box-Box collision
    if (colliderA instanceof THREE.Box3 && colliderB instanceof THREE.Box3) {
      return colliderA.intersectsBox(colliderB);
    }
    
    // Sphere-Box collision
    if (colliderA instanceof THREE.Sphere && colliderB instanceof THREE.Box3) {
      return colliderB.intersectsSphere(colliderA);
    }
    
    // Box-Sphere collision
    if (colliderA instanceof THREE.Box3 && colliderB instanceof THREE.Sphere) {
      return colliderA.intersectsSphere(colliderB);
    }
    
    return false;
  }
  
  // Helper method to check if a point intersects with any collider
  checkPointCollision(point: THREE.Vector3, excludeCollider?: ICollidable): ICollidable | null {
    for (const collider of this.colliders) {
      if (collider === excludeCollider) continue;
      
      const shape = collider.getCollider();
      
      if (shape instanceof THREE.Sphere) {
        const distance = point.distanceTo(collider.getPosition());
        if (distance < shape.radius) {
          return collider;
        }
      } else if (shape instanceof THREE.Box3) {
        if (shape.containsPoint(point)) {
          return collider;
        }
      }
    }
    
    return null;
  }
}

// Helper class for creating static environment colliders
export class StaticCollider implements ICollidable {
  private collider: THREE.Sphere | THREE.Box3;
  private position: THREE.Vector3;
  private type: string;
  
  constructor(
    position: THREE.Vector3, 
    type: string, 
    radius?: number,
    size?: THREE.Vector3
  ) {
    this.position = position.clone();
    this.type = type;
    
    // Create a sphere collider if radius is provided
    if (radius !== undefined) {
      this.collider = new THREE.Sphere(this.position.clone(), radius);
    } 
    // Otherwise create a box collider
    else if (size !== undefined) {
      this.collider = new THREE.Box3().setFromCenterAndSize(
        this.position.clone(),
        size.clone()
      );
    }
    // Default to a small sphere
    else {
      this.collider = new THREE.Sphere(this.position.clone(), 1);
    }
  }
  
  getCollider(): THREE.Sphere | THREE.Box3 {
    return this.collider;
  }
  
  getPosition(): THREE.Vector3 {
    return this.position.clone();
  }
  
  getType(): string {
    return this.type;
  }
}