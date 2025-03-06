import { LitElement, html, css } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import * as THREE from 'three';

@customElement('game-component')
export class GameComponent extends LitElement {
  @query('#canvas')
  private canvas!: HTMLCanvasElement;
  
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private renderer?: THREE.WebGLRenderer;
  private animationFrameId?: number;
  
  // Tank components
  private tank?: THREE.Group;
  private tankBody?: THREE.Mesh;
  private turret?: THREE.Mesh;
  private turretPivot?: THREE.Group;
  private barrel?: THREE.Mesh;
  
  // Control state
  private keys: { [key: string]: boolean } = {};
  
  // Tank properties
  private tankSpeed = 0.05;
  private tankRotationSpeed = 0.03;
  private turretRotationSpeed = 0.03;
  private barrelElevationSpeed = 0.02;
  private maxBarrelElevation = Math.PI / 4;
  private minBarrelElevation = -Math.PI / 8;
  
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
    
    // Clean up Three.js resources
    this.renderer?.dispose();
    this.skyTexture?.dispose();
  }

  private initThree() {
    // Create scene
    this.scene = new THREE.Scene();
    
    // Create skybox
    this.createSkybox();
    
    // Create camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      this.canvas.clientWidth / this.canvas.clientHeight,
      0.1,
      1000
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
    
    // Create ground
    const groundGeometry = new THREE.PlaneGeometry(100, 100);
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
    this.createTank();
    
    // Position camera
    this.positionCamera();
    
    // Handle window resize
    window.addEventListener('resize', this.handleResize.bind(this));
  }
  
  private createTrees() {
    if (!this.scene) return;
    
    // Create tree materials
    const trunkMaterial = new THREE.MeshStandardMaterial({
      color: 0x8B4513, // Brown
      roughness: 0.9,
      metalness: 0.0
    });
    
    const leafMaterial = new THREE.MeshStandardMaterial({
      color: 0x2E8B57, // Dark green
      roughness: 0.8,
      metalness: 0.1
    });
    
    // Create different tree models
    const createPineTree = (scale: number, x: number, z: number) => {
      const tree = new THREE.Group();
      
      // Tree trunk
      const trunkGeometry = new THREE.CylinderGeometry(0.2 * scale, 0.3 * scale, 1.5 * scale, 8);
      const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
      trunk.position.y = 0.75 * scale;
      trunk.castShadow = true;
      trunk.receiveShadow = true;
      tree.add(trunk);
      
      // Tree foliage (cones)
      const foliageGeometry1 = new THREE.ConeGeometry(1 * scale, 2 * scale, 8);
      const foliage1 = new THREE.Mesh(foliageGeometry1, leafMaterial);
      foliage1.position.y = 2 * scale;
      foliage1.castShadow = true;
      tree.add(foliage1);
      
      const foliageGeometry2 = new THREE.ConeGeometry(0.8 * scale, 1.8 * scale, 8);
      const foliage2 = new THREE.Mesh(foliageGeometry2, leafMaterial);
      foliage2.position.y = 3 * scale;
      foliage2.castShadow = true;
      tree.add(foliage2);
      
      const foliageGeometry3 = new THREE.ConeGeometry(0.6 * scale, 1.6 * scale, 8);
      const foliage3 = new THREE.Mesh(foliageGeometry3, leafMaterial);
      foliage3.position.y = 4 * scale;
      foliage3.castShadow = true;
      tree.add(foliage3);
      
      // Position tree
      tree.position.set(x, 0, z);
      
      // Add to scene
      this.scene!.add(tree);
    };
    
    const createRoundTree = (scale: number, x: number, z: number) => {
      const tree = new THREE.Group();
      
      // Tree trunk
      const trunkGeometry = new THREE.CylinderGeometry(0.2 * scale, 0.3 * scale, 1.5 * scale, 8);
      const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
      trunk.position.y = 0.75 * scale;
      trunk.castShadow = true;
      trunk.receiveShadow = true;
      tree.add(trunk);
      
      // Tree foliage (sphere)
      const foliageGeometry = new THREE.SphereGeometry(1.2 * scale, 8, 8);
      const foliage = new THREE.Mesh(foliageGeometry, leafMaterial);
      foliage.position.y = 2.5 * scale;
      foliage.castShadow = true;
      tree.add(foliage);
      
      // Position tree
      tree.position.set(x, 0, z);
      
      // Add to scene
      this.scene!.add(tree);
    };
    
    // Place trees in various locations
    // Pine trees
    createPineTree(1.5, -15, -15);
    createPineTree(1.2, -18, -10);
    createPineTree(1.7, -14, -8);
    
    createPineTree(1.6, 16, 14);
    createPineTree(1.3, 18, 10);
    createPineTree(1.8, 20, 12);
    
    createPineTree(1.4, -10, 25);
    createPineTree(1.6, -8, 22);
    
    // Round trees
    createRoundTree(1.0, 12, -18);
    createRoundTree(1.2, 15, -15);
    createRoundTree(1.1, 10, -20);
    
    createRoundTree(1.3, -20, 10);
    createRoundTree(1.1, -18, 8);
    createRoundTree(1.0, -15, 12);
    
    createRoundTree(1.2, 25, -5);
    createRoundTree(1.0, 22, -7);
  }
  
  private createRocks() {
    if (!this.scene) return;
    
    // Create rock materials
    const rockMaterial = new THREE.MeshStandardMaterial({
      color: 0x808080, // Gray
      roughness: 0.9,
      metalness: 0.2
    });
    
    // Function to create a rock cluster
    const createRockCluster = (x: number, z: number) => {
      const cluster = new THREE.Group();
      
      // Create 3-5 rocks of different sizes
      const rockCount = 3 + Math.floor(Math.random() * 3);
      
      for (let i = 0; i < rockCount; i++) {
        // Create a deformed geometry for more natural look
        const rockGeometry = new THREE.DodecahedronGeometry(
          0.5 + Math.random() * 0.5, // Size varies
          0 // No subdivisions
        );
        
        // Randomly deform vertices
        const positions = rockGeometry.attributes.position;
        for (let j = 0; j < positions.count; j++) {
          const x = positions.getX(j);
          const y = positions.getY(j);
          const z = positions.getZ(j);
          
          // Add random displacement
          positions.setX(j, x * (0.8 + Math.random() * 0.4));
          positions.setY(j, y * (0.8 + Math.random() * 0.4));
          positions.setZ(j, z * (0.8 + Math.random() * 0.4));
        }
        
        // Create the rock mesh
        const rock = new THREE.Mesh(rockGeometry, rockMaterial);
        
        // Position within the cluster
        rock.position.set(
          (Math.random() - 0.5) * 2,
          Math.random() * 0.5,
          (Math.random() - 0.5) * 2
        );
        
        // Random rotation
        rock.rotation.set(
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI
        );
        
        // Random scale
        const scale = 0.5 + Math.random() * 1.5;
        rock.scale.set(scale, scale * 0.8, scale);
        
        rock.castShadow = true;
        rock.receiveShadow = true;
        
        cluster.add(rock);
      }
      
      // Position the cluster
      cluster.position.set(x, 0, z);
      
      // Add to scene
      this.scene!.add(cluster);
    };
    
    // Place rock clusters in various locations
    createRockCluster(-8, -8);
    createRockCluster(10, 12);
    createRockCluster(-12, 6);
    createRockCluster(15, -5);
    createRockCluster(0, 20);
    createRockCluster(-20, -2);
    createRockCluster(8, -15);
    createRockCluster(-15, 15);
  }
  
  private createSkybox() {
    if (!this.scene) return;
    
    // Create a large sphere to serve as our sky
    const skyGeometry = new THREE.SphereGeometry(500, 32, 32);
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
  
  private createTank() {
    this.tank = new THREE.Group();
    
    // Tank body
    const bodyGeometry = new THREE.BoxGeometry(2, 0.75, 3);
    const bodyMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x4a7c59,  // Dark green
      roughness: 0.7,
      metalness: 0.3
    });
    this.tankBody = new THREE.Mesh(bodyGeometry, bodyMaterial);
    this.tankBody.position.y = 0.75 / 2;
    this.tankBody.castShadow = true;
    this.tankBody.receiveShadow = true;
    this.tank.add(this.tankBody);
    
    // Tracks (left and right)
    const trackGeometry = new THREE.BoxGeometry(0.4, 0.5, 3.2);
    const trackMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x333333, 
      roughness: 0.9,
      metalness: 0.2
    });
    
    const leftTrack = new THREE.Mesh(trackGeometry, trackMaterial);
    leftTrack.position.set(-1, 0.25, 0);
    leftTrack.castShadow = true;
    leftTrack.receiveShadow = true;
    this.tank.add(leftTrack);
    
    const rightTrack = new THREE.Mesh(trackGeometry, trackMaterial);
    rightTrack.position.set(1, 0.25, 0);
    rightTrack.castShadow = true;
    rightTrack.receiveShadow = true;
    this.tank.add(rightTrack);
    
    // Turret pivot (for rotation)
    this.turretPivot = new THREE.Group();
    this.turretPivot.position.set(0, 0.75, 0);
    this.tank.add(this.turretPivot);
    
    // Turret base
    const turretGeometry = new THREE.CylinderGeometry(0.8, 0.8, 0.5, 16);
    const turretMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x3f5e49,  // Slightly different green
      roughness: 0.7,
      metalness: 0.3
    });
    this.turret = new THREE.Mesh(turretGeometry, turretMaterial);
    this.turret.castShadow = true;
    this.turret.receiveShadow = true;
    this.turretPivot.add(this.turret);
    
    // Barrel pivot (for elevation)
    const barrelPivot = new THREE.Group();
    barrelPivot.position.set(0, 0, 0);
    this.turretPivot.add(barrelPivot);
    
    // Barrel
    const barrelGeometry = new THREE.CylinderGeometry(0.2, 0.2, 2, 16);
    const barrelMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x333333, 
      roughness: 0.7,
      metalness: 0.5
    });
    this.barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
    this.barrel.rotation.x = Math.PI / 2;
    this.barrel.position.set(0, 0, 1.5);
    this.barrel.castShadow = true;
    barrelPivot.add(this.barrel);
    
    // Add to scene
    this.scene!.add(this.tank);
  }
  
  private positionCamera() {
    if (!this.camera || !this.tank) return;
    
    // Position camera behind and above the tank
    this.camera.position.set(0, 6, -8);
    this.camera.lookAt(this.tank.position);
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
    
    // Log key pressed for debugging
    console.log('Key down:', key);
    
    // Prevent default for arrow keys and WASD to avoid page scrolling/browser shortcuts
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(key)) {
      event.preventDefault();
    }
  }
  
  private handleKeyUp(event: KeyboardEvent) {
    const key = event.key.toLowerCase();
    this.keys[key] = false;
    console.log('Key up:', key);
  }
  
  private updateTank() {
    if (!this.tank || !this.turretPivot || !this.barrel || !this.camera) return;
    
    // Debug active keys
    if (Object.keys(this.keys).filter(k => this.keys[k]).length > 0) {
      console.log('Active keys:', Object.keys(this.keys).filter(k => this.keys[k]));
    }
    
    // Tank movement
    if (this.keys['w'] || this.keys['W']) {
      // Move forward in the direction the tank is facing
      this.tank.position.x += Math.sin(this.tank.rotation.y) * this.tankSpeed;
      this.tank.position.z += Math.cos(this.tank.rotation.y) * this.tankSpeed;
    }
    
    if (this.keys['s'] || this.keys['S']) {
      // Move backward in the direction the tank is facing
      this.tank.position.x -= Math.sin(this.tank.rotation.y) * this.tankSpeed;
      this.tank.position.z -= Math.cos(this.tank.rotation.y) * this.tankSpeed;
    }
    
    // Tank rotation
    if (this.keys['a'] || this.keys['A']) {
      this.tank.rotation.y += this.tankRotationSpeed;
    }
    
    if (this.keys['d'] || this.keys['D']) {
      this.tank.rotation.y -= this.tankRotationSpeed;
    }
    
    // Turret rotation (independent of tank rotation)
    if (this.keys['arrowleft'] || this.keys['ArrowLeft']) {
      this.turretPivot.rotation.y += this.turretRotationSpeed;
    }
    
    if (this.keys['arrowright'] || this.keys['ArrowRight']) {
      this.turretPivot.rotation.y -= this.turretRotationSpeed;
    }
    
    // Barrel elevation
    if (this.keys['arrowup'] || this.keys['ArrowUp']) {
      // Limit the upward elevation
      if (this.barrel.rotation.x > this.minBarrelElevation) {
        this.barrel.rotation.x -= this.barrelElevationSpeed;
      }
    }
    
    if (this.keys['arrowdown'] || this.keys['ArrowDown']) {
      // Limit the downward elevation
      if (this.barrel.rotation.x < this.maxBarrelElevation) {
        this.barrel.rotation.x += this.barrelElevationSpeed;
      }
    }
    
    // Camera follows tank
    const cameraOffset = new THREE.Vector3(0, 6, -8);
    
    // Rotate the offset based on tank's rotation
    const rotatedOffset = cameraOffset.clone();
    rotatedOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.tank.rotation.y);
    
    // Apply the offset to the tank's position
    this.camera.position.copy(this.tank.position).add(rotatedOffset);
    this.camera.lookAt(
      new THREE.Vector3(
        this.tank.position.x,
        this.tank.position.y + 2,
        this.tank.position.z
      )
    );
  }
  
  private handleResize() {
    if (!this.camera || !this.renderer) return;
    
    this.camera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
  }

  private animate() {
    this.animationFrameId = requestAnimationFrame(this.animate.bind(this));
    
    this.updateTank();
    
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