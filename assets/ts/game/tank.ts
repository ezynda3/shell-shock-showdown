import * as THREE from 'three';

export class Tank {
  // Tank components
  tank: THREE.Group;
  tankBody?: THREE.Mesh;
  turret?: THREE.Mesh;
  turretPivot: THREE.Group;
  barrel?: THREE.Mesh;
  barrelPivot: THREE.Group;
  
  // Tank properties
  private tankSpeed = 0.15;
  private tankRotationSpeed = 0.05;
  private turretRotationSpeed = 0.04;
  private barrelElevationSpeed = 0.03;
  private maxBarrelElevation = 0;           // Barrel can't go lower than starting position
  private minBarrelElevation = -Math.PI / 4; // Barrel pointing up limit
  private initialY = 0.1;                  // Initial Y-velocity to ensure shells don't immediately fall
  
  // Projectiles
  private shells: {
    mesh: THREE.Mesh;            // The shell mesh
    velocity: THREE.Vector3;     // Current velocity vector
    age: number;                 // Age in frames for lifecycle management
    exploded: boolean;           // Whether the shell has exploded
    impactPosition?: THREE.Vector3; // Position where impact occurred
    scorch?: THREE.Mesh;         // Scorch mark at impact point
    light?: THREE.PointLight;    // Light for muzzle flash or explosion
    smokeParticles?: THREE.Points; // Smoke particles
    dustParticles?: THREE.Points;  // Dust particles on impact
  }[] = [];
  private shellSpeed = 1.5;        // Shell velocity
  private gravity = 0.002;         // Gravity effect on shell
  private lastShotTime = 0;
  private shotCooldown = 500;      // ms between shots
  private maxActiveShells = 10;    // Maximum number of active shells for performance
  
  // Shell materials and geometries (cached for performance)
  private shellMaterial: THREE.MeshStandardMaterial;
  private shellGeometry: THREE.SphereGeometry;
  private explosionMaterial: THREE.MeshBasicMaterial;
  private explosionGeometry: THREE.SphereGeometry;
  private scorchMaterial: THREE.MeshBasicMaterial;
  private scorchGeometry: THREE.CircleGeometry;
  private particlesMaterial: THREE.PointsMaterial;
  private smokeGeometry: THREE.BufferGeometry;
  private dustGeometry: THREE.BufferGeometry;

  private scene: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;

  constructor(scene: THREE.Scene, camera?: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
    
    // Initialize tank group
    this.tank = new THREE.Group();
    this.turretPivot = new THREE.Group();
    this.barrelPivot = new THREE.Group();
    
    // Initialize shell materials
    this.initShellMaterials();
    
    // Create tank model
    this.createTank();
    
    // Add to scene
    scene.add(this.tank);
  }

  private initShellMaterials() {
    // Initialize shell materials and geometries for reuse
    
    // Shell mesh
    this.shellGeometry = new THREE.SphereGeometry(0.2, 8, 8);
    this.shellMaterial = new THREE.MeshStandardMaterial({
      color: 0xdddddd,
      emissive: 0x888888, // Slight glow for better visibility
      roughness: 0.4,
      metalness: 0.8
    });
    
    // Explosion mesh
    this.explosionGeometry = new THREE.SphereGeometry(5, 16, 16);
    this.explosionMaterial = new THREE.MeshBasicMaterial({
      color: 0xff8800,
      transparent: true,
      opacity: 0.8
    });
    
    // Scorch mark (ground decal)
    this.scorchGeometry = new THREE.CircleGeometry(4, 16);
    this.scorchMaterial = new THREE.MeshBasicMaterial({
      color: 0x222222,
      transparent: true,
      opacity: 0.7,
      depthWrite: false // Prevents z-fighting with ground
    });
    
    // Particle materials for smoke and dust
    this.particlesMaterial = new THREE.PointsMaterial({
      color: 0xaaaaaa,
      size: 0.5,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    
    // Create smoke particle geometry (reused for multiple effects)
    const smokeParticleCount = 50;
    const smokeParticlePositions = new Float32Array(smokeParticleCount * 3);
    
    for (let i = 0; i < smokeParticleCount; i++) {
      // Random distribution in a sphere
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 3;
      
      smokeParticlePositions[i * 3] = Math.cos(angle) * radius;     // x
      smokeParticlePositions[i * 3 + 1] = Math.random() * 4;        // y (higher)
      smokeParticlePositions[i * 3 + 2] = Math.sin(angle) * radius; // z
    }
    
    this.smokeGeometry = new THREE.BufferGeometry();
    this.smokeGeometry.setAttribute('position', new THREE.BufferAttribute(smokeParticlePositions, 3));
    
    // Create dust particle geometry (reused for ground impact)
    const dustParticleCount = 30;
    const dustParticlePositions = new Float32Array(dustParticleCount * 3);
    
    for (let i = 0; i < dustParticleCount; i++) {
      // Random distribution in a flat circle
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 4;
      
      dustParticlePositions[i * 3] = Math.cos(angle) * radius;      // x
      dustParticlePositions[i * 3 + 1] = Math.random() * 0.5;       // y (low to ground)
      dustParticlePositions[i * 3 + 2] = Math.sin(angle) * radius;  // z
    }
    
    this.dustGeometry = new THREE.BufferGeometry();
    this.dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustParticlePositions, 3));
  }

  private createTank() {
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
    this.turretPivot.position.set(0, 1.0, 0); // Position at top of tank body, slightly higher
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
    
    // Set initial barrel elevation to exactly horizontal (0 degrees)
    this.barrelPivot.rotation.x = 0;
    
    // Ensure the barrel is properly oriented for horizontal firing
    // This ensures shells fly straight initially and don't hit the ground immediately
    this.barrel.rotation.x = Math.PI / 2; // Barrel cylinder points along z-axis
  }

  fireShell() {
    if (!this.barrel || !this.barrelPivot) return;
    
    // Check cooldown
    const now = Date.now();
    if (now - this.lastShotTime < this.shotCooldown) return;
    this.lastShotTime = now;
    
    // Check shell limit
    if (this.shells.filter(s => !s.exploded).length >= this.maxActiveShells) {
      // Remove oldest shell if at limit
      const oldestIndex = this.shells.findIndex(s => !s.exploded);
      if (oldestIndex >= 0) {
        this.explodeShell(oldestIndex);
      }
    }
    
    // Create the shell using cached geometry and material
    const shell = new THREE.Mesh(this.shellGeometry, this.shellMaterial);
    
    // Get barrel end position in world space
    // Use the forward direction of the barrel (positive Z in barrel's local space)
    const barrelTip = new THREE.Vector3(0, 0, 2);
    this.barrel.localToWorld(barrelTip);
    
    // Ensure the shell starts slightly above ground level to prevent immediate collision
    if (barrelTip.y < 0.3) {
      barrelTip.y = 0.3; // Minimum height to avoid immediate ground collision
    }
    
    // Set the shell to start at the barrel tip
    shell.position.copy(barrelTip);
    
    console.log("Shell starting position:", shell.position.x, shell.position.y, shell.position.z);
    
    // Calculate the direction of the barrel in world space
    // We'll use the barrel's world transform to get its forward direction
    
    // Create a vector representing forward in barrel's local space
    const barrelForward = new THREE.Vector3(0, 0, 1);
    
    // Get barrel's current world rotation
    const barrelWorldMatrix = new THREE.Matrix4();
    this.barrel.updateMatrixWorld();
    barrelWorldMatrix.extractRotation(this.barrel.matrixWorld);
    
    // Transform the forward vector by barrel's world rotation
    const barrelDirection = barrelForward.clone().applyMatrix4(barrelWorldMatrix).normalize();
    
    // Create the velocity vector for the shell
    // Add a small initial upward component to counteract immediate gravity
    const velocity = barrelDirection.multiplyScalar(this.shellSpeed);
    
    // Add a small upward component to counteract gravity for horizontal shots
    if (Math.abs(this.barrelPivot.rotation.x) < 0.01) {
      velocity.y += this.initialY;
    }
    
    // Create muzzle flash
    const muzzleLight = new THREE.PointLight(0xff9933, 5, 3);
    muzzleLight.position.copy(barrelTip);
    this.scene.add(muzzleLight);
    
    // Create muzzle smoke particles
    const smokeParticles = new THREE.Points(this.smokeGeometry.clone(), this.particlesMaterial.clone());
    smokeParticles.position.copy(barrelTip);
    this.scene.add(smokeParticles);
    
    // Add shell to the scene and to our shells array with effects
    this.scene.add(shell);
    this.shells.push({
      mesh: shell,
      velocity: velocity,
      age: 0,
      exploded: false,
      light: muzzleLight,
      smokeParticles: smokeParticles
    });
    
    // Simulate recoil by moving barrel pivot backward
    const recoilAnimation = {
      step: 0,
      maxSteps: 10,
      originalPosition: this.barrel.position.z,
      animate: () => {
        if (recoilAnimation.step < recoilAnimation.maxSteps) {
          if (recoilAnimation.step < recoilAnimation.maxSteps / 2) {
            // Moving backward
            this.barrel.position.z -= 0.02;
          } else {
            // Moving forward (recovery)
            this.barrel.position.z += 0.02;
          }
          recoilAnimation.step++;
          requestAnimationFrame(recoilAnimation.animate);
        } else {
          // Reset to original position to avoid drift
          this.barrel.position.z = recoilAnimation.originalPosition;
        }
      }
    };
    
    // Start recoil animation
    recoilAnimation.animate();
    
    // Remove muzzle flash after short delay
    setTimeout(() => {
      if (this.scene) {
        this.scene.remove(muzzleLight);
      }
    }, 100);
    
    // Create a tracer effect (glowing line behind shell)
    const tracerGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.8, 8);
    tracerGeometry.rotateX(Math.PI / 2);
    const tracerMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xffaa00,
      transparent: true,
      opacity: 0.6
    });
    const tracer = new THREE.Mesh(tracerGeometry, tracerMaterial);
    tracer.position.copy(barrelTip);
    
    // Align tracer with barrel direction
    const tracerDirection = barrelDirection.clone();
    tracer.lookAt(barrelTip.clone().add(tracerDirection));
    
    this.scene.add(tracer);
    
    // Fade and remove tracer after short delay
    const tracerFade = {
      step: 0,
      maxSteps: 20,
      animate: () => {
        if (tracerFade.step < tracerFade.maxSteps) {
          tracerMaterial.opacity -= 0.03;
          tracerFade.step++;
          requestAnimationFrame(tracerFade.animate);
        } else {
          this.scene.remove(tracer);
          tracerMaterial.dispose();
          tracerGeometry.dispose();
        }
      }
    };
    
    tracerFade.animate();
    
    // Play firing sound (if available)
    // this.playSound('fire');
  }

  updateShells() {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const shell = this.shells[i];
      
      // Increase age for all shells
      shell.age++;
      
      // Skip exploded shells - handle their animation separately
      if (shell.exploded) {
        // Fade out explosion
        if (shell.age > 5 && shell.mesh.material instanceof THREE.Material) {
          // Gradually reduce opacity
          if (shell.mesh.material.opacity > 0.05) {
            shell.mesh.material.opacity -= 0.05;
          }
          
          // Scale up the explosion slightly
          shell.mesh.scale.multiplyScalar(1.02);
        }
        
        // Handle smoke particle animation
        if (shell.smokeParticles) {
          // Move smoke upward
          shell.smokeParticles.position.y += 0.05;
          
          // Fade out smoke
          if (shell.smokeParticles.material instanceof THREE.Material) {
            if (shell.smokeParticles.material.opacity > 0.01) {
              shell.smokeParticles.material.opacity -= 0.01;
            }
          }
        }
        
        // Handle dust particle animation
        if (shell.dustParticles) {
          // Spread dust outward
          shell.dustParticles.scale.x += 0.02;
          shell.dustParticles.scale.z += 0.02;
          
          // Fade out dust
          if (shell.dustParticles.material instanceof THREE.Material) {
            if (shell.dustParticles.material.opacity > 0.02) {
              shell.dustParticles.material.opacity -= 0.02;
            }
          }
        }
        
        // Fade out scorch mark
        if (shell.scorch && shell.scorch.material instanceof THREE.Material) {
          if (shell.age > 20 && shell.scorch.material.opacity > 0.01) {
            shell.scorch.material.opacity -= 0.01;
          }
        }
        
        // Remove explosion after animation completes
        if (shell.age > 60) { // 60 frames = ~1 second
          // Clean up all explosion-related objects
          this.scene.remove(shell.mesh);
          
          if (shell.smokeParticles) {
            this.scene.remove(shell.smokeParticles);
          }
          
          if (shell.dustParticles) {
            this.scene.remove(shell.dustParticles);
          }
          
          if (shell.scorch) {
            this.scene.remove(shell.scorch);
          }
          
          if (shell.light) {
            this.scene.remove(shell.light);
          }
          
          // Remove from shells array
          this.shells.splice(i, 1);
        }
        continue;
      }
      
      // Handle in-flight shell animation
      
      // Update shell position
      shell.mesh.position.add(shell.velocity);
      
      // Apply gravity to velocity (increases over time)
      shell.velocity.y -= this.gravity;
      
      // Rotate the shell slightly for visual interest
      shell.mesh.rotation.x += 0.05;
      shell.mesh.rotation.z += 0.05;
      
      // Update muzzle smoke particles for new shells
      if (shell.age < 10 && shell.smokeParticles) {
        // Expand and fade muzzle smoke
        shell.smokeParticles.position.y += 0.05;
        if (shell.smokeParticles.material instanceof THREE.Material) {
          shell.smokeParticles.material.opacity -= 0.03;
          if (shell.smokeParticles.material.opacity <= 0) {
            this.scene.remove(shell.smokeParticles);
            shell.smokeParticles = undefined;
          }
        }
      }
      
      // Check for ground collision - use a slightly higher threshold
      if (shell.mesh.position.y <= 0.2) {
        console.log("Shell hit ground at position:", 
          shell.mesh.position.x.toFixed(2), 
          shell.mesh.position.y.toFixed(2), 
          shell.mesh.position.z.toFixed(2),
          "with velocity:", 
          shell.velocity.x.toFixed(2),
          shell.velocity.y.toFixed(2),
          shell.velocity.z.toFixed(2)
        );
        this.explodeShell(i);
      }
      
      // Remove shells that have been flying too long or went too far
      if (shell.age > 600 || // 10 seconds at 60fps
          shell.mesh.position.distanceTo(this.tank.position) > 10000) { // Distance limit
        
        // Clean up related objects
        this.scene.remove(shell.mesh);
        if (shell.smokeParticles) this.scene.remove(shell.smokeParticles);
        if (shell.light) this.scene.remove(shell.light);
      }
    }
  }

  private explodeShell(index: number) {
    const shell = this.shells[index];
    if (shell.exploded) return;
    
    // Mark as exploded
    shell.exploded = true;
    shell.age = 0;
    
    // Store impact position for effects
    const impactPosition = shell.mesh.position.clone();
    impactPosition.y = 0.1; // Place slightly above ground
    shell.impactPosition = impactPosition;
    
    // Remove old shell geometry and material
    shell.mesh.geometry.dispose();
    (shell.mesh.material as THREE.Material).dispose();
    
    // Create explosion sphere (reuse geometry and material)
    const explosionMaterial = this.explosionMaterial.clone();
    shell.mesh = new THREE.Mesh(this.explosionGeometry, explosionMaterial);
    shell.mesh.position.copy(impactPosition);
    shell.mesh.position.y = 2.5; // Center of explosion slightly above ground
    this.scene.add(shell.mesh);
    
    // Create explosion light
    const explosionLight = new THREE.PointLight(0xff5500, 8, 20);
    explosionLight.position.copy(impactPosition);
    explosionLight.position.y = 3;
    this.scene.add(explosionLight);
    shell.light = explosionLight;
    
    // Create smoke cloud
    const smokeParticles = new THREE.Points(this.smokeGeometry.clone(), this.particlesMaterial.clone());
    smokeParticles.position.copy(impactPosition);
    smokeParticles.position.y = 1;
    this.scene.add(smokeParticles);
    shell.smokeParticles = smokeParticles;
    
    // Create dust cloud
    const dustParticles = new THREE.Points(this.dustGeometry.clone(), this.particlesMaterial.clone());
    dustParticles.position.copy(impactPosition);
    dustParticles.position.y = 0.1;
    this.scene.add(dustParticles);
    shell.dustParticles = dustParticles;
    
    // Create scorch mark on ground
    const scorchMaterial = this.scorchMaterial.clone();
    const scorch = new THREE.Mesh(this.scorchGeometry, scorchMaterial);
    scorch.position.copy(impactPosition);
    scorch.position.y = 0.02; // Just above ground
    scorch.rotation.x = -Math.PI / 2; // Lay flat on ground
    this.scene.add(scorch);
    shell.scorch = scorch;
    
    // Simulate environmental reaction (dust being kicked up)
    // Add subtle camera shake if the explosion is close to the tank
    if (this.camera) {
      const distanceToTank = impactPosition.distanceTo(this.tank.position);
      if (distanceToTank < 50) {
        // Calculate shake intensity based on distance
        const shakeIntensity = Math.max(0, 0.5 - (distanceToTank / 100));
        
        // Apply subtle camera shake
        const originalCameraPosition = this.camera.position.clone();
        let shakeStep = 0;
        
        const cameraShake = () => {
          if (shakeStep < 5) {
            this.camera!.position.x += (Math.random() - 0.5) * shakeIntensity;
            this.camera!.position.y += (Math.random() - 0.5) * shakeIntensity;
            this.camera!.position.z += (Math.random() - 0.5) * shakeIntensity;
            shakeStep++;
            requestAnimationFrame(cameraShake);
          } else {
            // Reset camera position to avoid drift
            this.camera!.position.copy(originalCameraPosition);
          }
        };
        
        cameraShake();
      }
    }
    
    // Remove explosion light after a short delay
    setTimeout(() => {
      if (shell.light) {
        this.scene.remove(shell.light);
        shell.light = undefined;
      }
    }, 200);
    
    // Play explosion sound (if available)
    // this.playSound('explosion');
  }

  update(keys: { [key: string]: boolean }) {
    // Tank movement
    if (keys['w'] || keys['W']) {
      // Move forward in the direction the tank is facing
      this.tank.position.x += Math.sin(this.tank.rotation.y) * this.tankSpeed;
      this.tank.position.z += Math.cos(this.tank.rotation.y) * this.tankSpeed;
    }
    
    if (keys['s'] || keys['S']) {
      // Move backward in the direction the tank is facing
      this.tank.position.x -= Math.sin(this.tank.rotation.y) * this.tankSpeed;
      this.tank.position.z -= Math.cos(this.tank.rotation.y) * this.tankSpeed;
    }
    
    // Tank rotation
    if (keys['a'] || keys['A']) {
      this.tank.rotation.y += this.tankRotationSpeed;
    }
    
    if (keys['d'] || keys['D']) {
      this.tank.rotation.y -= this.tankRotationSpeed;
    }
    
    // Turret rotation (independent of tank rotation)
    if (keys['arrowleft'] || keys['ArrowLeft']) {
      this.turretPivot.rotation.y += this.turretRotationSpeed;
    }
    
    if (keys['arrowright'] || keys['ArrowRight']) {
      this.turretPivot.rotation.y -= this.turretRotationSpeed;
    }
    
    // Barrel elevation (using the barrel pivot group instead of the barrel itself)
    if (keys['arrowup'] || keys['ArrowUp']) {
      // Move barrel up (decreasing rotation.x value)
      this.barrelPivot.rotation.x = Math.max(
        this.minBarrelElevation,
        this.barrelPivot.rotation.x - this.barrelElevationSpeed
      );
    }
    
    if (keys['arrowdown'] || keys['ArrowDown']) {
      // Move barrel down (increasing rotation.x value)
      this.barrelPivot.rotation.x = Math.min(
        this.maxBarrelElevation,
        this.barrelPivot.rotation.x + this.barrelElevationSpeed
      );
    }
    
    // Fire shell with spacebar
    if (keys[' '] || keys['space'] || keys['Space']) {
      console.log("Space key detected - firing shell!");
      this.fireShell();
    }
    
    // Update all shells
    this.updateShells();
  }

  updateCamera(camera: THREE.PerspectiveCamera) {
    // Camera follows tank
    const cameraOffset = new THREE.Vector3(0, 4, -8); // Decreased height to show more sky
    
    // Rotate the offset based on tank's rotation
    const rotatedOffset = cameraOffset.clone();
    rotatedOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.tank.rotation.y);
    
    // Apply the offset to the tank's position
    camera.position.copy(this.tank.position).add(rotatedOffset);
    camera.lookAt(
      new THREE.Vector3(
        this.tank.position.x,
        this.tank.position.y + 4, // Raised look target to aim camera higher
        this.tank.position.z
      )
    );
  }
  
  dispose() {
    // Clean up resources
    this.scene.remove(this.tank);
    
    // Clean up all shells
    for (const shell of this.shells) {
      this.scene.remove(shell.mesh);
      if (shell.smokeParticles) this.scene.remove(shell.smokeParticles);
      if (shell.dustParticles) this.scene.remove(shell.dustParticles);
      if (shell.scorch) this.scene.remove(shell.scorch);
      if (shell.light) this.scene.remove(shell.light);
    }
    
    // Dispose geometries and materials
    this.shellGeometry.dispose();
    this.shellMaterial.dispose();
    this.explosionGeometry.dispose();
    this.explosionMaterial.dispose();
    this.scorchGeometry.dispose();
    this.scorchMaterial.dispose();
    this.smokeGeometry.dispose();
    this.dustGeometry.dispose();
    this.particlesMaterial.dispose();
  }
}