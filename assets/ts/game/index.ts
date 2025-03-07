import { LitElement, html, css } from 'lit';
import { customElement, query, property } from 'lit/decorators.js';
import * as THREE from 'three';
import { MapGenerator } from './map';
import { Tank, NPCTank, ITank, ICollidable } from './tank';
import { CollisionSystem } from './collision';
import './stats'; // Import stats component

@customElement('game-component')
export class GameComponent extends LitElement {
  @query('#canvas')
  private canvas!: HTMLCanvasElement;
  
  // Camera variables - exposed as properties to allow stats component to access
  @property({ attribute: false })
  public scene?: THREE.Scene;
  
  @property({ attribute: false })
  public camera?: THREE.PerspectiveCamera;
  
  @property({ attribute: false })
  public renderer?: THREE.WebGLRenderer;
  
  private animationFrameId?: number;
  
  // Tank instances
  private playerTank?: Tank;
  private npcTanks: NPCTank[] = [];
  private readonly NUM_NPC_TANKS = 6; // Reduced from 10 for better performance
  
  // Performance settings
  private lowPerformanceMode = false;
  private lodDistance = 300; // Distance at which to switch to lower detail
  
  // Collision system
  private collisionSystem: CollisionSystem = new CollisionSystem();
  private mapGenerator?: MapGenerator;
  
  // Control state
  private keys: { [key: string]: boolean } = {};
  
  // Assets
  // Sky gradient colors
  private skyColor: THREE.Color = new THREE.Color(0x87ceeb); // Sky blue

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
    
    canvas {
      width: 100%;
      height: 100%;
      display: block;
    }

    .controls {
      position: absolute;
      bottom: 10px;
      left: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 10px;
      border-radius: 5px;
      font-family: monospace;
      pointer-events: none;
    }
  `;

  render() {
    return html`
      <canvas id="canvas"></canvas>
      <game-stats></game-stats>
      <div class="controls">
        <div>W: Forward, S: Backward</div>
        <div>A: Rotate tank left, D: Rotate tank right</div>
        <div>←/→: Rotate turret left/right</div>
        <div>↑/↓: Raise/lower barrel</div>
      </div>
    `;
  }

  firstUpdated() {
    this.initThree();
    this.initKeyboardControls();
    this.animate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    
    // Remove event listeners
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('resize', this.handleResize);
    
    // Clean up Tank resources
    if (this.playerTank) {
      this.collisionSystem.removeCollider(this.playerTank);
      this.playerTank.dispose();
    }
    
    // Clean up NPC tank resources
    for (const tank of this.npcTanks) {
      this.collisionSystem.removeCollider(tank);
      tank.dispose();
    }
    
    // Clean up Three.js resources
    this.renderer?.dispose();
  }

  private initThree() {
    // Create scene with a blue sky background
    this.scene = new THREE.Scene();
    this.scene.background = this.skyColor;
    
    // Use exponential fog for better performance and appearance
    this.scene.fog = new THREE.FogExp2(this.skyColor.clone().multiplyScalar(1.2), 0.0005);
    
    // Create skybox
    this.createSkybox();
    
    // Create camera with optimized far plane for performance
    this.camera = new THREE.PerspectiveCamera(
      60,
      this.canvas.clientWidth / this.canvas.clientHeight,
      0.1,
      2000 // Reduced far plane for better performance
    );
    
    // Create optimized renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false, // Disable antialias for better performance
      powerPreference: 'high-performance',
      precision: 'mediump' // Use medium precision for better performance
    });
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    
    // Limit pixel ratio to 2 to prevent excessive rendering on high-DPI displays
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(pixelRatio);
    
    // Completely disable shadows for maximum performance
    this.renderer.shadowMap.enabled = false;
    
    // Enable renderer optimizations
    this.renderer.sortObjects = true;
    this.renderer.physicallyCorrectLights = false;
    
    // Simplified lighting setup for better performance
    
    // Main directional light (sun) - no shadows
    const directionalLight = new THREE.DirectionalLight(0xffffcc, 0.8);
    directionalLight.position.set(100, 200, 50);
    
    // Disable shadow casting for this light (major performance boost)
    directionalLight.castShadow = false;
    
    // Secondary directional light for more even lighting from opposite side
    const secondaryLight = new THREE.DirectionalLight(0xaaccff, 0.3);
    secondaryLight.position.set(-50, 100, -80);
    
    // Stronger ambient light since we're not using shadows
    const ambientLight = new THREE.AmbientLight(0x999999, 0.7);
    
    // Hemisphere light for more natural sky/ground lighting
    const hemisphereLight = new THREE.HemisphereLight(
      0x87ceeb, // Sky color - light blue
      0x505000,  // Ground color - olive
      0.6        // Intensity
    );
    
    this.scene.add(directionalLight);
    this.scene.add(secondaryLight);
    this.scene.add(ambientLight);
    this.scene.add(hemisphereLight);
    
    // Create ground with optimized geometry and material
    const groundSize = 5000; // Reduced from 10000
    const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
    
    // Use MeshLambertMaterial instead of MeshStandardMaterial for better performance
    const groundMaterial = new THREE.MeshLambertMaterial({ 
      color: 0x4DA65B, // Slightly darker green
    });
    
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = false; // No shadows
    this.scene.add(ground);
    
    // Create map generator
    this.mapGenerator = new MapGenerator(this.scene);
    
    // Create environment objects
    this.createTrees();
    this.createRocks();
    
    // Create player tank
    this.playerTank = new Tank(this.scene, this.camera);
    this.collisionSystem.addCollider(this.playerTank);
    
    // Create NPC tanks
    this.createNpcTanks();
    
    // Position camera
    this.positionCamera();
    
    // Handle window resize
    window.addEventListener('resize', this.handleResize.bind(this));
  }
  
  private createTrees() {
    if (!this.scene || !this.mapGenerator) return;
    
    // Build the tree layout
    this.mapGenerator.createTrees();
    
    // Add tree colliders to the collision system
    const treeColliders = this.mapGenerator.getAllColliders();
    for (const collider of treeColliders) {
      this.collisionSystem.addCollider(collider);
    }
  }
  
  private createRocks() {
    if (!this.scene || !this.mapGenerator) return;
    
    // Build the rock layout
    this.mapGenerator.createRocks();
    
    // Add rock colliders to the collision system - already done via getAllColliders in createTrees
  }
  
  private createSkybox() {
    if (!this.scene) return;
    
    // Add hemisphere light for ambient sky lighting
    const skyLight = new THREE.HemisphereLight(
      0x87ceeb, // Sky color
      0x91e160, // Ground color (green tint)
      1.0       // Intensity
    );
    this.scene.add(skyLight);
  }
  
  
  private createNpcTanks() {
    if (!this.scene) return;
    
    // Tank colors
    const colors = [
      0x3366cc, // Blue
      0xdc3912, // Red
      0xff9900, // Orange
      0x109618, // Green
      0x990099, // Purple
      0x0099c6, // Teal
      0xdd4477, // Pink
      0x66aa00, // Lime
      0xb82e2e, // Dark red
      0x316395  // Dark blue
    ];
    
    // Clear any existing NPC tanks
    for (const tank of this.npcTanks) {
      this.collisionSystem.removeCollider(tank);
      tank.dispose();
    }
    this.npcTanks = [];
    
    // Create new NPC tanks at random positions around the map
    for (let i = 0; i < this.NUM_NPC_TANKS; i++) {
      // Random position in a circle around origin (200-500 units away)
      const angle = Math.random() * Math.PI * 2;
      const distance = 200 + Math.random() * 300;
      const position = new THREE.Vector3(
        Math.cos(angle) * distance,
        0,
        Math.sin(angle) * distance
      );
      
      // Create tank with color from the colors array
      const npcTank = new NPCTank(
        this.scene,
        position,
        colors[i % colors.length]
      );
      
      // Add tank to the collision system
      this.collisionSystem.addCollider(npcTank);
      
      this.npcTanks.push(npcTank);
    }
  }
  
  private positionCamera() {
    if (!this.camera || !this.playerTank) return;
    
    // Position camera behind and above the tank
    this.camera.position.set(0, 6, -8);
    this.camera.lookAt(this.playerTank.tank.position);
  }
  
  private initKeyboardControls() {
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }
  
  private handleKeyDown(event: KeyboardEvent) {
    const key = event.key.toLowerCase();
    this.keys[key] = true;
    
    // Special handling for space key
    if (key === ' ' || key === 'space') {
      this.keys['space'] = true;
    }
    
    // Log key pressed for debugging
    console.log('Key down:', key, 'KeyCode:', event.keyCode);
    console.log('Current active keys:', this.keys);
    
    // Prevent default for arrow keys, WASD, and Space to avoid page scrolling/browser shortcuts
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', ' ', 'space'].includes(key)) {
      event.preventDefault();
    }
  }
  
  private handleKeyUp(event: KeyboardEvent) {
    const key = event.key.toLowerCase();
    this.keys[key] = false;
    
    // Special handling for space key
    if (key === ' ' || key === 'space') {
      this.keys['space'] = false;
    }
    
    console.log('Key up:', key);
  }
  
  
  
  
  
  private handleResize() {
    if (!this.camera || !this.renderer) return;
    
    this.camera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
  }

  private animate() {
    this.animationFrameId = requestAnimationFrame(this.animate.bind(this));
    
    // Performance monitoring (shadows completely disabled now)
    if (this.renderer && this.renderer.info && this.renderer.info.render) {
      // Calculate current FPS for the stats display
      const fps = 1000 / (this.renderer.info.render.frame || 16.7);
      
      // Check if we're getting low FPS and should reduce update frequency of distant objects
      this.lowPerformanceMode = fps < 30;
    }
    
    // Run the collision system check
    this.collisionSystem.checkCollisions();
    
    // Get all colliders for movement updates
    const allColliders = this.collisionSystem.getColliders();
    
    // Update player tank with current key states
    if (this.playerTank) {
      this.playerTank.update(this.keys, allColliders);
      
      // Update camera position to follow tank
      if (this.camera) {
        this.playerTank.updateCamera(this.camera);
      }
    }
    
    // Update all NPC tanks, apply LOD (level of detail) based on distance and performance
    for (const npcTank of this.npcTanks) {
      // Get distance to player
      const distanceToPlayer = this.playerTank?.tank.position.distanceTo(npcTank.tank.position) || 0;
      
      // Determine update frequency based on distance and performance mode
      if (distanceToPlayer < this.lodDistance) {
        // Close tanks always update
        npcTank.update({}, allColliders);
      } else if (distanceToPlayer < this.lodDistance * 2) {
        // Mid-range tanks
        if (!this.lowPerformanceMode || Math.random() < 0.5) { // 50% chance in low performance mode
          npcTank.update({}, allColliders);
        }
      } else {
        // Distant tanks update very infrequently
        const updateChance = this.lowPerformanceMode ? 0.1 : 0.2; // 10% or 20% chance based on performance
        if (Math.random() < updateChance) {
          npcTank.update({}, allColliders);
        }
      }
    }
    
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'game-component': GameComponent;
  }
}