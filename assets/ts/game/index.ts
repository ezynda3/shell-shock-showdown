import { LitElement, html, css } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import * as THREE from 'three';
import { MapGenerator } from './map';
import { Tank, NPCTank, ITank } from './tank';

@customElement('game-component')
export class GameComponent extends LitElement {
  @query('#canvas')
  private canvas!: HTMLCanvasElement;
  
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private renderer?: THREE.WebGLRenderer;
  private animationFrameId?: number;
  
  // Tank instances
  private playerTank?: Tank;
  private npcTanks: NPCTank[] = [];
  private readonly NUM_NPC_TANKS = 10;
  
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
    this.playerTank?.dispose();
    
    // Clean up NPC tank resources
    for (const tank of this.npcTanks) {
      tank.dispose();
    }
    
    // Clean up Three.js resources
    this.renderer?.dispose();
  }

  private initThree() {
    // Create scene with a blue sky background
    this.scene = new THREE.Scene();
    this.scene.background = this.skyColor;
    this.scene.fog = new THREE.Fog(this.skyColor.clone().multiplyScalar(1.2), 1000, 50000);
    
    // Create skybox
    this.createSkybox();
    
    // Create camera with increased far plane for larger world
    this.camera = new THREE.PerspectiveCamera(
      60,
      this.canvas.clientWidth / this.canvas.clientHeight,
      0.1,
      100000 // Much larger far plane for the bigger world
    );
    
    // Create renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true
    });
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    
    // Add directional sunlight
    const directionalLight = new THREE.DirectionalLight(0xffffcc, 1.2);
    directionalLight.position.set(100, 200, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.camera.left = -30;
    directionalLight.shadow.camera.right = 30;
    directionalLight.shadow.camera.top = 30;
    directionalLight.shadow.camera.bottom = -30;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    this.scene.add(directionalLight);
    
    // Create ground (100x larger)
    const groundGeometry = new THREE.PlaneGeometry(10000, 10000);
    const groundMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x4DA65B, // Slightly darker green
      roughness: 0.8,
      metalness: 0.1
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    
    // Create environment objects
    this.createTrees();
    this.createRocks();
    
    // Create player tank
    this.playerTank = new Tank(this.scene, this.camera);
    
    // Create NPC tanks
    this.createNpcTanks();
    
    // Position camera
    this.positionCamera();
    
    // Handle window resize
    window.addEventListener('resize', this.handleResize.bind(this));
  }
  
  private createTrees() {
    if (!this.scene) return;
    
    // Create a map generator and build the tree layout
    const mapGenerator = new MapGenerator(this.scene);
    mapGenerator.createTrees();
  }
  
  private createRocks() {
    if (!this.scene) return;
    
    // Create a map generator and build the rock layout
    const mapGenerator = new MapGenerator(this.scene);
    mapGenerator.createRocks();
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
    
    // Update player tank with current key states
    if (this.playerTank) {
      this.playerTank.update(this.keys);
      
      // Update camera position to follow tank
      if (this.camera) {
        this.playerTank.updateCamera(this.camera);
      }
    }
    
    // Update all NPC tanks
    for (const npcTank of this.npcTanks) {
      npcTank.update();
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