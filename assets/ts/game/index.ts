import { LitElement, html, css } from 'lit';
import { customElement, query, property } from 'lit/decorators.js';
import * as THREE from 'three';
import { MapGenerator } from './map';
import { Tank, NPCTank, ITank, ICollidable, SpatialAudio } from './tank';
import { CollisionSystem } from './collision';
import { Shell } from './shell';
import './stats'; // Import stats component
import './radar'; // Import radar component

// Make SpatialAudio accessible from window for global use
(window as any).SpatialAudio = SpatialAudio;

// Interface for player state
interface PlayerState {
  id: string;
  name: string;
  position: {
    x: number;
    y: number;
    z: number;
  };
  tankRotation: number;
  turretRotation: number;
  barrelElevation: number;
  health: number;
  isMoving: boolean;
  velocity: number;
  timestamp: number;
  color?: string;
}

// Interface for game state
interface MultiplayerGameState {
  players: { [playerId: string]: PlayerState };
  shells: ShellState[];
}

// Interface for shell state
interface ShellState {
  id: string;
  playerId: string; 
  position: {
    x: number;
    y: number;
    z: number;
  };
  direction: {
    x: number;
    y: number;
    z: number;
  };
  speed: number;
  timestamp: number;
}

@customElement('game-component')
export class GameComponent extends LitElement {
  @query('#canvas')
  private canvas!: HTMLCanvasElement;
  
  // Private variable to store game state
  private _gameState: string = '';
  
  // Getter for gameState that can be accessed from HTML template
  get gameState(): string {
    return this._gameState;
  }
  
  // Setter that processes game state updates on every change
  set gameState(value: string) {
    const oldValue = this._gameState;
    this._gameState = value;
    
    try {
      if (value && typeof value === 'string') {
        // Try to parse the game state as JSON
        let parsed;
        try {
          parsed = JSON.parse(value);
        } catch (parseError) {
          console.error('Initial JSON parse failed:', parseError);
          console.error('Game state is not valid JSON:', value);
          return;
        }
        
        // Handle the format from DataStar in views/index.templ
        // The gameState property in our component gets ONLY the inner JSON
        // directly from the server via: data-attr-game-state__case.kebab="$gameState"
        
        // CASE 1: Direct players object (most likely format)
        if (parsed && parsed.players && typeof parsed.players === 'object') {
          this.multiplayerState = parsed;
        }
        // CASE 2: Maybe we still have a gameState wrapper in some cases
        else if (parsed && parsed.gameState) {
          // If gameState is an object with players, use it directly
          if (typeof parsed.gameState === 'object' && parsed.gameState.players) {
            this.multiplayerState = parsed.gameState;
          }
          // If gameState is a string, try to parse it
          else if (typeof parsed.gameState === 'string') {
            try {
              const nestedState = JSON.parse(parsed.gameState);
              if (nestedState && nestedState.players) {
                this.multiplayerState = nestedState;
              }
            } catch (err) {
              console.error('Failed to parse nested gameState string:', err);
              return;
            }
          }
        } 
        else {
          console.error('Unrecognized game state format - missing players object:', parsed);
          return;
        }
        
        // Count the players in the state
        const playerCount = this.multiplayerState && this.multiplayerState.players ? 
          Object.keys(this.multiplayerState.players).length : 0;
        
        // Update remote players
        this.updateRemotePlayers();
        
        // Use the player ID from the attribute, or generate one if not set
        if (!this.gameStateInitialized && this.playerTank) {
          if (!this.playerId) {
            // Generate fallback ID only if attribute wasn't set
            this.playerId = 'player_' + Math.random().toString(36).substring(2, 9);
            console.log('No player-id attribute found, using random ID:', this.playerId);
          } else {
            console.log('Using player ID from attribute:', this.playerId);
          }
          
          // Set the player ID on the tank
          if (this.playerTank && typeof this.playerTank.setOwnerId === 'function') {
            this.playerTank.setOwnerId(this.playerId);
            console.log('Set player tank owner ID:', this.playerId);
          }
          
          console.log('My position:', this.playerTank.tank.position);
          this.gameStateInitialized = true;
        }
      }
    } catch (error) {
      console.error('Error parsing game state:', error);
      console.error('Raw game state that caused error:', value);
    }
    
    // Notify LitElement that a property changed
    this.requestUpdate('gameState', oldValue);
  }
  
  // Parsed multiplayer state
  @property({ attribute: false })
  private multiplayerState?: MultiplayerGameState;
  
  // Define properties to connect HTML attributes to properties
  static get properties() {
    return {
      gameState: { 
        type: String,
        attribute: 'game-state', 
        reflect: true 
      },
      playerId: { 
        type: String, 
        attribute: 'player-id' 
      }
    };
  }
  
  // Player ID from server-side attribute
  @property({ type: String, attribute: 'player-id' })
  public playerId: string = '';
  
  // Flag to track if we've processed initial game state
  private gameStateInitialized: boolean = false;
  
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
  private remoteTanks: Map<string, NPCTank> = new Map();
  private npcTanks: NPCTank[] = [];
  // Disabled NPC tanks for multiplayer testing
  private readonly NUM_NPC_TANKS = 0;
  
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
  
  // Kill notification system
  private killNotifications: { text: string, time: number }[] = [];
  private readonly MAX_NOTIFICATIONS = 5; // Maximum number of visible notifications
  private readonly NOTIFICATION_DURATION = 5000; // How long notifications stay visible (ms)
  
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
      bottom: 75px;
      left: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 10px;
      border-radius: 5px;
      font-family: monospace;
      pointer-events: none;
    }
    
    .player-count {
      position: absolute;
      top: 75px;
      right: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 10px;
      border-radius: 5px;
      font-family: monospace;
      pointer-events: none;
      font-size: 18px;
      font-weight: bold;
      min-width: 200px;
      text-align: right;
    }
    
    .game-state-display {
      position: absolute;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 10px;
      border-radius: 5px;
      font-family: monospace;
      pointer-events: none;
      z-index: 1000;
      font-size: 16px;
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
    
    /* Kill notifications */
    .kill-notifications {
      position: absolute;
      bottom: 20px;
      right: 20px;
      width: 300px;
      max-height: 300px;
      display: flex;
      flex-direction: column;
      gap: 5px;
      pointer-events: none;
      overflow: hidden;
    }
    
    .kill-notification {
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 8px 12px;
      border-radius: 5px;
      font-family: Arial, sans-serif;
      font-size: 14px;
      transform-origin: right;
      animation: notification-enter 0.3s ease-out, notification-exit 0.5s ease-in forwards;
      animation-delay: 0s, 4.5s;
      opacity: 0.9;
      text-shadow: 1px 1px 2px black;
    }
    
    @keyframes notification-enter {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 0.9;
      }
    }
    
    @keyframes notification-exit {
      from {
        transform: translateX(0);
        opacity: 0.9;
      }
      to {
        transform: translateX(100%);
        opacity: 0;
      }
    }
    
    .kill-notification .killer {
      color: #ff9900; /* Orange for the killer's name */
      font-weight: bold;
    }
    
    .kill-notification .victim {
      color: #ff3333; /* Red for the victim's name */
      font-weight: bold;
    }
  `;

  render() {
    return html`
      <div>
        <div class="${this.cameraShaking ? 'camera-shake' : ''}">
          <canvas id="canvas"></canvas>
          <div class="damage-overlay ${this.showDamageOverlay ? 'active' : ''}"></div>
          
          <game-stats></game-stats>
          <game-radar 
            .playerId="${this.playerId}" 
            .gameState="${this.multiplayerState}"
          ></game-radar>
          <div class="controls">
            <div>W: Forward, S: Backward</div>
            <div>A: Rotate tank left, D: Rotate tank right</div>
            <div>Mouse: Aim turret and barrel</div>
            <div>Arrow keys: Alternative turret control</div>
            <div>Left Click, Space, or F: Fire shell</div>
            <div>Click canvas to lock pointer</div>
          </div>
          <div class="player-count">
            Players: ${this.multiplayerState?.players ? Object.keys(this.multiplayerState.players).length : 0}
          </div>
          <div class="game-over ${this.playerDestroyed ? 'visible' : ''}">
            <div class="wasted-text">Wasted</div>
          </div>
          
          <!-- Kill notifications container -->
          <div class="kill-notifications">
            ${this.killNotifications.map(notification => html`
              <div class="kill-notification">
                <span .innerHTML=${notification.text}></span>
              </div>
            `)}
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
    
    // Listen for shell fired events for multiplayer
    this.handleShellFired = this.handleShellFired.bind(this);
    document.addEventListener('shell-fired', this.handleShellFired);
    
    // Listen for tank respawn events
    this.handleTankRespawn = this.handleTankRespawn.bind(this);
    document.addEventListener('tank-respawn', this.handleTankRespawn);
    
    // Initialize game stats
    this.updateStats();
  }
  
  // Handle tank respawn events
  private handleTankRespawn(event: CustomEvent) {
    // Get respawn data
    const respawnData = event.detail;
    
    // Update playerId if it's the local player
    if (respawnData.playerId === 'player') {
      respawnData.playerId = this.playerId;
    }
    
    // Create a custom event for DataStar to send to server
    const tankRespawnEvent = new CustomEvent('tank-respawn-sync', { 
      detail: respawnData,
      bubbles: true,
      composed: true
    });
    
    // Dispatch the event to be sent to the server
    this.dispatchEvent(tankRespawnEvent);
  }
  
  // Handle shell fired events from player tank
  private handleShellFired(event: CustomEvent) {
    // Skip if this is not a player-initiated event (to prevent loops)
    if (event.detail.isNetworkEvent) {
      return;
    }
    
    // Get shell data from event
    const position = event.detail.position;
    const direction = event.detail.direction;
    const speed = event.detail.speed;
    
    // Make sure we have all required data
    if (!position || !direction || !speed) {
      console.error('Invalid shell data:', event.detail);
      return;
    }
    
    // Create a unique shell ID if not already present
    const shellId = event.detail.shellId || `shell_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create a custom event for DataStar to send to server - with a different name
    const shellFiredSyncEvent = new CustomEvent('shell-fired-sync', { 
      detail: {
        shellId: shellId,
        playerId: this.playerId,
        position: {
          x: position.x,
          y: position.y,
          z: position.z
        },
        direction: {
          x: direction.x,
          y: direction.y,
          z: direction.z
        },
        speed: speed,
        isNetworkEvent: true // Mark as a network event
      },
      bubbles: true,
      composed: true // Allows the event to cross shadow DOM boundaries
    });
    
    // Dispatch the sync event to be sent to the server
    this.dispatchEvent(shellFiredSyncEvent);
  }
  
  // Only handling other property changes
  updated(changedProperties: Map<string, any>) {
    // Game state is now handled directly in the setter
  }
  
  // Update remote players from game state
  private updateRemotePlayers() {
    // First, wait until we have a valid scene initialized
    if (!this.scene) {
      console.error('Cannot update remote players: scene not initialized');
      return;
    }
    
    // Check for valid game state
    if (!this.multiplayerState) {
      console.error('Cannot update remote players: no multiplayer state available');
      return;
    }
    
    // Check for valid players object
    if (!this.multiplayerState.players) {
      console.error('No players object in multiplayer state:', this.multiplayerState);
      return;
    }
    
    // Get player keys
    const playerKeys = Object.keys(this.multiplayerState.players);
    if (playerKeys.length === 0) {
      console.warn('Players object is empty - no players to update');
      return;
    }
    
    // Wait until we have a player ID before processing (important for multiplayer)
    if (!this.playerId) {
      console.error('Waiting for player ID before processing remote players');
      return;
    }
    
    // Process each player in the game state
    for (const [playerId, playerData] of Object.entries(this.multiplayerState.players)) {
      // Skip our own player - this is crucial for multiplayer
      if (playerId === this.playerId) {
        continue;
      }
      
      // Death and respawn handling:
      // Check if player has died (health = 0) but we still have a tank for them
      if (playerData.health <= 0 && this.remoteTanks.has(playerId)) {
        const tank = this.remoteTanks.get(playerId);
        // Only handle death if the tank is not already destroyed
        if (tank && tank.getHealth() > 0) {
          console.log(`Remote player ${playerId} died, updating tank health to 0`);
          tank.setHealth(0); // This will trigger the death effects
        }
      }
      // Check if player respawned - player in state with health>0 but tank is destroyed or missing
      else if (playerData.health > 0) {
        const existingTank = this.remoteTanks.get(playerId);
        
        // Case 1: Tank doesn't exist - create a new one
        if (!existingTank) {
          this.createRemoteTank(playerId, playerData);
        }
        // Case 2: Tank exists but is destroyed - remove it and create a new one
        else if (existingTank.getHealth() <= 0) {
          console.log(`Remote player ${playerId} respawned - replacing tank instance`);
          
          // Clean up old tank
          this.collisionSystem.removeCollider(existingTank);
          existingTank.dispose();
          this.remoteTanks.delete(playerId);
          
          // Create completely new tank at the respawn position
          this.createRemoteTank(playerId, playerData);
        }
        // Case 3: Tank exists and is not destroyed - normal position update
        else {
          this.updateRemoteTankPosition(existingTank, playerData);
        }
      }
    }
    
    // Remove tanks for players that are no longer in the game state
    for (const [playerId, tank] of this.remoteTanks.entries()) {
      if (!this.multiplayerState.players[playerId]) {
        // Remove tank from scene and collision system
        this.collisionSystem.removeCollider(tank);
        tank.dispose();
        this.remoteTanks.delete(playerId);
      }
    }
  }
  
  // Create a new remote tank for another player
  private createRemoteTank(playerId: string, playerData: PlayerState) {
    if (!this.scene) return;
    
    try {
      // Ensure we have position data
      if (!playerData.position) {
        console.error('Remote player data missing position:', playerData);
        return;
      }
      
      // Create a position vector from the player data
      const position = new THREE.Vector3(
        playerData.position.x,
        playerData.position.y,
        playerData.position.z
      );
      
      // Create a new NPC tank with the player's name and color
      // Handle different color formats (hex string or object with r,g,b)
      let tankColor = 0xff0000; // Default red
      if (playerData.color) {
        if (typeof playerData.color === 'string' && playerData.color.startsWith('#')) {
          tankColor = parseInt(playerData.color.substring(1), 16);
        }
      }
      
      const tankName = playerData.name || `Player ${playerId.substring(0, 6)}`;
      
      // Create the remote tank
      const remoteTank = new NPCTank(
        this.scene,
        position,
        tankColor,
        tankName
      );
      
      // Set the tank's owner ID
      if (typeof remoteTank.setOwnerId === 'function') {
        remoteTank.setOwnerId(playerId);
      }
      
      // Set initial rotation if available
      if (typeof playerData.tankRotation === 'number') {
        remoteTank.tank.rotation.y = playerData.tankRotation;
      }
      
      if (typeof playerData.turretRotation === 'number') {
        remoteTank.turretPivot.rotation.y = playerData.turretRotation;
      }
      
      if (typeof playerData.barrelElevation === 'number') {
        remoteTank.barrelPivot.rotation.x = playerData.barrelElevation;
      }
      
      // Set health if available
      if (typeof playerData.health === 'number' && typeof remoteTank.setHealth === 'function') {
        remoteTank.setHealth(playerData.health);
      }
      
      // Add debug visualization - big blue transparent cube
      this.addDebugVisualToRemoteTank(remoteTank);
      
      // Add to collision system
      this.collisionSystem.addCollider(remoteTank);
      
      // Store in remoteTanks map
      this.remoteTanks.set(playerId, remoteTank);
    } catch (error) {
      console.error('Error creating remote tank:', error);
      console.error('Problem player data:', playerData);
    }
  }
  
  // Add debug visualization to remote tank
  private addDebugVisualToRemoteTank(remoteTank: NPCTank): void {
    // Create a red triangle that bobs up and down
    const triangleHeight = 5; // Height of the triangle
    const triangleWidth = 4;  // Width of the triangle at the base
    
    // Create an upside-down triangle geometry
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      0, 0, 0,                 // bottom point
      -triangleWidth/2, triangleHeight, 0,  // top left
      triangleWidth/2, triangleHeight, 0    // top right
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex([0, 1, 2]); // Connect vertices to form a triangle
    
    // Create a red material
    const material = new THREE.MeshBasicMaterial({
      color: 0xff0000,        // Bright red
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide  // Visible from both sides
    });
    
    // Create the triangle mesh
    const triangleMesh = new THREE.Mesh(geometry, material);
    
    // Position it above the tank
    triangleMesh.position.set(0, 6, 0);
    
    // Add animation data as properties on the mesh object
    triangleMesh.userData = {
      bobOffset: Math.random() * Math.PI * 2, // Random start phase
      bobSpeed: 1.5 + Math.random() * 0.5     // Slightly random speed
    };
    
    // Add an update function for the animation
    // This will be called in the animation loop
    const animate = function() {
      if (triangleMesh && triangleMesh.userData) {
        triangleMesh.position.y = 6 + Math.sin(Date.now() * 0.003 + triangleMesh.userData.bobOffset) * 0.5;
        triangleMesh.rotation.y += 0.02; // Rotate about y-axis
        requestAnimationFrame(animate);
      }
    };
    
    // Start the animation
    animate();
    
    // Add the triangle to the tank
    remoteTank.tank.add(triangleMesh);
        
    console.log('Added visuals to remote tank');
  }
  
  // Update an existing remote tank's position and rotation
  private updateRemoteTankPosition(tank: NPCTank, playerData: PlayerState) {
    // Don't log every position update - they happen frequently
    
    try {
      // Ensure we have position data
      if (!playerData.position) {
        console.error('Cannot update remote tank: Missing position data');
        return;
      }
      
      // Update position with interpolation for smooth movement
      tank.tank.position.lerp(
        new THREE.Vector3(
          playerData.position.x,
          playerData.position.y,
          playerData.position.z
        ),
        0.2 // Lower interpolation factor for smoother movement
      );
      
      // Update rotations if provided
      if (typeof playerData.tankRotation === 'number') {
        tank.tank.rotation.y = this.lerpAngle(tank.tank.rotation.y, playerData.tankRotation, 0.2);
      }
      
      if (typeof playerData.turretRotation === 'number') {
        tank.turretPivot.rotation.y = this.lerpAngle(tank.turretPivot.rotation.y, playerData.turretRotation, 0.2);
      }
      
      if (typeof playerData.barrelElevation === 'number') {
        tank.barrelPivot.rotation.x = this.lerpAngle(tank.barrelPivot.rotation.x, playerData.barrelElevation, 0.2);
      }
      
      // Handle normal health updates for alive tanks
      if (typeof playerData.health === 'number' && typeof tank.setHealth === 'function') {
        tank.setHealth(playerData.health);
      }
      
      // Position updates happen frequently - don't log them
    } catch (error) {
      console.error('Error updating remote tank:', error);
      console.error('Problem player data:', playerData);
    }
  }
  
  // Helper for angle interpolation (handles wrapping)
  private lerpAngle(start: number, end: number, t: number): number {
    // Handle angle wrapping for smoothest path
    let diff = end - start;
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return start + diff * t;
  }
  
  // Maps to track shells across frames
  private static readonly processedShellIds = new Map<string, number>(); // Maps shellId to creation timestamp
  private lastShellProcessTime = 0; // Timestamp of last shell processing
  
  // Process shells from the game state
  private processRemoteShells(): void {
    if (!this.scene || !this.multiplayerState?.shells) return;
    
    const currentTime = Date.now();
    
    // Only process shells once every 300ms to avoid creating duplicates
    // This acts as a stronger rate limiter for shell processing
    if (currentTime - this.lastShellProcessTime < 300) {
      return;
    }
    
    this.lastShellProcessTime = currentTime;
    
    // Clean up old shell records (older than 10 seconds)
    for (const [shellId, timestamp] of GameComponent.processedShellIds.entries()) {
      if (currentTime - timestamp > 10000) {
        GameComponent.processedShellIds.delete(shellId);
      }
    }
    
    // Create a set of current shell IDs in this game state update
    const currentShellIds = new Set(this.multiplayerState.shells.map(shell => shell.id));
    
    // Process each shell in the game state
    for (const shellState of this.multiplayerState.shells) {
      // Skip shells from this player and shells we've already processed
      if (shellState.playerId === this.playerId || GameComponent.processedShellIds.has(shellState.id)) {
        continue;
      }
      
      // Find the source tank (the one that fired the shell)
      let sourceTank: ITank | null = null;
      
      // Use remote tank if available
      if (this.remoteTanks.has(shellState.playerId)) {
        sourceTank = this.remoteTanks.get(shellState.playerId) || null;
      }
      
      // Skip if we can't find a valid source tank
      if (!sourceTank) {
        continue;
      }
      
      // Create a position vector from the shell data
      const position = new THREE.Vector3(
        shellState.position.x,
        shellState.position.y,
        shellState.position.z
      );
      
      // Create a direction vector from the shell data
      const direction = new THREE.Vector3(
        shellState.direction.x,
        shellState.direction.y,
        shellState.direction.z
      ).normalize(); // Make sure it's normalized
      
      // Create a new shell with the source tank and the shell ID
      const shell = new Shell(
        this.scene,
        position,
        direction,
        shellState.speed,
        sourceTank,
        shellState.id // Pass the shell ID from the state
      );
      
      // Add the shell to active shells
      this.addShell(shell);
      
      // Mark this shell as processed with current timestamp
      GameComponent.processedShellIds.set(shellState.id, currentTime);
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
    this.createRockFormation();
    
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
  
  private createRockFormation() {
    if (!this.scene || !this.mapGenerator) return;
    
    // Build the rock formation
    this.mapGenerator.createRockFormation();
    
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
      
      // Create tank with color from the colors array and a random name
      const npcTank = new NPCTank(
        this.scene,
        position,
        colors[i % colors.length],
        // Name is auto-generated in the Tank constructor
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
      // Set up mouse events on the canvas
      
      // Add click handler to canvas for requesting pointer lock
      this.canvas.addEventListener('click', () => {
        // Request pointer lock on canvas click
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
      // Space key for firing
      this.keys['space'] = true;
    }
    
    // No need to log every key press
    
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
    
    // Key release event
  }
  
  private handlePointerLockChange() {
    // Check if the pointer is now locked
    this.isPointerLocked = 
      document.pointerLockElement === this.canvas ||
      (document as any).mozPointerLockElement === this.canvas ||
      (document as any).webkitPointerLockElement === this.canvas;
    
    // Force UI update
    this.requestUpdate();
    
    // Update pointer lock state
  }
  
  private handleMouseMove(event: MouseEvent) {
    // Skip if we don't have a player tank
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
    
    // Store camera position for health bar billboarding and audio
    if (this.camera) {
      (window as any).cameraPosition = this.camera.position;
      
      // Update audio listener position for all spatial audio
      if (typeof window.SpatialAudio?.setGlobalListener === 'function') {
        window.SpatialAudio.setGlobalListener(this.camera.position);
      }
    }
    
    // Process any pending game state updates in the animation loop
    // This ensures we constantly check for remote player updates
    if (this.multiplayerState && this.scene && this.gameStateInitialized) {
      // Check for remote players periodically in the animation loop
      const frameCount = this.renderer?.info.render.frame || 0;
      
      if (frameCount % 60 === 0) { // Process once per second (at 60fps)
        // Periodic checks are helpful but don't need to log every time
        this.updateRemotePlayers();
      }
      
      // Process remote shells - this is now rate-limited internally
      if (this.multiplayerState.shells && this.multiplayerState.shells.length > 0) {
        this.processRemoteShells();
      }
    }
    
    // Update crosshair position to align with tank barrel
    this.updateCrosshairPosition();
    
    // Update kill notifications (remove expired ones)
    this.updateKillNotifications();
    
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
      
      // Emit player position and orientation event, but limit frequency
      // Only emit every 5 frames to reduce event frequency
      if (this.animationFrameId % 5 === 0) {
        this.emitPlayerPositionEvent();
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
      
      // Send tank hit event to server for synchronization
      if (source && source !== this.playerTank) {
        // Create tank hit event for server
        const tankHitEvent = new CustomEvent('tank-hit-sync', {
          detail: {
            targetId: this.playerId,
            sourceId: source.getOwnerId ? source.getOwnerId() : 'unknown',
            damageAmount: damageAmount
          },
          bubbles: true,
          composed: true
        });
        this.dispatchEvent(tankHitEvent);
      }
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
    
    // Get tank names
    let killerName = "Unknown";
    let victimName = "Unknown";
    let killerId = "unknown";
    let victimId = "unknown";
    
    // Get victim name and ID
    if (tank === this.playerTank) {
      victimName = "Player";
      victimId = this.playerId;
    } else {
      // Find NPC tank name
      const npcIndex = this.npcTanks.findIndex(npc => npc === tank);
      if (npcIndex !== -1) {
        victimName = this.npcTanks[npcIndex].tankName || `NPC ${npcIndex + 1}`;
        victimId = `npc_${npcIndex}`;
      } else {
        // Check if it's a remote player
        for (const [id, remoteTank] of this.remoteTanks.entries()) {
          if (remoteTank === tank) {
            victimName = remoteTank.tankName || `Player ${id.substr(0, 6)}`;
            victimId = id;
            break;
          }
        }
      }
    }
    
    // Get killer name and ID
    if (source === this.playerTank) {
      killerName = "Player";
      killerId = this.playerId;
    } else if (source) {
      // Find NPC tank name
      const npcIndex = this.npcTanks.findIndex(npc => npc === source);
      if (npcIndex !== -1) {
        killerName = this.npcTanks[npcIndex].tankName || `NPC ${npcIndex + 1}`;
        killerId = `npc_${npcIndex}`;
      } else {
        // Check if it's a remote player
        for (const [id, remoteTank] of this.remoteTanks.entries()) {
          if (remoteTank === source) {
            killerName = remoteTank.tankName || `Player ${id.substr(0, 6)}`;
            killerId = id;
            break;
          }
        }
      }
    }
    
    // Add kill notification
    this.addKillNotification(killerName, victimName);
    
    // Check if this is the player tank
    if (tank === this.playerTank) {
      console.log('Player tank destroyed!');
      this.playerDestroyed = true;
      this.respawnTimer = 0;
      this.playerDeaths++;
      
      // Show death effects
      this.showPlayerDeathEffects();
      
      // Send tank death event to server
      const tankDeathEvent = new CustomEvent('tank-death-sync', {
        detail: {
          targetId: victimId,
          sourceId: killerId
        },
        bubbles: true,
        composed: true
      });
      this.dispatchEvent(tankDeathEvent);
      
      // Update stats
      this.updateStats();
    } else {
      // It's an NPC tank or a remote player
      console.log('Tank destroyed!', { victimName, killerName });
      
      // If destroyed by player, increment kill count and send event to server
      if (source === this.playerTank) {
        this.playerKills++;
        this.updateStats();
        
        // Send tank death event to server
        const tankDeathEvent = new CustomEvent('tank-death-sync', {
          detail: {
            targetId: victimId,
            sourceId: killerId
          },
          bubbles: true,
          composed: true
        });
        this.dispatchEvent(tankDeathEvent);
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
   * Adds a kill notification with random destruction verb
   */
  private addKillNotification(killerName: string, victimName: string): void {
    const verbs = [
      "obliterated",
      "destroyed",
      "eliminated",
      "vaporized",
      "annihilated",
      "demolished",
      "terminated",
      "crushed",
      "wrecked",
      "decimated",
      "shattered",
      "dismantled",
      "erased",
      "disintegrated",
      "neutralized"
    ];
    
    // Choose a random verb
    const verb = verbs[Math.floor(Math.random() * verbs.length)];
    
    // Create the notification text with HTML for styling
    const notificationText = `<span class="killer">${killerName}</span> ${verb} <span class="victim">${victimName}</span>`;
    
    // Add to the notifications array
    this.killNotifications.push({
      text: notificationText,
      time: Date.now()
    });
    
    // Limit to max notifications by removing oldest if needed
    if (this.killNotifications.length > this.MAX_NOTIFICATIONS) {
      this.killNotifications.shift(); // Remove oldest notification
    }
    
    // Request UI update
    this.requestUpdate();
  }
  
  /**
   * Update and remove expired notifications
   */
  private updateKillNotifications(): void {
    const currentTime = Date.now();
    let changed = false;
    
    // Filter out notifications older than NOTIFICATION_DURATION
    const activeNotifications = this.killNotifications.filter(notification => {
      return currentTime - notification.time < this.NOTIFICATION_DURATION;
    });
    
    // If we removed any notifications, update the array and request UI update
    if (activeNotifications.length !== this.killNotifications.length) {
      this.killNotifications = activeNotifications;
      this.requestUpdate();
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
  
  /**
   * Emits a custom event with player position and orientation data
   * Event includes position coordinates, tank rotation, turret rotation, and barrel elevation
   */
  private emitPlayerPositionEvent(): void {
    if (!this.playerTank) return;
    
    // Only emit if we have a playerId assigned (important for multiplayer)
    if (!this.playerId) {
      console.log('Cannot emit position: No player ID assigned yet');
      return;
    }
    
    // Create event detail with all relevant position and orientation data
    // Ensuring all data is clean serializable JSON
    const detail = {
      // Add player ID
      id: this.playerId,
      
      // Position data (convert THREE.Vector3 to simple object)
      position: {
        x: this.playerTank.tank.position.x,
        y: this.playerTank.tank.position.y,
        z: this.playerTank.tank.position.z
      },
      
      // Rotation data (simple numeric values)
      tankRotation: this.playerTank.tank.rotation.y,
      turretRotation: this.playerTank.turretPivot.rotation.y,
      barrelElevation: this.playerTank.barrelPivot.rotation.x,
      
      // Additional data
      health: this.playerTank.getHealth(),
      isMoving: this.playerTank.isMoving(),
      velocity: this.playerTank.getVelocity ? this.playerTank.getVelocity() : 0,
      
      // Timestamp for tracking
      timestamp: Date.now()
    };
    
    // Position updates are frequent, so don't log them
    // console.log(`Emitting position update for player ${this.playerId}`);
    
    // Create and dispatch custom event
    const event = new CustomEvent('player-movement', { 
      detail,
      bubbles: true,
      composed: true // Allows the event to cross shadow DOM boundaries
    });
    
    this.dispatchEvent(event);
  }
}

// Define the player movement event type for TypeScript
declare global {
  interface Window {
    _processedFireEvents?: Set<string>;
    cameraPosition?: THREE.Vector3;
  }
  
  interface HTMLElementTagNameMap {
    'game-component': GameComponent;
  }
  
  interface HTMLElementEventMap {
    'player-movement': CustomEvent<{
      position: {
        x: number;
        y: number;
        z: number;
      };
      tankRotation: number;
      turretRotation: number;
      barrelElevation: number;
      health: number;
      isMoving: boolean;
      velocity: number;
      timestamp: number;
    }>;
  }
}
