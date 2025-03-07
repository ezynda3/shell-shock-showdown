import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import * as THREE from 'three';

/**
 * Stats display component for the game.
 * Shows performance metrics like FPS and gameplay stats in a semi-transparent overlay.
 */
@customElement('game-stats')
export class GameStats extends LitElement {
  // Performance tracking
  @state() private fps: number = 0;
  @state() private frameTime: number = 0;
  @state() private objectCount: number = 0;
  @state() private triangleCount: number = 0;
  
  // Gameplay stats
  @state() private playerHealth: number = 100;
  @state() private kills: number = 0;
  @state() private deaths: number = 0;
  
  // Frame time tracking
  private frameTimeHistory: number[] = [];
  private readonly HISTORY_SIZE = 30; // Average over this many frames
  private lastFrameTime: number = 0;
  private animationFrameId?: number;
  
  // Update interval (milliseconds)
  private readonly UPDATE_INTERVAL = 500;
  private lastUpdateTime: number = 0;
  
  static styles = css`
    :host {
      position: absolute;
      top: 10px;
      left: 10px;
      background: rgba(0, 0, 0, 0.5);
      color: #ffffff;
      font-family: monospace;
      padding: 10px;
      border-radius: 5px;
      min-width: 160px;
      z-index: 1000;
      user-select: none;
      pointer-events: none;
      font-size: 12px;
    }
    
    .title {
      font-weight: bold;
      margin-bottom: 5px;
      font-size: 14px;
      color: #8aff8a;
    }
    
    .section {
      margin-top: 10px;
      border-top: 1px solid rgba(255, 255, 255, 0.3);
      padding-top: 5px;
    }
    
    .stat-row {
      display: flex;
      justify-content: space-between;
      margin: 2px 0;
    }
    
    .stat-label {
      margin-right: 10px;
    }
    
    .stat-value {
      font-weight: bold;
    }
    
    .fps-high {
      color: #8aff8a;
    }
    
    .fps-medium {
      color: #ffff8a;
    }
    
    .fps-low {
      color: #ff8a8a;
    }
    
    .health-high {
      color: #8aff8a;
    }
    
    .health-medium {
      color: #ffff8a;
    }
    
    .health-low {
      color: #ff8a8a;
    }
    
    .kills {
      color: #8aff8a;
    }
    
    .deaths {
      color: #ff8a8a;
    }
  `;

  constructor() {
    super();
    this.startMonitoring();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }

  render() {
    return html`
      <div class="title">Game Stats</div>
      <div class="stat-row">
        <span class="stat-label">Health</span>
        <span class="stat-value ${this.getHealthClass(this.playerHealth)}">${this.playerHealth}%</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Kills</span>
        <span class="stat-value kills">${this.kills}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Deaths</span>
        <span class="stat-value deaths">${this.deaths}</span>
      </div>
      
      <div class="section">
        <div class="title">Performance</div>
        <div class="stat-row">
          <span class="stat-label">FPS</span>
          <span class="stat-value ${this.getFpsClass(this.fps)}">${this.fps.toFixed(1)}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Frame time</span>
          <span class="stat-value">${this.frameTime.toFixed(2)} ms</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Objects</span>
          <span class="stat-value">${this.objectCount}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Triangles</span>
          <span class="stat-value">${this.triangleCount.toLocaleString()}</span>
        </div>
      </div>
    `;
  }

  /**
   * Start performance monitoring
   */
  startMonitoring() {
    const updateFrame = (timestamp: number) => {
      // Calculate instantaneous frame time
      if (this.lastFrameTime > 0) {
        const frameTime = timestamp - this.lastFrameTime;
        this.frameTimeHistory.push(frameTime);
        
        // Keep history at fixed size
        if (this.frameTimeHistory.length > this.HISTORY_SIZE) {
          this.frameTimeHistory.shift();
        }
      }
      
      this.lastFrameTime = timestamp;
      
      // Update stats display at fixed interval
      if (timestamp - this.lastUpdateTime > this.UPDATE_INTERVAL) {
        this.updateStats();
        this.lastUpdateTime = timestamp;
      }
      
      this.animationFrameId = requestAnimationFrame(updateFrame);
    };
    
    this.animationFrameId = requestAnimationFrame(updateFrame);
  }

  /**
   * Update the performance statistics
   */
  updateStats() {
    // Calculate average frame time
    if (this.frameTimeHistory.length > 0) {
      const avgFrameTime = this.frameTimeHistory.reduce((sum, time) => sum + time, 0) / this.frameTimeHistory.length;
      this.frameTime = avgFrameTime;
      this.fps = 1000 / avgFrameTime;
    }
    
    // Find renderer to get scene info
    this.updateSceneStats();
  }
  
  /**
   * Update scene statistics by finding the WebGL renderer
   */
  updateSceneStats() {
    try {
      // Find the game component to get scene info
      const gameComponent = document.querySelector('game-component');
      if (gameComponent) {
        // This requires game-component to expose these properties
        // We'll use dynamic property access to avoid strict typing issues
        const renderer = (gameComponent as any).renderer;
        const scene = (gameComponent as any).scene;
        
        if (renderer && scene) {
          // Get renderer info
          const info = renderer.info;
          if (info && info.render) {
            this.triangleCount = info.render.triangles;
          }
          
          // Count objects in scene
          if (scene.children) {
            this.objectCount = this.countObjects(scene);
          }
        }
      }
    } catch (error) {
      console.error('Error updating scene stats:', error);
    }
  }
  
  /**
   * Count all objects in a scene recursively
   */
  private countObjects(object: THREE.Object3D): number {
    let count = 1; // Count the object itself
    
    if (object.children && object.children.length > 0) {
      for (const child of object.children) {
        count += this.countObjects(child);
      }
    }
    
    return count;
  }
  
  /**
   * Get CSS class for FPS display based on performance
   */
  private getFpsClass(fps: number): string {
    if (fps >= 50) {
      return 'fps-high';
    } else if (fps >= 30) {
      return 'fps-medium';
    } else {
      return 'fps-low';
    }
  }
  
  /**
   * Get CSS class for health display based on health percentage
   */
  private getHealthClass(health: number): string {
    if (health >= 70) {
      return 'health-high';
    } else if (health >= 30) {
      return 'health-medium';
    } else {
      return 'health-low';
    }
  }
  
  /**
   * Set external scene info (can be called from the main game component)
   */
  setSceneInfo(objectCount: number, triangleCount: number) {
    this.objectCount = objectCount;
    this.triangleCount = triangleCount;
  }
  
  /**
   * Update gameplay stats from the game component
   */
  updateGameStats(health: number, kills: number, deaths: number) {
    this.playerHealth = health;
    this.kills = kills;
    this.deaths = deaths;
    this.requestUpdate();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'game-stats': GameStats;
  }
}