import * as THREE from 'three';
import { StaticCollider } from './collision';

// Define interface for trees from the server
export interface ServerTree {
  position: {
    x: number;
    y: number;
    z: number;
  };
  type: string;
  scale: number;
  radius: number;
}

// Define interface for tree map from the server
export interface ServerTreeMap {
  trees: ServerTree[];
}

// Define interface for full game map from the server
export interface ServerGameMap {
  trees: ServerTreeMap;
}

export class TreeGenerator {
  private scene: THREE.Scene;
  
  // Collider arrays for trees
  private treeColliders: StaticCollider[] = [];
  
  // Materials
  private trunkMaterial: THREE.MeshStandardMaterial;
  private leafMaterial: THREE.MeshStandardMaterial;
  
  // Store the map data from the server
  private serverMapData: ServerGameMap | null = null;
  
  constructor(scene: THREE.Scene) {
    this.scene = scene;
    
    // Initialize materials
    this.trunkMaterial = new THREE.MeshStandardMaterial({
      color: 0x8B4513, // Brown
      roughness: 0.9,
      metalness: 0.0
    });
    
    this.leafMaterial = new THREE.MeshStandardMaterial({
      color: 0x2E8B57, // Dark green
      roughness: 0.8,
      metalness: 0.1
    });
  }
  
  // Set server map data
  setServerMapData(mapData: ServerGameMap) {
    this.serverMapData = mapData;
  }
  
  // ===== TREE METHODS =====
  
  createPineTree(scale: number, x: number, z: number): StaticCollider {
    const tree = new THREE.Group();
    
    // Tree trunk - reduced segments for lower polygon count
    const trunkGeometry = new THREE.CylinderGeometry(0.2 * scale, 0.3 * scale, 1.5 * scale, 6);
    const trunk = new THREE.Mesh(trunkGeometry, this.trunkMaterial);
    trunk.position.y = 0.75 * scale;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    tree.add(trunk);
    
    // Tree foliage (cones) - reduced segments for lower polygon count
    const foliageGeometry1 = new THREE.ConeGeometry(1 * scale, 2 * scale, 6);
    const foliage1 = new THREE.Mesh(foliageGeometry1, this.leafMaterial);
    foliage1.position.y = 2 * scale;
    foliage1.castShadow = true;
    tree.add(foliage1);
    
    const foliageGeometry2 = new THREE.ConeGeometry(0.8 * scale, 1.8 * scale, 6);
    const foliage2 = new THREE.Mesh(foliageGeometry2, this.leafMaterial);
    foliage2.position.y = 3 * scale;
    foliage2.castShadow = true;
    tree.add(foliage2);
    
    const foliageGeometry3 = new THREE.ConeGeometry(0.6 * scale, 1.6 * scale, 6);
    const foliage3 = new THREE.Mesh(foliageGeometry3, this.leafMaterial);
    foliage3.position.y = 4 * scale;
    foliage3.castShadow = true;
    tree.add(foliage3);
    
    // Position tree
    tree.position.set(x, 0, z);
    
    // Add to scene
    this.scene.add(tree);
    
    // Create a collider for the tree
    const collisionRadius = 1.0 * scale; // Size based on tree scale
    const position = new THREE.Vector3(x, collisionRadius, z);
    const treeCollider = new StaticCollider(position, 'tree', collisionRadius);
    this.treeColliders.push(treeCollider);
    
    return treeCollider;
  }
  
  createRoundTree(scale: number, x: number, z: number): StaticCollider {
    const tree = new THREE.Group();
    
    // Tree trunk - reduced segments
    const trunkGeometry = new THREE.CylinderGeometry(0.2 * scale, 0.3 * scale, 1.5 * scale, 6);
    const trunk = new THREE.Mesh(trunkGeometry, this.trunkMaterial);
    trunk.position.y = 0.75 * scale;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    tree.add(trunk);
    
    // Tree foliage (sphere) - reduced segments
    const foliageGeometry = new THREE.SphereGeometry(1.2 * scale, 6, 6);
    const foliage = new THREE.Mesh(foliageGeometry, this.leafMaterial);
    foliage.position.y = 2.5 * scale;
    foliage.castShadow = true;
    tree.add(foliage);
    
    // Position tree
    tree.position.set(x, 0, z);
    
    // Add to scene
    this.scene.add(tree);
    
    // Create a collider for the tree
    const collisionRadius = 1.2 * scale; // Size based on tree scale
    const position = new THREE.Vector3(x, collisionRadius, z);
    const treeCollider = new StaticCollider(position, 'tree', collisionRadius);
    this.treeColliders.push(treeCollider);
    
    return treeCollider;
  }
  
  generateTrees(): void {
    // Use server-side tree data only
    if (this.serverMapData && this.serverMapData.trees) {
      console.log("Using server-provided tree data");
      // Account for both possible data structures - either direct array or nested in trees property
      const trees = Array.isArray(this.serverMapData.trees) ? 
                    this.serverMapData.trees : 
                    (this.serverMapData.trees.trees || []);
      
      console.log("Trees to render:", trees.length);
      
      // Create trees from the server data
      for (const tree of trees) {
        const { position, type, scale } = tree;
        
        // Create the appropriate tree type
        if (type === 'pine') {
          this.createPineTree(scale, position.x, position.z);
        } else if (type === 'round') {
          this.createRoundTree(scale, position.x, position.z);
        }
      }
    } else {
      console.log("No server tree data available");
    }
  }
  
  // Get tree colliders for collision detection
  getTreeColliders(): StaticCollider[] {
    return [...this.treeColliders];
  }
}