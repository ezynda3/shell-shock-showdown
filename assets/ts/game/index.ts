import { LitElement, html, css } from 'lit';
import { customElement, query, property } from 'lit/decorators.js';
import * as THREE from 'three';
import { MapGenerator } from './map';
import { Tank, NPCTank, ITank, ICollidable } from './tank';
import { CollisionSystem } from './collision';
import { Shell } from './shell';
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
  private readonly NUM_NPC_TANKS = 30; // Increased from 6 for a more exciting battlefield
  
  // Performance settings
  private lowPerformanceMode = false;
  private lodDistance = 300; // Distance at which to switch to lower detail
  
  // Collision system
  private collisionSystem: CollisionSystem = new CollisionSystem();
  private mapGenerator?: MapGenerator;
  
  // Shells management
  private activeShells: Shell[] = [];
  
  // Game state
  private playerDestroyed = false;
  private respawnTimer = 0;
  private readonly RESPAWN_TIME = 300; // 5 seconds at 60fps
  private playerKills = 0;
  private playerDeaths = 0;
  
  // Visual effect states
  private showDamageOverlay = false;
  private cameraShaking = false;
  private lastPlayerHealth = 100;
  
  // Crosshair as a THREE.js object
  private crosshairObject?: THREE.Object3D;
  
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
      position: relative;
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
    
    .game-over {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
      pointer-events: none;
      transition: opacity 0.5s ease-in-out;
      opacity: 0;
      background-color: rgba(0, 0, 0, 0.3);
    }
    
    .game-over.visible {
      opacity: 1;
    }
    
    .wasted-text {
      font-family: "Pricedown", Impact, sans-serif;
      font-size: 8rem;
      color: #FF0000;
      text-transform: uppercase;
      text-shadow: 3px 3px 5px rgba(0, 0, 0, 0.8);
      transform: skewY(-5deg);
      letter-spacing: 5px;
      animation: pulse 2s infinite;
    }
    
    @keyframes pulse {
      0% { opacity: 0.8; transform: scale(1) skewY(-5deg); }
      50% { opacity: 1; transform: scale(1.05) skewY(-5deg); }
      100% { opacity: 0.8; transform: scale(1) skewY(-5deg); }
    }
    
    .damage-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      background-color: rgba(255, 0, 0, 0);
      transition: background-color 0.2s ease-in-out;
      z-index: 1000;
    }
    
    .damage-overlay.active {
      background-color: rgba(255, 0, 0, 0.3);
      animation: fade-out 0.5s ease-in-out forwards;
    }
    
    @keyframes fade-out {
      0% { background-color: rgba(255, 0, 0, 0.3); }
      100% { background-color: rgba(255, 0, 0, 0); }
    }
    
    
    .camera-shake {
      animation: shake 0.25s ease-in-out;
    }
    
    .camera-shake-death {
      animation: shake-death 1.0s ease-in-out;
    }
    
    @keyframes shake {
      0% { transform: translate(0, 0); }
      10% { transform: translate(-5px, -5px); }
      20% { transform: translate(5px, 5px); }
      30% { transform: translate(-5px, 5px); }
      40% { transform: translate(5px, -5px); }
      50% { transform: translate(-5px, 0); }
      60% { transform: translate(5px, 5px); }
      70% { transform: translate(-5px, -5px); }
      80% { transform: translate(0, 5px); }
      90% { transform: translate(-5px, 0); }
      100% { transform: translate(0, 0); }
    }
    
    @keyframes shake-death {
      0% { transform: translate(0, 0) rotate(0deg); }
      10% { transform: translate(-10px, -10px) rotate(-1deg); }
      20% { transform: translate(10px, 10px) rotate(1deg); }
      30% { transform: translate(-10px, 10px) rotate(-1deg); }
      40% { transform: translate(10px, -10px) rotate(1deg); }
      50% { transform: translate(-10px, -5px) rotate(-0.5deg); }
      60% { transform: translate(10px, 5px) rotate(0.5deg); }
      70% { transform: translate(-10px, -10px) rotate(-1deg); }
      80% { transform: translate(10px, 10px) rotate(1deg); }
      90% { transform: translate(-5px, 5px) rotate(-0.5deg); }
      100% { transform: translate(0, 0) rotate(0deg); }
    }
  `;

  render() {
    return html`
      <div>
        <div class="${this.cameraShaking ? 'camera-shake' : ''}">
          <canvas id="canvas"></canvas>
          <div class="damage-overlay ${this.showDamageOverlay ? 'active' : ''}"></div>
          
          <game-stats></game-stats>
          <div class="controls">
            <div>W: Forward, S: Backward</div>
            <div>A: Rotate tank left, D: Rotate tank right</div>
            <div>Mouse: Aim turret and barrel</div>
            <div>Arrow keys: Alternative turret control</div>
            <div>Left Click, Space, or F: Fire shell</div>
            <div>Click canvas to lock pointer</div>
          </div>
          <div class="game-over ${this.playerDestroyed ? 'visible' : ''}">
            <div class="wasted-text">Wasted</div>
          </div>
        </div>
      </div>
    `;
  }

  firstUpdated() {
    this.initThree();
    this.initKeyboardControls();
    this.animate();
    
    // Listen for tank destroyed events
    this.handleTankDestroyed = this.handleTankDestroyed.bind(this);
    document.addEventListener('tank-destroyed', this.handleTankDestroyed);
    
    // Listen for tank hit events
    this.handleTankHit = this.handleTankHit.bind(this);
    document.addEventListener('tank-hit', this.handleTankHit);
    
    // Initialize game stats
    this.updateStats();
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
    document.removeEventListener('tank-destroyed', this.handleTankDestroyed);
    document.removeEventListener('tank-hit', this.handleTankHit);
    
    // Remove pointer lock related event listeners
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    document.removeEventListener('mozpointerlockchange', this.handlePointerLockChange);
    document.removeEventListener('webkitpointerlockchange', this.handlePointerLockChange);
    
    // Remove mouse events from both document and canvas
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mousedown', this.handleMouseDown);
    document.removeEventListener('mouseup', this.handleMouseUp);
    
    // Remove canvas-specific event listeners
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('mouseup', this.handleMouseUp);
    
    // Exit pointer lock if active
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
    
    // Remove crosshair from camera
    if (this.crosshairObject && this.camera) {
      this.camera.remove(this.crosshairObject);
      this.crosshairObject = undefined;
    }
    
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
    
    // Clean up shell resources
    for (const shell of this.activeShells) {
      this.collisionSystem.removeCollider(shell);
      // Shells don't have a dispose method since they're removed in the update cycle
    }
    this.activeShells = [];
    
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
    
    // Add camera to scene immediately
    this.scene.add(this.camera);
    
    // Update scene matrices
    this.scene.updateMatrixWorld(true);
    
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
    
    // Create player tank at a random valid position
    const spawnPoint = this.findRandomSpawnPoint();
    this.playerTank = new Tank(this.scene, this.camera);
    this.playerTank.respawn(spawnPoint); // Set initial position
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
    const treeColliders = this.mapGenerator.getTreeColliders();
    for (const collider of treeColliders) {
      this.collisionSystem.addCollider(collider);
    }
  }
  
  private createRocks() {
    if (!this.scene || !this.mapGenerator) return;
    
    // Build the rock layout
    this.mapGenerator.createRocks();
    
    // Add rock colliders to the collision system
    const rockColliders = this.mapGenerator.getRockColliders();
    for (const collider of rockColliders) {
      this.collisionSystem.addCollider(collider);
    }
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
      0x316395, // Dark blue
      0x94621a, // Brown
      0xc45bdd, // Light purple
      0x5b91dd, // Light blue
      0xdd5b5b, // Light red
      0x777777  // Gray
    ];
    
    // Clear any existing NPC tanks
    for (const tank of this.npcTanks) {
      this.collisionSystem.removeCollider(tank);
      tank.dispose();
    }
    this.npcTanks = [];
    
    // Create new NPC tanks at random positions around the map
    for (let i = 0; i < this.NUM_NPC_TANKS; i++) {
      // Random position in a wider circle around origin (200-800 units away)
      const angle = Math.random() * Math.PI * 2;
      const distance = 200 + Math.random() * 600;
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
    
    // Create crosshair if it doesn't exist
    if (!this.crosshairObject) {
      this.createCrosshair();
    }
  }
  
  private createCrosshair() {
    if (!this.scene || !this.camera) return;
    
    // Create a simple plus-shaped crosshair using lines
    const crosshairSize = 0.5; // 50% smaller than the previous size
    const crosshairMaterial = new THREE.LineBasicMaterial({ 
      color: 0xffffff,   // White
      linewidth: 3,      // Thicker lines (note: may not work in WebGL)
      depthTest: false,  // Ensures it's always drawn on top of other objects
      depthWrite: false, // Doesn't write to depth buffer
      transparent: true,
      opacity: 0.9
    });
    
    // Create the crosshair geometry
    const crosshairGeometry = new THREE.BufferGeometry();
    
    // Define the vertices for a plus shape
    const vertices = new Float32Array([
      // Horizontal line
      -crosshairSize, 0, 0,
      crosshairSize, 0, 0,
      
      // Vertical line
      0, -crosshairSize, 0,
      0, crosshairSize, 0
    ]);
    
    crosshairGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    
    // Create the crosshair line segments
    const crosshair = new THREE.LineSegments(crosshairGeometry, crosshairMaterial);
    
    // Set extremely high render order to ensure it renders on top of everything
    crosshair.renderOrder = 9999;
    
    // Create a container for the crosshair
    this.crosshairObject = new THREE.Object3D();
    this.crosshairObject.add(crosshair);
    
    // Add to scene with special layer if needed
    this.scene.add(this.crosshairObject);
    
    // Initial position update
    this.updateCrosshairPosition();
    
    console.log("THREE.js crosshair created - will follow barrel direction");
  }
  
  private updateCrosshairPosition() {
    if (!this.playerTank || !this.crosshairObject || !this.scene) return;
    
    // Distance to project the crosshair
    const distance = 50; // Units in front of barrel
    
    // Get barrel end position and firing direction 
    // (Similar to the logic in Tank.fireShell method)
    // Use a fixed offset value since we don't have direct access to Tank's BARREL_END_OFFSET
    const barrelEndPosition = new THREE.Vector3(0, 0, 1.5); // 1.5 matches Tank.BARREL_END_OFFSET
    
    // Apply barrel elevation
    barrelEndPosition.applyEuler(new THREE.Euler(
      this.playerTank.barrelPivot.rotation.x,
      0,
      0
    ));
    
    // Apply turret rotation
    barrelEndPosition.applyEuler(new THREE.Euler(
      0,
      this.playerTank.turretPivot.rotation.y,
      0
    ));
    
    // Apply tank rotation and position
    barrelEndPosition.applyEuler(new THREE.Euler(
      0,
      this.playerTank.tank.rotation.y,
      0
    ));
    
    // Add to tank and turret position
    barrelEndPosition.add(this.playerTank.turretPivot.position.clone().add(this.playerTank.tank.position));
    
    // Calculate firing direction
    const direction = new THREE.Vector3(0, 0, 1); // Forward vector
    
    // Apply barrel elevation
    direction.applyEuler(new THREE.Euler(
      this.playerTank.barrelPivot.rotation.x,
      0,
      0
    ));
    
    // Apply turret rotation
    direction.applyEuler(new THREE.Euler(
      0,
      this.playerTank.turretPivot.rotation.y,
      0
    ));
    
    // Apply tank rotation
    direction.applyEuler(new THREE.Euler(
      0,
      this.playerTank.tank.rotation.y,
      0
    ));
    
    // Normalize direction vector
    direction.normalize();
    
    // Calculate crosshair position by extending from barrel end
    // in the direction the barrel is pointing
    const crosshairPosition = barrelEndPosition.clone().add(
      direction.multiplyScalar(distance)
    );
    
    // Update crosshair position
    this.crosshairObject.position.copy(crosshairPosition);
    
    // Make the crosshair face the camera
    if (this.camera) {
      this.crosshairObject.lookAt(this.camera.position);
    }
  }
  
  // Pointer lock variables
  private isPointerLocked = false;
  private mouseX = 0;
  private mouseY = 0;
  
  private initKeyboardControls() {
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handlePointerLockChange = this.handlePointerLockChange.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    
    window.addEventListener('keydown', this.handleKeyDown, { capture: true });
    window.addEventListener('keyup', this.handleKeyUp, { capture: true });
    
    // Initialize space key to false explicitly
    this.keys['space'] = false;
    this.keys[' '] = false;
    this.keys['f'] = false;
    this.keys['mousefire'] = false;
    
    // Set up pointer lock
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    document.addEventListener('mozpointerlockchange', this.handlePointerLockChange);
    document.addEventListener('webkitpointerlockchange', this.handlePointerLockChange);
    
    // Wait for the firstUpdated to complete to ensure canvas is available
    setTimeout(() => {
      console.log('Setting up mouse events on canvas', this.canvas);
      
      // Add click handler to canvas for requesting pointer lock
      this.canvas.addEventListener('click', () => {
        console.log('Canvas clicked, requesting pointer lock');
        if (!this.isPointerLocked) {
          try {
            this.canvas.requestPointerLock();
          } catch (e) {
            console.error('Error requesting pointer lock:', e);
          }
        }
      });
      
      // Add mouse handlers directly to the canvas for better event capture
      this.canvas.addEventListener('mousemove', this.handleMouseMove);
      this.canvas.addEventListener('mousedown', this.handleMouseDown);
      this.canvas.addEventListener('mouseup', this.handleMouseUp);
      
      // Also add to document as fallback
      document.addEventListener('mousemove', this.handleMouseMove);
      document.addEventListener('mousedown', this.handleMouseDown);
      document.addEventListener('mouseup', this.handleMouseUp);
    }, 100);
  }
  
  private handleKeyDown(event: KeyboardEvent) {
    const key = event.key.toLowerCase();
    this.keys[key] = true;
    
    // Special handling for space key
    if (key === ' ' || key === 'space') {
      console.log('SPACE KEY PRESSED');
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
  
  private handlePointerLockChange() {
    // Check if the pointer is now locked
    this.isPointerLocked = 
      document.pointerLockElement === this.canvas ||
      (document as any).mozPointerLockElement === this.canvas ||
      (document as any).webkitPointerLockElement === this.canvas;
    
    // Force UI update
    this.requestUpdate();
    
    console.log('Pointer lock state changed:', this.isPointerLocked ? 'locked' : 'unlocked');
  }
  
  private handleMouseMove(event: MouseEvent) {
    // Log mouse movement even when not locked for debugging
    console.log('Mouse move event received', {
      movementX: event.movementX,
      movementY: event.movementY,
      isPointerLocked: this.isPointerLocked,
      hasPlayerTank: !!this.playerTank
    });
    
    // Skip actual turret movement if not pointer locked
    if (!this.playerTank) return;
    
    // Get mouse movement deltas
    const movementX = event.movementX || (event as any).mozMovementX || (event as any).webkitMovementX || 0;
    const movementY = event.movementY || (event as any).mozMovementY || (event as any).webkitMovementY || 0;
    
    // Update mouse position
    this.mouseX += movementX;
    this.mouseY += movementY;
    
    // Apply turret rotation based on mouse X movement even when not locked (for testing)
    // A sensitivity factor to adjust how fast the turret rotates
    const turretSensitivity = 0.003;
    if (this.playerTank.turretPivot) {
      this.playerTank.turretPivot.rotation.y -= movementX * turretSensitivity;
    }
    
    // Apply barrel elevation based on mouse Y movement
    const barrelSensitivity = 0.002;
    if (this.playerTank.barrelPivot) {
      // Note: We limit the barrel elevation in the Tank class
      this.playerTank.barrelPivot.rotation.x = Math.max(
        this.playerTank.getMinBarrelElevation(),
        Math.min(
          this.playerTank.getMaxBarrelElevation(),
          this.playerTank.barrelPivot.rotation.x + movementY * barrelSensitivity
        )
      );
    }
  }
  
  private handleMouseDown(event: MouseEvent) {
    // Log all mouse down events for debugging
    console.log('Mouse down event received', {
      button: event.button,
      isPointerLocked: this.isPointerLocked
    });
    
    // Handle left mouse button (button 0) even when not locked (for testing)
    if (event.button === 0) {
      this.keys['mousefire'] = true;
    }
  }
  
  private handleMouseUp(event: MouseEvent) {
    // Log all mouse up events for debugging
    console.log('Mouse up event received', {
      button: event.button,
      isPointerLocked: this.isPointerLocked
    });
    
    // Only handle left mouse button (button 0)
    if (event.button === 0) {
      this.keys['mousefire'] = false;
    }
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
    
    // Store camera position for health bar billboarding
    if (this.camera) {
      (window as any).cameraPosition = this.camera.position;
    }
    
    // Update crosshair position to align with tank barrel
    this.updateCrosshairPosition();
    
    // Run the collision system check
    this.collisionSystem.checkCollisions();
    
    // Get all colliders for movement updates
    const allColliders = this.collisionSystem.getColliders();
    
    // Update player tank with current key states
    if (this.playerTank) {
      if (this.playerDestroyed) {
        // If player is destroyed, handle respawn timer
        this.respawnTimer++;
        if (this.respawnTimer >= this.RESPAWN_TIME) {
          // Time to respawn at a random valid position
          const spawnPoint = this.findRandomSpawnPoint();
          this.playerTank.respawn(spawnPoint);
          this.playerDestroyed = false;
          this.respawnTimer = 0;
          
          // Force UI refresh
          this.requestUpdate();
        }
      } else {
        // Update tank and check if shell was fired
        const newShell = this.playerTank.update(this.keys, allColliders);
        if (newShell) {
          console.log('New shell created, adding to game');
          this.addShell(newShell);
        }
      }
      
      // Always update camera, even when destroyed
      if (this.camera) {
        this.playerTank.updateCamera(this.camera);
      }
      
      // Update stats for health changes
      this.updateStats();
    }
    
    // Update player health tracking
    if (this.playerTank) {
      const currentHealth = this.playerTank.getHealth();
      
      // If health decreased (but not destroyed), show damage effects
      // This is a fallback in case the tank-hit event doesn't fire for some reason
      if (currentHealth < this.lastPlayerHealth && !this.playerDestroyed) {
        console.log(`Health decreased from ${this.lastPlayerHealth} to ${currentHealth}`);
        this.showPlayerHitEffects();
      }
      
      this.lastPlayerHealth = currentHealth;
    }
    
    // Update all NPC tanks, apply LOD (level of detail) based on distance and performance
    for (const npcTank of this.npcTanks) {
      // Get distance to player
      const distanceToPlayer = this.playerTank?.tank.position.distanceTo(npcTank.tank.position) || 0;
      
      // Determine update frequency based on distance and performance mode
      let newShell: Shell | null = null;
      
      if (distanceToPlayer < this.lodDistance) {
        // Close tanks always update
        newShell = npcTank.update({}, allColliders);
      } else if (distanceToPlayer < this.lodDistance * 2) {
        // Mid-range tanks
        if (!this.lowPerformanceMode || Math.random() < 0.5) { // 50% chance in low performance mode
          newShell = npcTank.update({}, allColliders);
        }
      } else {
        // Distant tanks update very infrequently
        const updateChance = this.lowPerformanceMode ? 0.1 : 0.2; // 10% or 20% chance based on performance
        if (Math.random() < updateChance) {
          newShell = npcTank.update({}, allColliders);
        }
      }
      
      // Add new shell if one was fired
      if (newShell) {
        this.addShell(newShell);
      }
    }
    
    // Update all active shells and handle collisions
    this.updateShells(allColliders);
    
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }
  
  private addShell(shell: Shell): void {
    // Add shell to active shells array
    this.activeShells.push(shell);
    
    // Add shell to collision system
    this.collisionSystem.addCollider(shell);
  }
  
  private updateShells(colliders: ICollidable[]): void {
    // Update each active shell
    for (let i = this.activeShells.length - 1; i >= 0; i--) {
      const shell = this.activeShells[i];
      
      // Check if shell is already inactive
      if (!shell.isAlive()) {
        this.collisionSystem.removeCollider(shell);
        this.activeShells.splice(i, 1);
        continue;
      }
      
      // Update the shell and check if it's still active
      const isActive = shell.update();
      
      // If shell is no longer active, remove it
      if (!isActive) {
        this.collisionSystem.removeCollider(shell);
        this.activeShells.splice(i, 1);
      }
    }
  }
  
  // Removed old showDamageEffect - replaced by showPlayerHitEffects
  
  // Handle damage events for all tanks
  private handleTankHit(event: CustomEvent) {
    const { tank, source, damageAmount } = event.detail;
    
    // Check if this is the player tank
    if (tank === this.playerTank) {
      console.log(`Player tank hit for ${damageAmount} damage!`);
      
      // Show hit effects
      this.showPlayerHitEffects();
      
      // Update stats
      this.updateStats();
    }
  }
  
  /**
   * Shows visual and audio effects when player is hit
   * Applies red overlay tint and camera shake
   */
  private showPlayerHitEffects() {
    // Apply red overlay effect
    this.showDamageOverlay = true;
    
    // Apply camera shake
    this.cameraShaking = true;
    
    // Force immediate UI update
    this.requestUpdate();
    
    // Clear red overlay after a short delay
    setTimeout(() => {
      this.showDamageOverlay = false;
      this.requestUpdate();
    }, 500);
    
    // Clear camera shake after a shorter delay
    setTimeout(() => {
      this.cameraShaking = false;
      this.requestUpdate();
    }, 250);
  }

  private handleTankDestroyed(event: CustomEvent) {
    const { tank, source } = event.detail;
    
    // Check if this is the player tank
    if (tank === this.playerTank) {
      console.log('Player tank destroyed!');
      this.playerDestroyed = true;
      this.respawnTimer = 0;
      this.playerDeaths++;
      
      // Show death effects
      this.showPlayerDeathEffects();
      
      // Update stats
      this.updateStats();
    } else {
      // It's an NPC tank
      console.log('NPC tank destroyed!');
      
      // If destroyed by player, increment kill count
      if (source === this.playerTank) {
        this.playerKills++;
        this.updateStats();
      }
      
      // Find the NPC tank in our array
      const npcIndex = this.npcTanks.findIndex(npc => npc === tank);
      if (npcIndex !== -1) {
        // Respawn the NPC tank at a random location
        setTimeout(() => {
          this.npcTanks[npcIndex].respawn();
        }, 2000); // 2 second delay before respawn
      }
    }
  }
  
  /**
   * Find a random spawn point on the map that doesn't collide with other objects
   */
  private findRandomSpawnPoint(): THREE.Vector3 {
    const MAX_ATTEMPTS = 50; // Maximum number of attempts to find a valid spawn point
    const MAP_RADIUS = 800;  // Consider the playable area to be within this radius
    const MIN_DISTANCE_FROM_CENTER = 50; // Minimum distance from center to avoid starting too close
    
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Generate random position within the map radius
      const angle = Math.random() * Math.PI * 2;
      const distance = MIN_DISTANCE_FROM_CENTER + Math.random() * (MAP_RADIUS - MIN_DISTANCE_FROM_CENTER);
      
      const spawnPoint = new THREE.Vector3(
        Math.cos(angle) * distance,
        0, // Y is always 0 (ground level)
        Math.sin(angle) * distance
      );
      
      // Check if this position collides with any objects
      if (this.isValidSpawnPosition(spawnPoint)) {
        console.log(`Found valid spawn point at (${spawnPoint.x.toFixed(2)}, ${spawnPoint.z.toFixed(2)}) on attempt ${attempt + 1}`);
        return spawnPoint;
      }
    }
    
    // If we couldn't find a valid spawn point after MAX_ATTEMPTS, use a safe default
    console.warn(`Could not find valid spawn point after ${MAX_ATTEMPTS} attempts, using fallback position`);
    return new THREE.Vector3(0, 0, 0);
  }
  
  /**
   * Check if a position is valid for spawning (no collisions with other objects)
   */
  private isValidSpawnPosition(position: THREE.Vector3): boolean {
    // Create a temporary sphere collider to check for collisions
    const tempCollider = new THREE.Sphere(position.clone(), 3.0); // Larger than tank radius to ensure clearance
    
    // Check against all colliders in the system
    for (const collider of this.collisionSystem.getColliders()) {
      // Skip checking against player tank
      if (collider === this.playerTank) continue;
      
      const otherColliderObj = collider.getCollider();
      
      if (otherColliderObj instanceof THREE.Sphere) {
        // Sphere-Sphere collision
        const distance = position.distanceTo(collider.getPosition());
        if (distance < (tempCollider.radius + otherColliderObj.radius)) {
          return false; // Collision detected
        }
      } else if (otherColliderObj instanceof THREE.Box3) {
        // Sphere-Box collision
        if (otherColliderObj.intersectsSphere(tempCollider)) {
          return false; // Collision detected
        }
      }
    }
    
    return true; // No collisions found
  }
  
  /**
   * Shows dramatic death effects when player is killed
   * Includes stronger camera shake, red tint, and WASTED screen
   */
  private showPlayerDeathEffects() {
    // Show red overlay
    this.showDamageOverlay = true;
    
    // Apply death camera shake
    const canvasContainer = this.shadowRoot?.querySelector('#canvas').parentElement;
    if (canvasContainer) {
      canvasContainer.classList.remove('camera-shake');
      canvasContainer.classList.add('camera-shake-death');
      
      // Remove the death shake after a longer period
      setTimeout(() => {
        canvasContainer.classList.remove('camera-shake-death');
        this.requestUpdate();
      }, 1000);
    }
    
    // Force UI refresh to show WASTED screen
    this.requestUpdate();
  }
  
  private updateStats(): void {
    // Find stats component and update it
    const statsComponent = this.shadowRoot?.querySelector('game-stats');
    if (statsComponent) {
      const health = this.playerTank ? this.playerTank.getHealth() : 0;
      (statsComponent as any).updateGameStats(health, this.playerKills, this.playerDeaths);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'game-component': GameComponent;
  }
}