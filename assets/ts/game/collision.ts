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
  
  checkCollisions(): void {
    // For each pair of objects, check for collisions
    for (let i = 0; i < this.colliders.length; i++) {
      for (let j = i + 1; j < this.colliders.length; j++) {
        const objA = this.colliders[i];
        const objB = this.colliders[j];
        
        // Skip collision detection between certain object types
        // For example, tree-tree or rock-rock collisions
        if (this.shouldSkipCollision(objA, objB)) {
          continue;
        }
        
        if (this.testCollision(objA, objB)) {
          // Handle collision
          if (objA.onCollision) objA.onCollision(objB);
          if (objB.onCollision) objB.onCollision(objA);
        }
      }
    }
  }
  
  private shouldSkipCollision(objA: ICollidable, objB: ICollidable): boolean {
    const typeA = objA.getType();
    const typeB = objB.getType();
    
    // Skip collision between static environment objects
    if ((typeA === 'tree' && typeB === 'tree') || 
        (typeA === 'rock' && typeB === 'rock') ||
        (typeA === 'tree' && typeB === 'rock') ||
        (typeA === 'rock' && typeB === 'tree')) {
      return true;
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