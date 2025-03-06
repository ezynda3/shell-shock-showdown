import { LitElement, html, css } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import * as THREE from 'three';
import { MapGenerator } from './map';

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
  private barrelPivot?: THREE.Group;
  
  // Control state
  private keys: { [key: string]: boolean } = {};
  
  // Tank properties
  private tankSpeed = 0.05;
  private tankRotationSpeed = 0.03;
  private turretRotationSpeed = 0.03;
  private barrelElevationSpeed = 0.02;
  // For barrel elevation, we'll be rotating the barrel group around the X axis
  private maxBarrelElevation = 0;           // Barrel can't go lower than starting position
  private minBarrelElevation = -Math.PI / 4; // Barrel pointing up limit
  
  // Assets
  private skyTexture?: THREE.Texture;
  
  // Projectiles
  private shells: {
    mesh: THREE.Mesh;
    velocity: THREE.Vector3;
    age: number;
    exploded: boolean;
  }[] = [];
  private shellSpeed = 1.5;      // Increased for larger world
  private gravity = 0.002;       // Reduced for better trajectories at scale
  private lastShotTime = 0;
  private shotCooldown = 500;    // ms between shots

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
    this.createTank();
    
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
    
    // Create turret group for Y-axis rotation
    this.turretPivot = new THREE.Group();
    this.turretPivot.position.set(0, 0.75, 0); // Position at top of tank body
    this.tank.add(this.turretPivot);
    
    // Turret base (dome)
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
    
    // Create a group for the barrel - this will handle the elevation
    const barrelGroup = new THREE.Group();
    
    // Position the pivot point at the front edge of the turret (not the center)
    barrelGroup.position.set(0, 0, 0.8); // 0.8 is the radius of the turret
    this.turretPivot.add(barrelGroup);
    
    // Create the barrel using a rotated cylinder
    const barrelGeometry = new THREE.CylinderGeometry(0.2, 0.2, 2, 16);
    const barrelMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x333333, 
      roughness: 0.7,
      metalness: 0.5
    });
    
    this.barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
    
    // Rotate the cylinder to point forward (perpendicular to tank)
    this.barrel.rotation.x = Math.PI / 2;
    
    // Position the barrel so one end is at the pivot point
    this.barrel.position.set(0, 0, 1); // Half the length of the barrel
    
    this.barrel.castShadow = true;
    barrelGroup.add(this.barrel);
    
    // Store reference to the barrelGroup for elevation control
    this.barrelPivot = barrelGroup;
    
    // Set initial barrel elevation to horizontal (0 degrees)
    this.barrelPivot.rotation.x = 0;
    
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
  
  private fireShell() {
    if (!this.scene || !this.tank || !this.turretPivot || !this.barrel || !this.barrelPivot) return;
    
    // Check cooldown
    const now = Date.now();
    if (now - this.lastShotTime < this.shotCooldown) return;
    this.lastShotTime = now;
    
    // Create the shell
    const shellGeometry = new THREE.SphereGeometry(0.1, 8, 8);
    const shellMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xdddddd,
      emissive: 0x555555,
      roughness: 0.5,
      metalness: 0.7
    });
    const shell = new THREE.Mesh(shellGeometry, shellMaterial);
    
    // Get barrel end position in world space
    const barrelEndPosition = new THREE.Vector3(0, 0, 2);
    this.barrel.localToWorld(barrelEndPosition);
    shell.position.copy(barrelEndPosition);
    
    // Calculate the direction of the barrel in world space
    const barrelDirection = new THREE.Vector3();
    
    // Get turret's global rotation
    const turretWorldQuaternion = new THREE.Quaternion();
    this.turretPivot.getWorldQuaternion(turretWorldQuaternion);
    
    // Get barrel pivot's local rotation and combine with turret
    const barrelLocalQuaternion = new THREE.Quaternion();
    barrelLocalQuaternion.setFromEuler(new THREE.Euler(
      this.barrelPivot.rotation.x,
      0,
      0
    ));
    
    // Combine rotations
    const combinedQuaternion = turretWorldQuaternion.multiply(barrelLocalQuaternion);
    
    // Set barrel direction based on the combined rotation
    barrelDirection.set(0, 0, 1).applyQuaternion(combinedQuaternion);
    
    // Create the velocity vector for the shell
    const velocity = barrelDirection.multiplyScalar(this.shellSpeed);
    
    // Add shell to the scene and to our shells array
    this.scene.add(shell);
    this.shells.push({
      mesh: shell,
      velocity: velocity,
      age: 0,
      exploded: false
    });
    
    // Play sound (if available)
    // this.playSound('fire');
  }
  
  private updateShells() {
    if (!this.scene) return;
    
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const shell = this.shells[i];
      
      // Skip exploded shells
      if (shell.exploded) {
        shell.age++;
        
        // Remove explosion after animation completes
        if (shell.age > 30) { // 30 frames = ~0.5 seconds
          this.scene.remove(shell.mesh);
          this.shells.splice(i, 1);
        }
        continue;
      }
      
      // Update shell position
      shell.mesh.position.add(shell.velocity);
      
      // Apply gravity to velocity (increases over time)
      shell.velocity.y -= this.gravity;
      
      // Increase age
      shell.age++;
      
      // Check for ground collision
      if (shell.mesh.position.y <= 0.1) {
        this.explodeShell(i);
      }
      
      // Remove shells that have been flying too long or went too far
      if (shell.age > 1200 || // 20 seconds at 60fps (increased for larger map)
          shell.mesh.position.distanceTo(this.tank!.position) > 10000) { // Much larger distance
        this.scene.remove(shell.mesh);
        this.shells.splice(i, 1);
      }
    }
  }
  
  private explodeShell(index: number) {
    if (!this.scene) return;
    
    const shell = this.shells[index];
    if (shell.exploded) return;
    
    // Mark as exploded
    shell.exploded = true;
    shell.age = 0;
    
    // Removed old shell geometry
    const oldPosition = shell.mesh.position.clone();
    shell.mesh.geometry.dispose();
    (shell.mesh.material as THREE.Material).dispose();
    
    // Create larger explosion
    const explosionGeometry = new THREE.SphereGeometry(5, 16, 16);
    const explosionMaterial = new THREE.MeshBasicMaterial({
      color: 0xff8800,
      transparent: true,
      opacity: 0.8
    });
    
    // Replace the mesh
    shell.mesh = new THREE.Mesh(explosionGeometry, explosionMaterial);
    shell.mesh.position.copy(oldPosition);
    shell.mesh.position.y = 0.1; // Just above ground
    this.scene.add(shell.mesh);
    
    // Add a larger light for the explosion effect
    const explosionLight = new THREE.PointLight(0xff5500, 10, 50);
    explosionLight.position.copy(oldPosition);
    explosionLight.position.y = 2;
    this.scene.add(explosionLight);
    
    // Remove the light after a delay
    setTimeout(() => {
      if (this.scene) {
        this.scene.remove(explosionLight);
      }
    }, 200);
    
    // Play sound (if available)
    // this.playSound('explosion');
  }
  
  private updateTank() {
    if (!this.tank || !this.turretPivot || !this.barrel || !this.camera) return;
    
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
    
    // Barrel elevation (using the barrel pivot group instead of the barrel itself)
    if (this.keys['arrowup'] || this.keys['ArrowUp']) {
      // Move barrel up (decreasing rotation.x value)
      this.barrelPivot!.rotation.x = Math.max(
        this.minBarrelElevation,
        this.barrelPivot!.rotation.x - this.barrelElevationSpeed
      );
    }
    
    if (this.keys['arrowdown'] || this.keys['ArrowDown']) {
      // Move barrel down (increasing rotation.x value)
      this.barrelPivot!.rotation.x = Math.min(
        this.maxBarrelElevation,
        this.barrelPivot!.rotation.x + this.barrelElevationSpeed
      );
    }
    
    // Fire shell with spacebar
    if (this.keys[' '] || this.keys['Space']) {
      this.fireShell();
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
    this.updateShells();
    
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