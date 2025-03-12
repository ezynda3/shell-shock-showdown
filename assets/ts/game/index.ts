import { LitElement, html, css } from 'lit';
import { customElement, query, property } from 'lit/decorators.js';
import * as THREE from 'three';
import { MapGenerator } from './map';
import { Tank, RemoteTank, NPCTank, ITank, ICollidable, SpatialAudio } from './tank';
import { CollisionSystem } from './collision';
import { Shell } from './shell';
import './stats'; // Import stats component

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
        
        // Update local player health from server state if available
        this.updateLocalPlayerHealth();
        
        // Update game stats with server data (kills, deaths, etc.)
        this.updateStats();
        
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
      },
      mapData: {
        type: String,
        attribute: 'map-data'
      }
    };
  }
  
  // Player ID from server-side attribute
  @property({ type: String, attribute: 'player-id' })
  public playerId: string = '';
  
  // Map data from server
  @property({ type: String, attribute: 'map-data' })
  public mapData: string = '';
  
  @property({ type: String, attribute: 'notification' })
  public notification: string = '';
  
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
  private remoteTanks: Map<string, RemoteTank> = new Map();
  
  // Performance settings
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
  private processedDeathEvents = new Set<string>(); // Track processed death events
  
  // Control state
  private keys: { [key: string]: boolean } = {};
  
  // Fullscreen state
  private isFullscreen: boolean = false;
  
  // Assets
  // Sky gradient colors
  private skyColor: THREE.Color = new THREE.Color(0x87ceeb); // Sky blue
  // Ground material reference for shader updates
  private groundMaterial?: THREE.ShaderMaterial;

  static styles = css`
    .kill-notification-banner {
      position: fixed;
      top: 80px;
      left: 50%;
      transform: translateX(-50%);
      background-color: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 10px 20px;
      border-radius: 5px;
      font-size: 18px;
      font-weight: bold;
      z-index: 1000;
      text-align: center;
      animation: fadeInOut 3s ease-in-out;
    }
    
    @keyframes fadeInOut {
      0% { opacity: 0; }
      10% { opacity: 1; }
      90% { opacity: 1; }
      100% { opacity: 0; }
    }
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
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
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

    /* Mobile touch controls */
    .touch-controls {
      position: absolute;
      width: 100%;
      height: 100%;
      top: 0;
      left: 0;
      pointer-events: none;
      z-index: 900;
      display: none; /* Hidden by default, shown for mobile */
    }

    @media (max-width: 1024px), (pointer: coarse) {
      .touch-controls {
        display: block;
      }
    }

    /* Movement joystick (left) */
    .joystick-container {
      position: absolute;
      bottom: 80px;
      left: 80px;
      width: 150px;  /* Increased size for easier touch control */
      height: 150px; /* Increased size for easier touch control */
      background: rgba(50, 205, 50, 0.15); /* Light green tint */
      border: 3px solid rgba(50, 205, 50, 0.5); /* Green border */
      border-radius: 50%;
      pointer-events: all;
      touch-action: none;
      box-shadow: 0 0 15px rgba(50, 205, 50, 0.3);
    }

    .joystick-thumb {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 60px;   /* Larger thumb for better visibility */
      height: 60px;  /* Larger thumb for better visibility */
      background: rgba(255, 255, 255, 0.9);
      border: 2px solid rgba(50, 205, 50, 0.8);
      border-radius: 50%;
      box-shadow: 0 0 12px rgba(0, 0, 0, 0.4);
    }

    /* Turret control joystick (right) */
    .turret-joystick-container {
      position: absolute;
      bottom: 80px;
      right: 80px;
      width: 150px;  /* Same increased size as movement joystick */
      height: 150px; /* Same increased size as movement joystick */
      background: rgba(30, 144, 255, 0.15); /* Light blue tint */
      border: 3px solid rgba(30, 144, 255, 0.5); /* Blue border */
      border-radius: 50%;
      pointer-events: all;
      touch-action: none;
      box-shadow: 0 0 15px rgba(30, 144, 255, 0.3);
    }
    
    .turret-joystick-thumb {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 60px;   /* Larger thumb */
      height: 60px;  /* Larger thumb */
      background: rgba(255, 255, 255, 0.9);
      border: 2px solid rgba(30, 144, 255, 0.8);
      border-radius: 50%;
      box-shadow: 0 0 12px rgba(0, 0, 0, 0.4);
    }

    /* Directional indicators for joysticks */
    .joystick-container::before, .turret-joystick-container::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      width: 60%;
      height: 60%;
      transform: translate(-50%, -50%);
      background-image: radial-gradient(circle, transparent 60%, rgba(255, 255, 255, 0.2) 60%, rgba(255, 255, 255, 0.2) 70%, transparent 70%),
                        conic-gradient(transparent 0deg, rgba(255, 255, 255, 0.3) 0deg, rgba(255, 255, 255, 0.3) 45deg, transparent 45deg, 
                                       transparent 135deg, rgba(255, 255, 255, 0.3) 135deg, rgba(255, 255, 255, 0.3) 180deg, 
                                       transparent 180deg, transparent 270deg, rgba(255, 255, 255, 0.3) 270deg, rgba(255, 255, 255, 0.3) 315deg, transparent 315deg);
      border-radius: 50%;
      pointer-events: none;
    }

    /* Fire button */
    .fire-button {
      position: absolute;
      bottom: 110px;
      left: 50%;     /* Center horizontally */
      transform: translateX(-50%); /* Center horizontally */
      width: 100px;   /* Increased size */
      height: 100px;  /* Increased size */
      background: rgba(255, 30, 30, 0.7); /* More vibrant red */
      border: 4px solid rgba(255, 255, 255, 0.7);
      border-radius: 50%;
      pointer-events: all;
      display: flex;
      justify-content: center;
      align-items: center;
      font-weight: bold;
      color: white;
      font-size: 20px;  /* Larger text */
      text-shadow: 0 2px 3px rgba(0, 0, 0, 0.9);
      touch-action: none;
      box-shadow: 0 0 20px rgba(255, 30, 30, 0.5);
    }

    .fire-button:active {
      background: rgba(255, 30, 30, 0.9);
      transform: translateX(-50%) scale(0.92);
      box-shadow: 0 0 25px rgba(255, 30, 30, 0.8);
    }
    
    /* Fullscreen button */
    .fullscreen-button {
      position: absolute;
      top: 20px;
      right: 20px;
      width: 50px;
      height: 50px;
      background: rgba(0, 0, 0, 0.6);
      border: 3px solid rgba(255, 255, 255, 0.6);
      border-radius: 50%;
      pointer-events: all;
      display: flex;
      justify-content: center;
      align-items: center;
      color: white;
      font-size: 22px;
      z-index: 1000;
      touch-action: none;
      box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
    }
    
    .fullscreen-button:active {
      background: rgba(0, 0, 0, 0.8);
      transform: scale(0.95);
    }
    
    /* Visual label for joysticks */
    .joystick-label {
      position: absolute;
      top: -30px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 14px;
      color: rgba(255, 255, 255, 0.8);
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
      white-space: nowrap;
      pointer-events: none;
    }
  `;

  render() {
    return html`
      <div>
        ${this.notification ? html`<div class="kill-notification-banner">${this.notification}</div>` : ''}
        <div class="${this.cameraShaking ? 'camera-shake' : ''}">
          <canvas id="canvas"></canvas>
          <div class="damage-overlay ${this.showDamageOverlay ? 'active' : ''}"></div>
          
          <game-stats></game-stats>
          <div class="controls" style="display: ${this.isMobile ? 'none' : 'block'}">
            <div>W: Forward, S: Backward</div>
            <div>A: Rotate tank left, D: Rotate tank right</div>
            <div>Mouse: Aim turret and barrel</div>
            <div>Arrow keys: Alternative turret control</div>
            <div>Left Click, Space, or F: Fire shell</div>
            <div>F11: Toggle fullscreen</div>
            <div>Click canvas to lock pointer</div>
          </div>
          <div class="game-over ${this.playerDestroyed ? 'visible' : ''}">
            <div class="wasted-text">Wasted</div>
          </div>
          
          <!-- Touch controls for mobile devices -->
          <div class="touch-controls">
            <!-- Movement joystick -->
            <div class="joystick-container" id="joystick-container">
              <div class="joystick-label">MOVE</div>
              <div class="joystick-thumb" id="joystick-thumb"></div>
            </div>
            
            <!-- Turret joystick -->
            <div class="turret-joystick-container" id="turret-joystick-container">
              <div class="joystick-label">AIM</div>
              <div class="turret-joystick-thumb" id="turret-joystick-thumb"></div>
            </div>
            
            <!-- Fire button -->
            <div class="fire-button" id="fire-button">FIRE</div>
            
            <!-- Fullscreen toggle button -->
            <div class="fullscreen-button" id="fullscreen-button">⛶</div>
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

  // Touch controls properties
  private isMobile: boolean = false;
  private joystickActive: boolean = false;
  private joystickPosition = { x: 0, y: 0 };
  private joystickTouchId: number | null = null;
  private turretJoystickActive: boolean = false;
  private turretJoystickPosition = { x: 0, y: 0 };
  private turretJoystickTouchId: number | null = null;
  private fireButtonActive: boolean = false;
  private joystickContainer?: HTMLElement;
  private joystickThumb?: HTMLElement;
  private turretJoystickContainer?: HTMLElement;
  private turretJoystickThumb?: HTMLElement;
  private fireButton?: HTMLElement;
  private fullscreenButton?: HTMLElement;
  // Track active touch points by ID
  private activeTouches: Map<number, { element: string, x: number, y: number }> = new Map();

  firstUpdated() {
    this.initThree();
    this.initKeyboardControls();
    this.initTouchControls();
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

    // Check if device is mobile/touch
    this.detectMobileDevice();
  }

  // Detect if user is on a mobile/touch device
  private detectMobileDevice(): void {
    this.isMobile = 
      ('ontouchstart' in window) || 
      (navigator.maxTouchPoints > 0) || 
      (typeof window.matchMedia === 'function' && window.matchMedia("(pointer: coarse)").matches);
    
    console.log(`Device detected as ${this.isMobile ? 'mobile/touch' : 'desktop'}`);
  }

  // Initialize touch controls for mobile devices
  private initTouchControls(): void {
    // Get references to touch control elements
    this.joystickContainer = this.shadowRoot?.getElementById('joystick-container') as HTMLElement;
    this.joystickThumb = this.shadowRoot?.getElementById('joystick-thumb') as HTMLElement;
    this.turretJoystickContainer = this.shadowRoot?.getElementById('turret-joystick-container') as HTMLElement;
    this.turretJoystickThumb = this.shadowRoot?.getElementById('turret-joystick-thumb') as HTMLElement;
    this.fireButton = this.shadowRoot?.getElementById('fire-button') as HTMLElement;
    this.fullscreenButton = this.shadowRoot?.getElementById('fullscreen-button') as HTMLElement;

    if (!this.joystickContainer || !this.joystickThumb || !this.fireButton || 
        !this.turretJoystickContainer || !this.turretJoystickThumb || !this.fullscreenButton) {
      console.error('Could not find all touch control elements');
      return;
    }

    // Movement joystick handlers
    this.joystickContainer.addEventListener('touchstart', this.handleJoystickStart.bind(this), { passive: false });
    this.joystickContainer.addEventListener('touchmove', this.handleJoystickMove.bind(this), { passive: false });
    this.joystickContainer.addEventListener('touchend', this.handleJoystickEnd.bind(this), { passive: false });
    this.joystickContainer.addEventListener('touchcancel', this.handleJoystickEnd.bind(this), { passive: false });

    // Turret joystick handlers
    this.turretJoystickContainer.addEventListener('touchstart', this.handleTurretJoystickStart.bind(this), { passive: false });
    this.turretJoystickContainer.addEventListener('touchmove', this.handleTurretJoystickMove.bind(this), { passive: false });
    this.turretJoystickContainer.addEventListener('touchend', this.handleTurretJoystickEnd.bind(this), { passive: false });
    this.turretJoystickContainer.addEventListener('touchcancel', this.handleTurretJoystickEnd.bind(this), { passive: false });

    // Fire button handlers
    this.fireButton.addEventListener('touchstart', this.handleFireButtonStart.bind(this), { passive: false });
    this.fireButton.addEventListener('touchend', this.handleFireButtonEnd.bind(this), { passive: false });
    this.fireButton.addEventListener('touchcancel', this.handleFireButtonEnd.bind(this), { passive: false });
    
    // Fullscreen button handler
    this.fullscreenButton.addEventListener('click', this.toggleFullscreen.bind(this));
    this.fullscreenButton.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.toggleFullscreen();
    }, { passive: false });
    
    // Add touch handlers to the game canvas for handling touch events outside the controls
    const touchControlsArea = this.shadowRoot?.querySelector('.touch-controls') as HTMLElement;
    if (touchControlsArea) {
      touchControlsArea.addEventListener('touchstart', (e) => {
        // Don't prevent default here to allow other touch handlers to work
      }, { passive: true });
      
      touchControlsArea.addEventListener('touchmove', (e) => {
        // Don't prevent default here to allow other touch handlers to work
      }, { passive: true });
      
      touchControlsArea.addEventListener('touchend', (e) => {
        // Clean up any orphaned touches when all touches end
        if (e.touches.length === 0) {
          this.activeTouches.clear();
          this.resetAllControls();
        }
      });
    }
  }
  
  // Helper method to reset all controls when touch events get interrupted
  private resetAllControls(): void {
    // Reset movement joystick
    if (this.joystickActive) {
      this.joystickActive = false;
      this.joystickTouchId = null;
      this.resetJoystick();
      
      // Reset movement keys
      this.keys['w'] = false;
      this.keys['s'] = false;
      this.keys['a'] = false;
      this.keys['d'] = false;
    }
    
    // Reset turret joystick
    if (this.turretJoystickActive) {
      this.turretJoystickActive = false;
      this.turretJoystickTouchId = null;
      this.resetTurretJoystick();
    }
    
    // Reset fire button
    if (this.fireButtonActive) {
      this.fireButtonActive = false;
      this.keys['mousefire'] = false;
      
      // Reset visual state
      if (this.fireButton) {
        this.fireButton.style.backgroundColor = 'rgba(255, 30, 30, 0.7)';
        this.fireButton.style.transform = 'translateX(-50%)';
      }
    }
  }

  // Joystick handlers
  private handleJoystickStart(event: TouchEvent): void {
    event.preventDefault();
    
    // Get the first available touch for this joystick
    for (let i = 0; i < event.touches.length; i++) {
      const touch = event.touches[i];
      
      // Only use this touch if it's not already being tracked by another control
      if (!this.activeTouches.has(touch.identifier)) {
        this.joystickActive = true;
        this.joystickTouchId = touch.identifier;
        
        // Register this touch with the movement joystick
        this.activeTouches.set(touch.identifier, { 
          element: 'moveJoystick', 
          x: touch.clientX, 
          y: touch.clientY 
        });
        
        this.updateJoystickPosition(touch.clientX, touch.clientY);
        break;
      }
    }
  }

  private handleJoystickMove(event: TouchEvent): void {
    event.preventDefault();
    
    if (this.joystickActive && this.joystickTouchId !== null) {
      // Find the touch with matching ID
      for (let i = 0; i < event.touches.length; i++) {
        const touch = event.touches[i];
        if (touch.identifier === this.joystickTouchId) {
          this.updateJoystickPosition(touch.clientX, touch.clientY);
          
          // Update the stored position
          this.activeTouches.set(touch.identifier, { 
            element: 'moveJoystick', 
            x: touch.clientX, 
            y: touch.clientY 
          });
          break;
        }
      }
    }
  }

  private handleJoystickEnd(event: TouchEvent): void {
    event.preventDefault();
    
    // Check the changedTouches list to see which touches ended
    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      
      // Check if this is our joystick touch
      if (touch.identifier === this.joystickTouchId) {
        this.joystickActive = false;
        this.joystickTouchId = null;
        this.resetJoystick();
        
        // Remove this touch from our tracking
        this.activeTouches.delete(touch.identifier);
        
        // Reset movement keys
        this.keys['w'] = false;
        this.keys['s'] = false;
        this.keys['a'] = false;
        this.keys['d'] = false;
      }
    }
  }

  private updateJoystickPosition(touchX: number, touchY: number): void {
    if (!this.joystickContainer || !this.joystickThumb) return;

    // Get joystick container position and dimensions
    const rect = this.joystickContainer.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    // Calculate joystick movement (distance from center)
    let deltaX = touchX - centerX;
    let deltaY = touchY - centerY;
    
    // Calculate the distance from center
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    // Limit the joystick movement to the container radius
    const maxRadius = rect.width / 2;
    if (distance > maxRadius) {
      const angle = Math.atan2(deltaY, deltaX);
      deltaX = Math.cos(angle) * maxRadius;
      deltaY = Math.sin(angle) * maxRadius;
    }
    
    // Move the joystick thumb
    this.joystickThumb.style.transform = `translate(calc(-50% + ${deltaX}px), calc(-50% + ${deltaY}px))`;
    
    // Store joystick position normalized to -1 to 1 range (with exponential response curve)
    // This provides finer control at low speeds but still allows reaching maximum speed
    const normalizedX = deltaX / maxRadius;
    const normalizedY = deltaY / maxRadius;
    
    // Apply exponential curve - provides better low-speed precision while preserving max speed
    // Formula: sign(x) * (|x|^1.5) - preserves direction but increases sensitivity with movement
    this.joystickPosition = {
      x: Math.sign(normalizedX) * Math.pow(Math.abs(normalizedX), 1.5),
      y: Math.sign(normalizedY) * Math.pow(Math.abs(normalizedY), 1.5)
    };
    
    // Convert joystick position to key presses for tank movement
    this.updateMovementKeysFromJoystick();
  }

  private resetJoystick(): void {
    if (!this.joystickThumb) return;
    
    // Reset joystick thumb position to center
    this.joystickThumb.style.transform = 'translate(-50%, -50%)';
    
    // Reset joystick position
    this.joystickPosition = { x: 0, y: 0 };
  }

  private updateMovementKeysFromJoystick(): void {
    const deadzone = 0.15; // Slightly reduced deadzone for better responsiveness
    
    // Forward/backward (W/S keys)
    if (this.joystickPosition.y < -deadzone) {
      this.keys['w'] = true;
      this.keys['s'] = false;
      
      // Pass joystick intensity to the tank for variable speed
      if (this.playerTank && typeof this.playerTank.setInputIntensity === 'function') {
        this.playerTank.setInputIntensity('forward', Math.abs(this.joystickPosition.y));
      }
    } else if (this.joystickPosition.y > deadzone) {
      this.keys['w'] = false;
      this.keys['s'] = true;
      
      // Pass joystick intensity to the tank for variable speed
      if (this.playerTank && typeof this.playerTank.setInputIntensity === 'function') {
        this.playerTank.setInputIntensity('backward', Math.abs(this.joystickPosition.y));
      }
    } else {
      this.keys['w'] = false;
      this.keys['s'] = false;
      
      // Reset speed intensity
      if (this.playerTank && typeof this.playerTank.setInputIntensity === 'function') {
        this.playerTank.setInputIntensity('forward', 0);
        this.playerTank.setInputIntensity('backward', 0);
      }
    }
    
    // Left/right rotation (A/D keys)
    if (this.joystickPosition.x < -deadzone) {
      this.keys['a'] = true;
      this.keys['d'] = false;
      
      // Pass joystick intensity to the tank for variable rotation speed
      if (this.playerTank && typeof this.playerTank.setInputIntensity === 'function') {
        this.playerTank.setInputIntensity('left', Math.abs(this.joystickPosition.x));
      }
    } else if (this.joystickPosition.x > deadzone) {
      this.keys['a'] = false;
      this.keys['d'] = true;
      
      // Pass joystick intensity to the tank for variable rotation speed
      if (this.playerTank && typeof this.playerTank.setInputIntensity === 'function') {
        this.playerTank.setInputIntensity('right', Math.abs(this.joystickPosition.x));
      }
    } else {
      this.keys['a'] = false;
      this.keys['d'] = false;
      
      // Reset rotation intensity
      if (this.playerTank && typeof this.playerTank.setInputIntensity === 'function') {
        this.playerTank.setInputIntensity('left', 0);
        this.playerTank.setInputIntensity('right', 0);
      }
    }
  }

  // Fire button handlers
  private handleFireButtonStart(event: TouchEvent): void {
    event.preventDefault();
    
    // Get the first available touch for the fire button
    for (let i = 0; i < event.touches.length; i++) {
      const touch = event.touches[i];
      
      // Only use this touch if it's not already being tracked by another control
      if (!this.activeTouches.has(touch.identifier)) {
        this.fireButtonActive = true;
        this.keys['mousefire'] = true;
        
        // Register this touch with the fire button
        this.activeTouches.set(touch.identifier, { 
          element: 'fireButton', 
          x: touch.clientX, 
          y: touch.clientY 
        });
        
        // Visual feedback
        if (this.fireButton) {
          this.fireButton.style.backgroundColor = 'rgba(255, 0, 0, 0.8)';
          this.fireButton.style.transform = 'translateX(-50%) scale(0.95)';
        }
        break;
      }
    }
  }

  private handleFireButtonEnd(event: TouchEvent): void {
    event.preventDefault();
    
    // Check which touches ended
    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      const touchInfo = this.activeTouches.get(touch.identifier);
      
      // Check if this touch was for the fire button
      if (touchInfo && touchInfo.element === 'fireButton') {
        this.fireButtonActive = false;
        this.keys['mousefire'] = false;
        
        // Remove this touch from tracking
        this.activeTouches.delete(touch.identifier);
        
        // Reset visual state
        if (this.fireButton) {
          this.fireButton.style.backgroundColor = 'rgba(255, 30, 30, 0.7)';
          this.fireButton.style.transform = 'translateX(-50%)';
        }
      }
    }
  }

  // Turret joystick handlers
  private handleTurretJoystickStart(event: TouchEvent): void {
    event.preventDefault();
    
    // Get the first available touch for this joystick
    for (let i = 0; i < event.touches.length; i++) {
      const touch = event.touches[i];
      
      // Only use this touch if it's not already being tracked by another control
      if (!this.activeTouches.has(touch.identifier)) {
        this.turretJoystickActive = true;
        this.turretJoystickTouchId = touch.identifier;
        
        // Register this touch with the turret joystick
        this.activeTouches.set(touch.identifier, { 
          element: 'turretJoystick', 
          x: touch.clientX, 
          y: touch.clientY 
        });
        
        this.updateTurretJoystickPosition(touch.clientX, touch.clientY);
        break;
      }
    }
  }

  private handleTurretJoystickMove(event: TouchEvent): void {
    event.preventDefault();
    
    if (this.turretJoystickActive && this.turretJoystickTouchId !== null) {
      // Find the touch with matching ID
      for (let i = 0; i < event.touches.length; i++) {
        const touch = event.touches[i];
        if (touch.identifier === this.turretJoystickTouchId) {
          this.updateTurretJoystickPosition(touch.clientX, touch.clientY);
          
          // Update the stored position
          this.activeTouches.set(touch.identifier, { 
            element: 'turretJoystick', 
            x: touch.clientX, 
            y: touch.clientY 
          });
          break;
        }
      }
    }
  }

  private handleTurretJoystickEnd(event: TouchEvent): void {
    event.preventDefault();
    
    // Check the changedTouches list to see which touches ended
    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      
      // Check if this is our turret joystick touch
      if (touch.identifier === this.turretJoystickTouchId) {
        this.turretJoystickActive = false;
        this.turretJoystickTouchId = null;
        this.resetTurretJoystick();
        
        // Remove this touch from our tracking
        this.activeTouches.delete(touch.identifier);
      }
    }
  }

  private updateTurretJoystickPosition(touchX: number, touchY: number): void {
    if (!this.turretJoystickContainer || !this.turretJoystickThumb || !this.playerTank) return;

    // Get joystick container position and dimensions
    const rect = this.turretJoystickContainer.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    // Calculate joystick movement (distance from center)
    let deltaX = touchX - centerX;
    let deltaY = touchY - centerY;
    
    // Calculate the distance from center
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    // Limit the joystick movement to the container radius
    const maxRadius = rect.width / 2;
    if (distance > maxRadius) {
      const angle = Math.atan2(deltaY, deltaX);
      deltaX = Math.cos(angle) * maxRadius;
      deltaY = Math.sin(angle) * maxRadius;
    }
    
    // Move the joystick thumb
    this.turretJoystickThumb.style.transform = `translate(calc(-50% + ${deltaX}px), calc(-50% + ${deltaY}px))`;
    
    // Store joystick position normalized to -1 to 1 range with exponential response curve
    // This provides finer control at low sensitivities while still allowing full range
    const normalizedX = deltaX / maxRadius;
    const normalizedY = deltaY / maxRadius;
    
    // Apply exponential curve for better precision
    // Using a custom curve that gives more precision for small movements
    this.turretJoystickPosition = {
      x: Math.sign(normalizedX) * Math.pow(Math.abs(normalizedX), 1.8),
      y: Math.sign(normalizedY) * Math.pow(Math.abs(normalizedY), 1.8)
    };
    
    // Apply turret rotation with progressive sensitivity based on joystick deflection
    // Smaller movements = finer control, larger movements = faster turning
    const baseRotationRate = 0.01; // Base rate for minimal movements
    const maxRotationRate = 0.05; // Maximum rate for full deflection
    
    // Calculate a variable rate based on joystick deflection magnitude
    const xDeflection = Math.abs(this.turretJoystickPosition.x);
    const turretSensitivity = baseRotationRate + (xDeflection * (maxRotationRate - baseRotationRate));
    
    // Apply the rotation with the variable rate
    this.playerTank.turretPivot.rotation.y -= this.turretJoystickPosition.x * turretSensitivity;
    
    // Apply barrel elevation with similar progressive sensitivity
    const baseElevationRate = 0.01; // Base rate for minimal movements
    const maxElevationRate = 0.05; // Maximum rate for full deflection
    
    // Calculate a variable rate based on joystick deflection magnitude
    const yDeflection = Math.abs(this.turretJoystickPosition.y);
    const barrelSensitivity = baseElevationRate + (yDeflection * (maxElevationRate - baseElevationRate));
    
    // Apply the elevation with the variable rate and proper clamping
    this.playerTank.barrelPivot.rotation.x = Math.max(
      this.playerTank.getMinBarrelElevation(),
      Math.min(
        this.playerTank.getMaxBarrelElevation(),
        this.playerTank.barrelPivot.rotation.x + this.turretJoystickPosition.y * barrelSensitivity
      )
    );
  }

  private resetTurretJoystick(): void {
    if (!this.turretJoystickThumb) return;
    
    // Reset joystick thumb position to center
    this.turretJoystickThumb.style.transform = 'translate(-50%, -50%)';
    
    // Reset joystick position
    this.turretJoystickPosition = { x: 0, y: 0 };
  }
  
  // Handle tank respawn events
  private handleTankRespawn(event: CustomEvent) {
    // Get respawn data
    const respawnData = event.detail;
    
    // Update playerId if it's the local player
    if (respawnData.playerId === 'player') {
      respawnData.playerId = this.playerId;
    }
    
    console.log(`Tank respawn event for player ${respawnData.playerId} at position:`, respawnData.position);
    
    // Create a custom event using the new consolidated format
    const gameEvent = new CustomEvent('game-event', { 
      detail: {
        type: "TANK_RESPAWN",
        data: respawnData,
        playerId: this.playerId,
        timestamp: Date.now()
      },
      bubbles: true,
      composed: true
    });
    
    // Dispatch the event to be sent to the server
    this.dispatchEvent(gameEvent);
    
    // Force the player update to ensure server knows the player is respawned
    if (this.playerTank && respawnData.playerId === this.playerId) {
      // Set player health to max
      this.playerTank.setHealth(100);
      
      // Update player state on server immediately with full health
      this.broadcastPlayerState();
      
      console.log('Forced player state update after respawn to ensure health is restored');
    }
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
    
    // Create shell data
    const shellData = {
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
    };
    
    // Create a custom event using the new consolidated format
    const gameEvent = new CustomEvent('game-event', { 
      detail: {
        type: "SHELL_FIRED",
        data: shellData,
        playerId: this.playerId,
        timestamp: Date.now()
      },
      bubbles: true,
      composed: true // Allows the event to cross shadow DOM boundaries
    });
    
    // Dispatch the event to be sent to the server
    this.dispatchEvent(gameEvent);
  }
  
  // Only handling other property changes
  updated(changedProperties: Map<string, any>) {
    // Game state is now handled directly in the setter
  }
  
  /**
   * Updates the local player's tank health based on server state
   */
  private updateLocalPlayerHealth() {
    // Skip if not initialized or player tank doesn't exist
    if (!this.playerTank || !this.multiplayerState || !this.multiplayerState.players || !this.playerId) {
      return;
    }
    
    // Find the player's data in the game state
    const playerData = this.multiplayerState.players[this.playerId];
    if (playerData && typeof playerData.health === 'number') {
      // Update player tank health from server state
      this.playerTank.setHealth(playerData.health);
      
      // If server says player is dead but client doesn't know yet
      if (playerData.health <= 0 && !this.playerTank.isDestroyed) {
        console.log('Server reported player death, updating local state');
        // Tank's setHealth method will handle the destruction effects
        
        // Update client-side death state
        this.playerDestroyed = true;
        this.respawnTimer = 0;
        this.showPlayerDeathEffects();
      }
      
      // Check if the player was destroyed but is now alive (respawned by server)
      if (playerData.health > 0 && !playerData.isDestroyed && this.playerDestroyed) {
        console.log('Server reported player respawn, updating local state');
        const spawnPoint = new THREE.Vector3(playerData.position.x, playerData.position.y, playerData.position.z);
        this.playerTank.respawn(spawnPoint);
        this.playerDestroyed = false;
        this.respawnTimer = 0;
        this.requestUpdate();
      }
      
      // Update UI stats if available
      if (this.statsComponent) {
        this.statsComponent.updateGameStats(
          playerData.health,
          playerData.kills || 0,
          playerData.deaths || 0
        );
      }
    }
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
    
    // Log player count occasionally for debugging
    const playerCount = playerKeys.length;
    if (this.frameCounter % 300 === 0) { // Log every ~5 seconds
      console.log(`Current player count: ${playerCount} (including NPCs)`);
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
        
        // Also remove this player's audio listener
        if (window.SpatialAudio) {
          window.SpatialAudio.setPlayerListener(playerId, null);
        }
      }
    }
  }
  
  /**
   * Check for any death notifications from the server
   * This looks for LastKilledBy fields that would indicate a player was killed
   */
  private checkForDeathNotifications(): void {
    if (!this.multiplayerState || !this.multiplayerState.players) {
      return;
    }
    
    // Loop through all players
    for (const [playerId, playerData] of Object.entries(this.multiplayerState.players)) {
      // Check if this player has the lastKilledBy field set
      if (playerData.lastKilledBy && playerData.lastDeathTime) {
        // Create a unique death event ID
        const deathEventId = `${playerId}_${playerData.lastKilledBy}_${playerData.lastDeathTime}`;
        
        // Skip if we've already processed this death event
        if (this.processedDeathEvents.has(deathEventId)) {
          continue;
        }
        
        // Mark as processed
        this.processedDeathEvents.add(deathEventId);
        
        // Get killer's name (the one who killed this player)
        let killerName = "Unknown";
        if (this.multiplayerState.players[playerData.lastKilledBy]) {
          killerName = this.multiplayerState.players[playerData.lastKilledBy].name || 
                       `Player ${playerData.lastKilledBy.substring(0, 6)}`;
        } else if (playerData.lastKilledBy === this.playerId) {
          killerName = "You"; // If the current player is the killer
        }
        
        // Get victim's name (this player)
        let victimName = playerData.name || `Player ${playerId.substring(0, 6)}`;
        if (playerId === this.playerId) {
          victimName = "You"; // If the current player is the victim
        }
        
        // Add kill notification
        this.addKillNotification(killerName, victimName);
        
        console.log(`Kill notification: ${killerName} destroyed ${victimName}`);
      }
    }
  }

  /**
   * Updates audio listeners for all remote players based on their positions
   * This ensures spatial audio works correctly for all players
   */
  private updateRemotePlayerListeners(): void {
    if (!window.SpatialAudio || !this.multiplayerState || !this.multiplayerState.players) {
      return;
    }
    
    // For each remote player, set their position as an audio listener
    for (const [playerId, playerData] of Object.entries(this.multiplayerState.players)) {
      // Skip own player - already handled separately
      if (playerId === this.playerId) continue;
      
      // Create listener position from player data
      if (playerData.position) {
        const listenerPosition = new THREE.Vector3(
          playerData.position.x,
          playerData.position.y,
          playerData.position.z
        );
        
        // Set this player's listener position
        window.SpatialAudio.setPlayerListener(playerId, listenerPosition);
      }
    }
  }
  
  // Create a new remote tank for another player or NPC
  private createRemoteTank(playerId: string, playerData: PlayerState) {
    if (!this.scene) {
      console.error('Cannot create remote tank: Scene not available');
      return;
    }
    
    // Determine if this is an NPC (server-side) by checking the ID prefix
    const isNPC = playerId.startsWith('npc_');
    
    console.log(`Creating ${isNPC ? 'NPC' : 'remote'} tank for ${playerId}`, playerData);
    
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
      
      console.log(`Tank position: (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`);
      
      // Handle different color formats (hex string or object with r,g,b)
      let tankColor = 0xff0000; // Default red
      if (playerData.color) {
        if (typeof playerData.color === 'string' && playerData.color.startsWith('#')) {
          tankColor = parseInt(playerData.color.substring(1), 16);
        }
      }
      
      const tankName = playerData.name || `${isNPC ? 'NPC' : 'Player'} ${playerId.substring(0, 6)}`;
      console.log(`Creating tank with name: ${tankName}, color: ${tankColor.toString(16)}`);
      
      // Create the remote tank - use RemoteTank class for both players and NPCs
      // since server-side NPCs will be handled as regular remote tanks on the client
      const remoteTank = new RemoteTank(
        this.scene,
        position,
        tankColor,
        tankName
      );
      
      // Verify tank was created properly
      if (!remoteTank || !remoteTank.tank) {
        console.error('Failed to create remote tank - tank object is missing!');
        return;
      }
      
      console.log('Remote tank created successfully');
      
      // Set the tank's owner ID
      if (typeof remoteTank.setOwnerId === 'function') {
        remoteTank.setOwnerId(playerId);
        console.log(`Set tank owner ID to ${playerId}`);
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
        console.log(`Set tank health to ${playerData.health}`);
      }
      
      // Scale the tank to match player tank size (ensure they're the same size)
      remoteTank.tank.scale.set(1.0, 1.0, 1.0);
      
      // Add floating triangle identifier marker
      remoteTank.addFloatingIdentifierMarker();
      console.log('Added identifier marker to remote tank');
      
      // Add to collision system
      this.collisionSystem.addCollider(remoteTank);
      
      // Store in remoteTanks map
      this.remoteTanks.set(playerId, remoteTank);
      console.log(`Remote tank for player ${playerId} added to game`);
    } catch (error) {
      console.error('Error creating remote tank:', error);
      console.error('Problem player data:', playerData);
    }
  }
  
  // Removed old addDebugVisualToRemoteTank method
  // NPCTank and RemoteTank now call addFloatingIdentifierMarker directly
  
  // Update an existing remote tank's position and rotation
  private updateRemoteTankPosition(tank: RemoteTank, playerData: PlayerState) {
    // Don't log every position update - they happen frequently
    
    try {
      // Verify tank still exists
      if (!tank || !tank.tank) {
        console.error('Cannot update remote tank: Tank reference is invalid');
        return;
      }
      
      // Ensure we have position data
      if (!playerData.position) {
        console.error('Cannot update remote tank: Missing position data');
        return;
      }
      
      // Create new position vector
      const newPosition = new THREE.Vector3(
        playerData.position.x,
        playerData.position.y,
        playerData.position.z
      );
      
      // Get current position for distance check
      const currentPosition = tank.tank.position.clone();
      const distance = currentPosition.distanceTo(newPosition);
      
      // If the tank has moved a significant distance, log it for debugging
      if (distance > 10) {
        console.log(`Remote tank moved a large distance: ${distance.toFixed(2)} units`);
        console.log(`  From: (${currentPosition.x.toFixed(2)}, ${currentPosition.y.toFixed(2)}, ${currentPosition.z.toFixed(2)})`);
        console.log(`  To: (${newPosition.x.toFixed(2)}, ${newPosition.y.toFixed(2)}, ${newPosition.z.toFixed(2)})`);
      }
      
      // Update position with interpolation for smooth movement
      tank.tank.position.lerp(newPosition, 0.2); // Lower interpolation factor for smoother movement
      
      // Update collider position
      if (tank.getCollider) {
        const collider = tank.getCollider();
        if (collider instanceof THREE.Sphere) {
          collider.center.copy(tank.tank.position);
        }
      }
      
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
      
      // Update all audio positions for this tank
      // This ensures the tank's sound effects are positioned correctly
      try {
        if (typeof tank.updateSoundPositions === 'function') {
          tank.updateSoundPositions();
        }
      } catch (audioError) {
        // If audio update fails, just log it but don't let it break positioning
        console.warn('Error updating tank audio positions:', audioError);
      }
      
      // Ensure tank is visible
      if (!tank.tank.visible) {
        console.log('Making remote tank visible again');
        tank.tank.visible = true;
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
    document.removeEventListener('shell-fired', this.handleShellFired);
    document.removeEventListener('tank-respawn', this.handleTankRespawn);
    
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
    
    // Remove touch control event listeners
    if (this.joystickContainer) {
      this.joystickContainer.removeEventListener('touchstart', this.handleJoystickStart);
      this.joystickContainer.removeEventListener('touchmove', this.handleJoystickMove);
      this.joystickContainer.removeEventListener('touchend', this.handleJoystickEnd);
      this.joystickContainer.removeEventListener('touchcancel', this.handleJoystickEnd);
    }
    
    if (this.turretJoystickContainer) {
      this.turretJoystickContainer.removeEventListener('touchstart', this.handleTurretJoystickStart);
      this.turretJoystickContainer.removeEventListener('touchmove', this.handleTurretJoystickMove);
      this.turretJoystickContainer.removeEventListener('touchend', this.handleTurretJoystickEnd);
      this.turretJoystickContainer.removeEventListener('touchcancel', this.handleTurretJoystickEnd);
    }
    
    if (this.fireButton) {
      this.fireButton.removeEventListener('touchstart', this.handleFireButtonStart);
      this.fireButton.removeEventListener('touchend', this.handleFireButtonEnd);
      this.fireButton.removeEventListener('touchcancel', this.handleFireButtonEnd);
    }
    
    if (this.fullscreenButton) {
      this.fullscreenButton.removeEventListener('click', this.toggleFullscreen);
      this.fullscreenButton.removeEventListener('touchstart', this.toggleFullscreen);
    }
    
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
    // Reuse the same color instance instead of cloning
    this.scene.fog = new THREE.FogExp2(this.skyColor, 0.0006); // Slightly increased fog density
    
    // Create skybox
    this.createSkybox();
    
    // Create camera with more optimized near/far planes for performance
    this.camera = new THREE.PerspectiveCamera(
      60,
      this.canvas.clientWidth / this.canvas.clientHeight,
      0.5, // Increased near plane (0.1 -> 0.5) for better z-buffer precision
      1500 // Further reduced far plane for better performance
    );
    
    // Add camera to scene immediately
    this.scene.add(this.camera);
    
    // Update scene matrices
    this.scene.updateMatrixWorld(true);
    
    // Create highly optimized renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false, // Disable antialias for better performance
      powerPreference: 'high-performance',
      precision: 'mediump', // Use medium precision for better performance
      stencil: false, // Disable stencil buffer if not needed
      depth: true,    // Keep depth testing
      alpha: false    // Disable alpha channel for better performance
    });
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    
    // Use consistent medium-high quality rendering
    const basePixelRatio = window.devicePixelRatio || 1;
    // Limit to 1.5x pixel ratio for balanced quality and performance
    const pixelRatio = Math.min(basePixelRatio, 1.5);
    
    this.renderer.setPixelRatio(pixelRatio);
    
    // Completely disable shadows for maximum performance
    this.renderer.shadowMap.enabled = false;
    
    // Enable renderer optimizations
    this.renderer.sortObjects = true;
    this.renderer.physicallyCorrectLights = false;
    this.renderer.localClippingEnabled = false; // Disable clipping planes if not needed
    
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
    
    // Create ground with grass shader effect
    const groundSize = 5000; // Reduced from 10000
    const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize, 128, 128);
    
    // Grass vertex shader
    const grassVertexShader = `
      uniform float time;
      varying vec2 vUv;
      varying vec3 vPosition;
      varying vec3 vNormal;
      
      // Simplex noise function
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
      
      float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                  -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v -   i + dot(i, C.xx);
        vec2 i1;
        i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
          + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m;
        m = m*m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
        vec3 g;
        g.x  = a0.x  * x0.x  + h.x  * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }
      
      varying float vHeight;

      void main() {
        vUv = uv;
        vPosition = position;
        vNormal = normal;
        
        // Only apply wind effect when far from the origin
        float distFromCenter = length(position.xz);
        float windStrength = 0.0;
        
        if (distFromCenter > 10.0) {
          // Wind effect using noise with increased strength
          float noise = snoise(position.xz * 0.05 + time * 0.1);
          windStrength = noise * 1.5 * (min(1.0, distFromCenter / 100.0)); // Increased from 0.5
        }
        
        // Apply taller undulation to ground with multiple noise frequencies
        vec3 newPosition = position;
        
        // Base terrain undulation - larger, smoother hills
        newPosition.y += snoise(position.xz * 0.01) * 5.0; // Increased from 2.0
        
        // Medium frequency variation for smaller bumps
        newPosition.y += snoise(position.xz * 0.05) * 2.0;
        
        // High frequency variation for grass-like detail
        newPosition.y += snoise(position.xz * 0.3) * 0.8;
        
        // Apply wind effect to vertices
        newPosition.y += windStrength;
        
        // Store height for fragment shader color variation
        vHeight = newPosition.y;
        
        gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
      }
    `;
    
    // Grass fragment shader
    const grassFragmentShader = `
      uniform float time;
      varying vec2 vUv;
      varying vec3 vPosition;
      varying vec3 vNormal;
      varying float vHeight;
      
      // Simplex noise function from vertex shader
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
      
      float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                  -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v -   i + dot(i, C.xx);
        vec2 i1;
        i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
          + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m;
        m = m*m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
        vec3 g;
        g.x  = a0.x  * x0.x  + h.x  * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }
      
      void main() {
        // Base grass color
        vec3 baseColor = vec3(0.302, 0.647, 0.357); // #4DA65B
        
        // Add variation using noise
        float noise = snoise(vPosition.xz * 0.1);
        float noise2 = snoise(vPosition.xz * 0.3 + vec2(0.0, time * 0.1));
        
        // Create darker patches and lighter highlights with more variety
        vec3 darkGrass = vec3(0.196, 0.455, 0.196); // Darker green
        vec3 lightGrass = vec3(0.486, 0.729, 0.388); // Lighter green
        vec3 tallGrassTip = vec3(0.576, 0.788, 0.424); // Even lighter for tall tips
        
        // Mix colors based on noise
        vec3 finalColor = mix(darkGrass, baseColor, clamp(noise * 0.5 + 0.5, 0.0, 1.0));
        finalColor = mix(finalColor, lightGrass, clamp(noise2 * 0.3 + 0.0, 0.0, 1.0));
        
        // Use height information to create vertical color gradient
        // Taller grass (higher vHeight) gets a lighter color for realistic look
        float heightFactor = clamp((vHeight - 1.0) * 0.1, 0.0, 0.6);
        finalColor = mix(finalColor, tallGrassTip, heightFactor);
        
        // Add extra color variation for very tall peaks
        if (vHeight > 6.0) {
          float peakFactor = clamp((vHeight - 6.0) * 0.2, 0.0, 1.0);
          finalColor = mix(finalColor, vec3(0.620, 0.816, 0.459), peakFactor);
        }
        
        // Add subtle pattern for texture
        float pattern = abs(sin(vUv.x * 100.0) * sin(vUv.y * 100.0) * 0.5);
        finalColor = mix(finalColor, finalColor * 0.9, pattern * 0.1);
        
        // Add subtle horizontal banding for grass-like texture
        float bands = sin(vPosition.y * 8.0) * 0.05;
        finalColor = mix(finalColor, finalColor * (1.0 + bands), 0.3);
        
        // Output final color
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `;
    
    // Create shader material
    const grassMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 }
      },
      vertexShader: grassVertexShader,
      fragmentShader: grassFragmentShader,
      side: THREE.DoubleSide
    });
    
    const ground = new THREE.Mesh(groundGeometry, grassMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = false; // No shadows
    ground.name = "ground"; // Add name for identification
    this.scene.add(ground);
    
    // Update shader time uniform in animation loop
    this.groundMaterial = grassMaterial;
    
    // Create map generator with server map data if available
    this.mapGenerator = new MapGenerator(this.scene, this.mapData);
    
    // Create environment objects
    this.createTrees();
    this.createRocks();
    
    // Create player tank at a random valid position
    const spawnPoint = this.findRandomSpawnPoint();
    this.playerTank = new Tank(this.scene, this.camera);
    this.playerTank.respawn(spawnPoint); // Set initial position
    this.collisionSystem.addCollider(this.playerTank);
    
    // Position camera
    this.positionCamera();
    
    // Handle window resize
    window.addEventListener('resize', this.handleResize.bind(this));
  }
  
  private createTrees() {
    if (!this.scene || !this.mapGenerator) return;
    
    // The trees are now generated in the TreeGenerator class,
    // which is instantiated by the MapGenerator
    
    // Add tree colliders to the collision system
    const treeColliders = this.mapGenerator.getTreeColliders();
    for (const collider of treeColliders) {
      this.collisionSystem.addCollider(collider);
    }
  }
  
  private createRocks() {
    if (!this.scene || !this.mapGenerator) return;
    
    // Generate terrain (rocks and rock formations)
    this.mapGenerator.generateTerrain();
    
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
  
  
  // NPC tanks are now created and managed server-side
  
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
    const crosshairSize = 0.5; // Size of the crosshair
    const crosshairMaterial = new THREE.LineBasicMaterial({ 
      color: 0xffffff,   // White
      linewidth: 2,      // Thicker lines (note: may not work in WebGL)
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
    
    // Add to scene
    this.scene.add(this.crosshairObject);
    
    // Initial position update
    this.updateCrosshairPosition();
  }
  
  // Reuse these vectors to avoid unnecessary object creation
  private readonly tempVector = new THREE.Vector3();
  private readonly tempDirection = new THREE.Vector3();
  private readonly tempBarrelEnd = new THREE.Vector3();
  private readonly tempEuler = new THREE.Euler();
  
  private updateCrosshairPosition() {
    if (!this.playerTank || !this.crosshairObject || !this.scene || !this.camera) return;
    
    // Distance to project the crosshair
    const distance = 50; // Units in front of barrel
    
    // Get barrel end position and firing direction
    // Calculate the barrel end position more accurately
    const BARREL_END_OFFSET = 2.5; // Slightly increased from 1.5 for better accuracy

    // STEP 1: Get the barrel's forward direction vector
    this.tempDirection.set(0, 0, 1); // Forward vector (z-axis)
    
    // Apply barrel elevation (rotation around x-axis)
    this.tempEuler.set(this.playerTank.barrelPivot.rotation.x, 0, 0);
    this.tempDirection.applyEuler(this.tempEuler);
    
    // Apply turret rotation (rotation around y-axis)
    this.tempEuler.set(0, this.playerTank.turretPivot.rotation.y, 0);
    this.tempDirection.applyEuler(this.tempEuler);
    
    // Apply tank rotation (rotation around y-axis)
    this.tempEuler.set(0, this.playerTank.tank.rotation.y, 0);
    this.tempDirection.applyEuler(this.tempEuler);
    
    // Normalize direction vector
    this.tempDirection.normalize();
    
    // STEP 2: Calculate barrel end position
    // Start with tank position
    this.tempBarrelEnd.copy(this.playerTank.tank.position);
    
    // Add turret position offset (usually at a small height above the tank body)
    this.tempBarrelEnd.y += 1.0; // Assuming turret is 1 unit above tank base
    
    // Add barrel length in the direction the barrel is pointing
    this.tempBarrelEnd.addScaledVector(this.tempDirection, BARREL_END_OFFSET);
    
    // STEP 3: Set crosshair position directly
    // Calculate where the crosshair should be positioned and set it immediately
    this.crosshairObject.position.copy(this.tempBarrelEnd).addScaledVector(this.tempDirection, distance);
    
    // STEP 4: Make the crosshair face the camera
    // We want the crosshair's local z-axis to point at the camera
    // to ensure it's always visible
    this.crosshairObject.lookAt(this.camera.position);

    // STEP 5: Apply a small scale factor to make crosshair grow with distance
    // This helps with depth perception
    const distanceToCamera = this.crosshairObject.position.distanceTo(this.camera.position);
    const scaleFactor = Math.max(0.8, Math.min(1.5, distanceToCamera / 60));
    this.crosshairObject.scale.set(scaleFactor, scaleFactor, scaleFactor);
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
    
    // Fullscreen toggle with 'f11' key
    if (key === 'f11') {
      event.preventDefault();
      this.toggleFullscreen();
    }
    
    // No need to log every key press
    
    // Prevent default for arrow keys, WASD, and Space to avoid page scrolling/browser shortcuts
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', ' ', 'space', 'f11'].includes(key)) {
      event.preventDefault();
    }
  }
  
  /**
   * Toggle fullscreen mode
   */
  private toggleFullscreen(): void {
    if (!document.fullscreenElement) {
      // Enter fullscreen
      this.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
      this.isFullscreen = true;
    } else {
      // Exit fullscreen
      document.exitFullscreen().catch(err => {
        console.error(`Error attempting to exit fullscreen: ${err.message}`);
      });
      this.isFullscreen = false;
    }
  }
  
  /**
   * Request fullscreen on the component
   */
  private requestFullscreen(): Promise<void> {
    const elem = this.shadowRoot?.host as any;
    if (elem.requestFullscreen) {
      return elem.requestFullscreen();
    } else if (elem.webkitRequestFullscreen) {
      return elem.webkitRequestFullscreen();
    } else if (elem.msRequestFullscreen) {
      return elem.msRequestFullscreen();
    } else {
      return Promise.reject(new Error('Fullscreen API not supported'));
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
    
    const parentWidth = this.canvas.parentElement?.clientWidth || this.canvas.clientWidth;
    const parentHeight = this.canvas.parentElement?.clientHeight || this.canvas.clientHeight;
    
    this.camera.aspect = parentWidth / parentHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(parentWidth, parentHeight);
  }

  // Track frame counts for throttled operations
  private frameCounter = 0;
  
  private animate() {
    this.animationFrameId = requestAnimationFrame(this.animate.bind(this));
    this.frameCounter++;
    
    // Performance monitoring (calculate only every 30 frames)
    if (this.frameCounter % 30 === 0 && this.renderer?.info?.render) {
      // Calculate current FPS for the stats display
      const fps = 1000 / (this.renderer.info.render.frame || 16.7);
    }
    
    // Update grass shader time uniform
    if (this.groundMaterial && this.groundMaterial.uniforms.time) {
      // Update time with a slow rate to make movement subtle
      this.groundMaterial.uniforms.time.value = performance.now() * 0.0003;
    }
    
    // Store camera position for health bar billboarding and audio
    if (this.camera) {
      // Only update audio listeners every 10 frames to reduce processing
      if (this.frameCounter % 10 === 0) {
        // Store camera position in window object for easy access
        (window as any).cameraPosition = this.camera.position;
        
        // Update global audio listener for main player
        if (typeof window.SpatialAudio?.setGlobalListener === 'function') {
          window.SpatialAudio.setGlobalListener(this.camera.position);
          
          // Also set a player-specific listener (in case other tanks reference it specifically)
          if (this.playerId) {
            window.SpatialAudio.setPlayerListener(this.playerId, this.camera.position);
          }
        }
        
        // Update audio listeners for all remote players
        // This ensures each remote player can hear audio properly
        this.updateRemotePlayerListeners();
      }
    }
    
    // Process any pending game state updates in the animation loop
    // This ensures we constantly check for remote player updates
    if (this.multiplayerState && this.scene && this.gameStateInitialized) {
      // Check for remote players more frequently
      if (this.frameCounter % 10 === 0) { // Process 6 times per second (at 60fps)
        this.updateRemotePlayers();
      }
      
      // Process remote shells - this is now rate-limited internally
      if (this.multiplayerState.shells && this.multiplayerState.shells.length > 0) {
        this.processRemoteShells();
      }
    }
    
    // Update crosshair position every frame to prevent trailing/ghosting effect
    this.updateCrosshairPosition();
    
    // Update kill notifications every 5 frames
    if (this.frameCounter % 5 === 0) {
      this.updateKillNotifications();
      // Check for any server-reported death events
      this.checkForDeathNotifications();
    }
    
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
          this.addShell(newShell);
        }
      }
      
      // Always update camera, even when destroyed
      if (this.camera) {
        this.playerTank.updateCamera(this.camera);
      }
      
      // Emit player position and orientation event with reduced frequency
      if (this.frameCounter % 6 === 0) { // Reduced from every 5 frames to every 6
        this.emitPlayerPositionEvent();
      }
      
      // Update stats for health changes
      if (this.frameCounter % 15 === 0) { // Only update UI stats every quarter second
        this.updateStats();
      }
    }
    
    // Update player health tracking
    if (this.playerTank) {
      const currentHealth = this.playerTank.getHealth();
      
      // If health decreased (but not destroyed), show damage effects
      if (currentHealth < this.lastPlayerHealth && !this.playerDestroyed) {
        this.showPlayerHitEffects();
      }
      
      this.lastPlayerHealth = currentHealth;
    }
    
    // NPC tanks are now updated server-side
    
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
    const { tank, source, hitLocation, visualOnly, clientSideHit } = event.detail;
    
    // Check if this is the player tank being hit
    if (tank === this.playerTank) {
      console.log(`Player tank hit detected on ${hitLocation || 'body'} (visual effects only)`);
      
      // Show visual/audio hit effects
      this.showPlayerHitEffects();
    }
    
    // Always forward the hit event to server
    // This is important to ensure hits register at all distances
    if (source && source !== tank) {
      // Skip if this is a network event to prevent loops
      if (event.detail.isNetworkEvent) {
        return;
      }
      
      // Get target ID - could be player, remote player, or NPC
      let targetId = '';
      let sourceId = source.getOwnerId ? source.getOwnerId() : 'unknown';
      
      // Check if it's the player tank
      if (tank === this.playerTank) {
        targetId = this.playerId;
      } else {
        // Check if it's a remote tank
        for (const [id, remoteTank] of this.remoteTanks.entries()) {
          if (remoteTank === tank) {
            targetId = id;
            break;
          }
        }
        
        // If still not found, check if it's an NPC
        if (!targetId) {
          const npcIndex = this.npcTanks.findIndex(npc => npc === tank);
          if (npcIndex !== -1) {
            // Use the NPC's owner ID if available
            targetId = this.npcTanks[npcIndex].getOwnerId?.() || `npc_${npcIndex}`;
          }
        }
      }
      
      // Only proceed if we have a valid target ID
      if (targetId) {
        console.log(`Sending tank hit for ${sourceId} -> ${targetId} (${hitLocation || 'body'}) to server`);
        
        // Estimate damage amount (server will recalculate this)
        // Different hit locations have different damage multipliers
        let estimatedDamage = 20; // Base damage
        if (hitLocation === 'turret') estimatedDamage = 25;
        if (hitLocation === 'tracks') estimatedDamage = 15;
        
        // Create tank hit data
        const hitData = {
          targetId: targetId,
          sourceId: sourceId,
          damageAmount: estimatedDamage,
          hitLocation: hitLocation || 'body',
          isNetworkEvent: true // Mark as a network event to prevent loops
        };
        
        // Create a custom event using the consolidated format
        const gameEvent = new CustomEvent('game-event', { 
          detail: {
            type: "TANK_HIT",
            data: hitData,
            playerId: this.playerId,
            timestamp: Date.now()
          },
          bubbles: true,
          composed: true
        });
        this.dispatchEvent(gameEvent);
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
      
      // Create death data
      const deathData = {
        targetId: victimId,
        sourceId: killerId
      };
      
      // Create a custom event using the new consolidated format
      const gameEvent = new CustomEvent('game-event', { 
        detail: {
          type: "TANK_DEATH",
          data: deathData,
          playerId: this.playerId,
          timestamp: Date.now()
        },
        bubbles: true,
        composed: true
      });
      this.dispatchEvent(gameEvent);
      
      // Update stats
      this.updateStats();
    } else {
      // It's an NPC tank or a remote player
      console.log('Tank destroyed!', { victimName, killerName });
      
      // If destroyed by player, send event to server (server will update kill count)
      if (source === this.playerTank) {
        // Note: Kill count is now tracked on the server, not locally
        // Local kill count will be updated from the server state later
        console.log(`Player killed ${victimName}! Kill event sent to server.`);
        // Still update the stats to show the visual notification
        this.updateStats();
        
        // Create death data
        const deathData = {
          targetId: victimId,
          sourceId: killerId
        };
        
        // Create a custom event using the new consolidated format
        const gameEvent = new CustomEvent('game-event', { 
          detail: {
            type: "TANK_DEATH",
            data: deathData,
            playerId: this.playerId,
            timestamp: Date.now()
          },
          bubbles: true,
          composed: true
        });
        this.dispatchEvent(gameEvent);
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
      // Get player health
      const health = this.playerTank ? this.playerTank.getHealth() : 0;
      
      // Get player count
      const playerCount = this.multiplayerState?.players ? Object.keys(this.multiplayerState.players).length : 0;
      
      // Get kills and deaths from server game state if available
      let kills = this.playerKills;
      let deaths = this.playerDeaths;
      
      // If we have multiplayer state and our player exists in it, use server values
      if (this.multiplayerState?.players && this.playerId && this.multiplayerState.players[this.playerId]) {
        const playerState = this.multiplayerState.players[this.playerId];
        kills = playerState.kills || 0;
        deaths = playerState.deaths || 0;
        
        // Update local tracking variables to match server state
        this.playerKills = kills;
        this.playerDeaths = deaths;
        
        console.log(`Updated stats from server: Kills=${kills}, Deaths=${deaths}`);
      }
      
      (statsComponent as any).updateGameStats(health, kills, deaths, playerCount);
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
    
    // Create a custom event using the new consolidated format
    const gameEvent = new CustomEvent('game-event', { 
      detail: {
        type: "PLAYER_UPDATE",
        data: detail,
        playerId: this.playerId,
        timestamp: Date.now()
      },
      bubbles: true,
      composed: true // Allows the event to cross shadow DOM boundaries
    });
    
    this.dispatchEvent(gameEvent);
  }
}

// Define the player movement event type for TypeScript
declare global {
  interface Window {
    _processedFireEvents?: Set<string>;
    cameraPosition?: THREE.Vector3;
    SpatialAudio?: typeof SpatialAudio;
  }
  
  interface HTMLElementTagNameMap {
    'game-component': GameComponent;
  }
  
  interface HTMLElementEventMap {
    'game-event': CustomEvent<{
      type: string;
      data: any;
      playerId: string;
      timestamp: number;
    }>;
  }
}
