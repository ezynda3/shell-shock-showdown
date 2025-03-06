import { LitElement, html, css } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import * as THREE from 'three';
import { MapGenerator } from './map';
import { Tank } from './tank';

@customElement('game-component')
export class GameComponent extends LitElement {
  @query('#canvas')
  private canvas!: HTMLCanvasElement;
  
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private renderer?: THREE.WebGLRenderer;
  private animationFrameId?: number;
  
  // Tank instance
  private tankInstance?: Tank;
  
  // Control state
  private keys: { [key: string]: boolean } = {};
  
  // Assets
  private skyTexture?: THREE.Texture;

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
        <div>Space: Fire shell</div>
      </div>
    `;
  }

  firstUpdated() {
    this.loadTextures().then(() => {
      this.initThree();
      this.initKeyboardControls();
      this.animate();
    });
  }
  
  private async loadTextures() {
    // Try to load sky texture from the hidden img element first
    const skyImg = document.getElementById('skyImage') as HTMLImageElement;
    
    if (skyImg && skyImg.complete) {
      // Image is already loaded
      const textureLoader = new THREE.TextureLoader();
      this.skyTexture = textureLoader.load(skyImg.src);
      return Promise.resolve();
    } else {
      // Fallback to loading directly
      const textureLoader = new THREE.TextureLoader();
      
      return new Promise<void>((resolve) => {
        textureLoader.load(
          'https://assetstorev1-prd-cdn.unity3d.com/package-screenshot/2fe480c2-6fb9-43da-86cf-bc843b7d7761_scaled.jpg', 
          (texture) => {
            this.skyTexture = texture;
            resolve();
          },
          undefined, // onProgress
          () => {
            // On error, create a blue sky
            console.error('Failed to load sky texture, using fallback');
            this.skyTexture = undefined;
            resolve();
          }
        );
      });
    }
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
    this.tankInstance?.dispose();
    
    // Clean up Three.js resources
    this.renderer?.dispose();
    this.skyTexture?.dispose();
  }

  private initThree() {
    // Create scene
    this.scene = new THREE.Scene();
    
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
    
    // Add lights
    const ambientLight = new THREE.AmbientLight(0x666666);
    this.scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 10, 7.5);
    directionalLight.castShadow = true;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 30;
    directionalLight.shadow.camera.left = -10;
    directionalLight.shadow.camera.right = 10;
    directionalLight.shadow.camera.top = 10;
    directionalLight.shadow.camera.bottom = -10;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
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
    
    // Create tank
    this.tankInstance = new Tank(this.scene, this.camera);
    
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
    
    // Create a much larger sphere to serve as our sky
    const skyGeometry = new THREE.SphereGeometry(50000, 32, 32);
    // Invert the geometry so that the faces point inward
    skyGeometry.scale(-1, 1, 1);
    
    let skyMaterial: THREE.Material;
    
    if (this.skyTexture) {
      // Use the loaded texture for the sky
      skyMaterial = new THREE.MeshBasicMaterial({
        map: this.skyTexture,
        side: THREE.BackSide,
      });
    } else {
      // Fallback to a gradient sky if texture loading failed
      const vertexShader = `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `;
      
      const fragmentShader = `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + offset).y;
          gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
        }
      `;
      
      const uniforms = {
        topColor: { value: new THREE.Color(0x0077ff) },  // Blue sky
        bottomColor: { value: new THREE.Color(0xffffff) },  // Horizon white
        offset: { value: 33 },
        exponent: { value: 0.6 }
      };
      
      skyMaterial = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        side: THREE.BackSide
      });
    }
    
    const sky = new THREE.Mesh(skyGeometry, skyMaterial);
    this.scene.add(sky);
  }
  
  
  private positionCamera() {
    if (!this.camera || !this.tankInstance) return;
    
    // Position camera behind and above the tank
    this.camera.position.set(0, 6, -8);
    this.camera.lookAt(this.tankInstance.tank.position);
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
    
    // Update tank with current key states
    if (this.tankInstance) {
      this.tankInstance.update(this.keys);
      
      // Update camera position to follow tank
      if (this.camera) {
        this.tankInstance.updateCamera(this.camera);
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