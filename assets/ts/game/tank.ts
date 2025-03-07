import * as THREE from 'three';

// Interface for common tank properties and methods
export interface ITank {
  tank: THREE.Group;
  update(keys?: { [key: string]: boolean }): void;
  dispose(): void;
}

export class Tank implements ITank {
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

  private scene: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;

  constructor(scene: THREE.Scene, camera?: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
    
    // Initialize tank group
    this.tank = new THREE.Group();
    this.turretPivot = new THREE.Group();
    this.barrelPivot = new THREE.Group();
    
    // Create tank model
    this.createTank();
    
    // Add to scene
    scene.add(this.tank);
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
  }
}

export class NPCTank implements ITank {
  // Tank components
  tank: THREE.Group;
  tankBody?: THREE.Mesh;
  turret?: THREE.Mesh;
  turretPivot: THREE.Group;
  barrel?: THREE.Mesh;
  barrelPivot: THREE.Group;
  
  // Tank properties
  private tankSpeed = 0.1;
  private tankRotationSpeed = 0.03;
  private turretRotationSpeed = 0.02;
  private barrelElevationSpeed = 0.01;
  private maxBarrelElevation = 0;
  private minBarrelElevation = -Math.PI / 4;
  
  // NPC behavior properties
  private movementPattern: 'circle' | 'zigzag' | 'random' | 'patrol';
  private movementTimer = 0;
  private changeDirectionInterval: number;
  private currentDirection = 0; // Angle in radians
  private targetPosition = new THREE.Vector3();
  private patrolPoints: THREE.Vector3[] = [];
  private currentPatrolIndex = 0;
  private tankColor: number;

  private scene: THREE.Scene;

  constructor(scene: THREE.Scene, position: THREE.Vector3, color = 0xff0000) {
    this.scene = scene;
    this.tankColor = color;
    
    // Initialize tank group
    this.tank = new THREE.Group();
    this.turretPivot = new THREE.Group();
    this.barrelPivot = new THREE.Group();
    
    // Create tank model
    this.createTank();
    
    // Set initial position
    this.tank.position.copy(position);
    
    // Pick a random movement pattern
    const patterns: ('circle' | 'zigzag' | 'random' | 'patrol')[] = ['circle', 'zigzag', 'random', 'patrol'];
    this.movementPattern = patterns[Math.floor(Math.random() * patterns.length)];
    
    // Set random change direction interval (between 2-5 seconds at 60fps)
    this.changeDirectionInterval = Math.floor(Math.random() * 180) + 120;
    
    // If patrol pattern, set up patrol points
    if (this.movementPattern === 'patrol') {
      this.setupPatrolPoints();
    }
    
    // Add to scene
    scene.add(this.tank);
  }

  private createTank() {
    // Tank body
    const bodyGeometry = new THREE.BoxGeometry(2, 0.75, 3);
    const bodyMaterial = new THREE.MeshStandardMaterial({ 
      color: this.tankColor,
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
      color: this.getTurretColor(),
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
    this.barrel.rotation.x = Math.PI / 2; // Barrel cylinder points along z-axis
  }

  private getTurretColor(): number {
    // Make turret a darker shade of the tank color
    const color = new THREE.Color(this.tankColor);
    color.multiplyScalar(0.8);
    return color.getHex();
  }

  private setupPatrolPoints() {
    // Create a patrol path with 4-6 points around the tank's starting position
    const pointCount = Math.floor(Math.random() * 3) + 4;
    const radius = Math.random() * 50 + 50; // 50-100 units radius
    
    for (let i = 0; i < pointCount; i++) {
      const angle = (i / pointCount) * Math.PI * 2;
      const x = this.tank.position.x + Math.cos(angle) * radius;
      const z = this.tank.position.z + Math.sin(angle) * radius;
      this.patrolPoints.push(new THREE.Vector3(x, 0, z));
    }
    
    // Set initial target to first patrol point
    this.targetPosition.copy(this.patrolPoints[0]);
  }

  update() {
    this.movementTimer++;
    
    // Update movement based on pattern
    switch (this.movementPattern) {
      case 'circle':
        this.moveInCircle();
        break;
      case 'zigzag':
        this.moveInZigzag();
        break;
      case 'random':
        this.moveRandomly();
        break;
      case 'patrol':
        this.moveInPatrol();
        break;
    }
    
    // Randomly rotate the turret for visual interest
    this.turretPivot.rotation.y += (Math.sin(this.movementTimer * 0.01) * 0.5) * this.turretRotationSpeed;
    
    // Randomly adjust barrel elevation
    const barrelTarget = Math.sin(this.movementTimer * 0.005) * (this.maxBarrelElevation - this.minBarrelElevation) / 2;
    this.barrelPivot.rotation.x += (barrelTarget - this.barrelPivot.rotation.x) * 0.01;
  }

  private moveInCircle() {
    // Move in a circular pattern
    this.currentDirection += 0.005;
    
    // Apply movement
    this.tank.position.x += Math.cos(this.currentDirection) * this.tankSpeed;
    this.tank.position.z += Math.sin(this.currentDirection) * this.tankSpeed;
    
    // Rotate tank to face movement direction
    this.tank.rotation.y = this.currentDirection + Math.PI / 2;
  }

  private moveInZigzag() {
    // Change direction at intervals
    if (this.movementTimer % this.changeDirectionInterval === 0) {
      this.currentDirection = Math.random() * Math.PI * 2;
    }
    
    // Apply zigzag by adding sine wave to movement
    const zigzagFactor = Math.sin(this.movementTimer * 0.1) * 0.5;
    
    // Calculate forward and side direction vectors
    const forwardX = Math.cos(this.currentDirection);
    const forwardZ = Math.sin(this.currentDirection);
    const sideX = Math.cos(this.currentDirection + Math.PI / 2);
    const sideZ = Math.sin(this.currentDirection + Math.PI / 2);
    
    // Apply movement with zigzag
    this.tank.position.x += (forwardX + sideX * zigzagFactor) * this.tankSpeed;
    this.tank.position.z += (forwardZ + sideZ * zigzagFactor) * this.tankSpeed;
    
    // Rotate tank to face movement direction
    const targetRotation = Math.atan2(forwardZ + sideZ * zigzagFactor, forwardX + sideX * zigzagFactor) + Math.PI / 2;
    this.tank.rotation.y += (targetRotation - this.tank.rotation.y) * 0.1;
  }

  private moveRandomly() {
    // Change direction at random intervals
    if (this.movementTimer % this.changeDirectionInterval === 0) {
      this.currentDirection = Math.random() * Math.PI * 2;
    }
    
    // Apply movement
    this.tank.position.x += Math.cos(this.currentDirection) * this.tankSpeed;
    this.tank.position.z += Math.sin(this.currentDirection) * this.tankSpeed;
    
    // Rotate tank to face movement direction
    const targetRotation = this.currentDirection + Math.PI / 2;
    this.tank.rotation.y += (targetRotation - this.tank.rotation.y) * 0.1;
  }

  private moveInPatrol() {
    if (this.patrolPoints.length === 0) return;
    
    // Move toward current patrol point
    const targetPoint = this.patrolPoints[this.currentPatrolIndex];
    const direction = new THREE.Vector2(
      targetPoint.x - this.tank.position.x,
      targetPoint.z - this.tank.position.z
    );
    
    // Check if we've reached the target (within 5 units)
    if (direction.length() < 5) {
      // Move to next patrol point
      this.currentPatrolIndex = (this.currentPatrolIndex + 1) % this.patrolPoints.length;
      return;
    }
    
    // Normalize direction
    direction.normalize();
    
    // Apply movement
    this.tank.position.x += direction.x * this.tankSpeed;
    this.tank.position.z += direction.y * this.tankSpeed;
    
    // Rotate tank to face movement direction
    const targetRotation = Math.atan2(direction.y, direction.x) + Math.PI / 2;
    this.tank.rotation.y += (targetRotation - this.tank.rotation.y) * 0.1;
  }

  dispose() {
    // Clean up resources
    this.scene.remove(this.tank);
  }
}