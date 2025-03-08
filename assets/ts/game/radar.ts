import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import * as THREE from 'three';

interface PlayerPosition {
  id: string;
  position: {
    x: number;
    y: number;
    z: number;
  };
  tankRotation?: number;
  turretRotation?: number;
  color?: string;
  isDestroyed?: boolean;
}

interface GameState {
  players: { [playerId: string]: PlayerPosition };
}

@customElement('game-radar')
export class GameRadar extends LitElement {
  // Canvas for rendering the radar
  private canvas?: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D;
  
  // Properties
  @property({ type: String })
  playerId: string = '';
  
  @property({ type: Object })
  gameState?: GameState;
  
  @property({ type: Number })
  radarRadius: number = 150;  // Size of the radar circle
  
  @property({ type: Number })
  mapScale: number = 0.1;     // Scale factor for map (0.1 = 10:1 ratio)
  
  @property({ type: Number })
  dotSize: number = 6;        // Size of player dots on radar
  
  @property({ type: Boolean })
  showEnemyNames: boolean = true;

  static styles = css`
    :host {
      display: block;
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 1000;
    }

    .radar-container {
      width: 150px;
      height: 150px;
      border-radius: 50%;
      background-color: rgba(0, 0, 0, 0.5);
      border: 2px solid rgba(200, 200, 200, 0.7);
      overflow: hidden;
      box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
    }

    canvas {
      width: 100%;
      height: 100%;
    }

    /* Animated radar sweep effect */
    .radar-sweep {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: linear-gradient(90deg, rgba(0, 255, 0, 0.2) 0%, transparent 50%, transparent 100%);
      animation: sweep 4s infinite linear;
      pointer-events: none;
    }

    @keyframes sweep {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    /* Radar grid lines */
    .radar-grid {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      border: 1px solid rgba(0, 255, 0, 0.3);
      pointer-events: none;
    }

    .radar-grid::before,
    .radar-grid::after {
      content: '';
      position: absolute;
      background-color: rgba(0, 255, 0, 0.3);
    }

    .radar-grid::before {
      top: 50%;
      left: 0;
      width: 100%;
      height: 1px;
    }

    .radar-grid::after {
      top: 0;
      left: 50%;
      width: 1px;
      height: 100%;
    }
  `;

  render() {
    return html`
      <div class="radar-container">
        <canvas></canvas>
        <div class="radar-sweep"></div>
        <div class="radar-grid"></div>
      </div>
    `;
  }

  firstUpdated() {
    // Set up canvas after render
    this.canvas = this.shadowRoot?.querySelector('canvas') as HTMLCanvasElement;
    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
      
      // Set canvas dimensions
      this.canvas.width = this.radarRadius;
      this.canvas.height = this.radarRadius;
      
      // Initial draw
      this.drawRadar();
      
      // Set up animation loop
      this.animateRadar();
    }
  }

  updated(changedProperties: Map<string, any>) {
    if (changedProperties.has('gameState') && this.gameState) {
      // Redraw radar when game state updates
      this.drawRadar();
    }
  }

  private animateRadar() {
    // Create animation loop for smooth updates
    requestAnimationFrame(() => this.animateRadar());
    this.drawRadar();
  }

  private drawRadar() {
    if (!this.ctx || !this.canvas) return;
    
    const ctx = this.ctx;
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;
    
    // Clear the canvas
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Draw radar background (transparent black circle)
    ctx.fillStyle = 'rgba(10, 20, 10, 0.6)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, this.radarRadius / 2, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw radar circles
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.3)';
    ctx.lineWidth = 1;
    
    // Draw concentric circles
    for (let i = 1; i <= 3; i++) {
      const radius = (this.radarRadius / 2) * (i / 3);
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    
    // Exit if no game state
    if (!this.gameState || !this.gameState.players) {
      return;
    }
    
    // Find player position
    const player = this.gameState.players[this.playerId];
    if (!player) {
      return;
    }
    
    const playerPos = new THREE.Vector3(
      player.position.x,
      player.position.y,
      player.position.z
    );
    
    // Draw player (always at center)
    ctx.fillStyle = 'rgba(0, 255, 0, 0.9)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, this.dotSize/2, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw direction indicator for player's tank
    if (player.tankRotation !== undefined) {
      // Draw tank direction
      const dirLength = this.dotSize * 1.5;
      const tankDirX = centerX + Math.sin(player.tankRotation) * dirLength;
      const tankDirY = centerY + Math.cos(player.tankRotation) * dirLength;
      
      ctx.strokeStyle = 'rgba(0, 255, 0, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(tankDirX, tankDirY);
      ctx.stroke();
    }
    
    // Draw other players
    Object.entries(this.gameState.players).forEach(([id, otherPlayer]) => {
      // Skip self
      if (id === this.playerId) return;
      
      // Calculate relative position
      const otherPos = new THREE.Vector3(
        otherPlayer.position.x,
        otherPlayer.position.y,
        otherPlayer.position.z
      );
      
      const relativePos = otherPos.clone().sub(playerPos);
      
      // Scale position to radar
      const scaledX = relativePos.x * this.mapScale;
      const scaledZ = relativePos.z * this.mapScale;
      
      // Calculate distance for dot size/opacity scaling
      const distance = relativePos.length();
      const radarRange = this.radarRadius / (2 * this.mapScale);
      
      // Skip if out of radar range
      if (distance > radarRange) return;
      
      // Calculate radar coordinates
      const radarX = centerX + scaledX;
      const radarY = centerY + scaledZ;
      
      // Calculate dot size and opacity based on distance
      const distanceRatio = Math.min(1, distance / radarRange);
      const adjustedDotSize = this.dotSize * (1 - distanceRatio * 0.5);
      const dotOpacity = 1 - distanceRatio * 0.7;
      
      // Set dot color based on player color or default to red for enemies
      let dotColor = 'rgba(255, 0, 0, ' + dotOpacity + ')';
      if (otherPlayer.color) {
        // Convert hex color to rgb with opacity
        const hex = otherPlayer.color.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        dotColor = `rgba(${r}, ${g}, ${b}, ${dotOpacity})`;
      }
      
      // Use different style for destroyed players
      if (otherPlayer.isDestroyed) {
        // Draw X for destroyed tanks
        ctx.strokeStyle = dotColor;
        ctx.lineWidth = 2;
        const xSize = adjustedDotSize;
        
        ctx.beginPath();
        ctx.moveTo(radarX - xSize, radarY - xSize);
        ctx.lineTo(radarX + xSize, radarY + xSize);
        ctx.moveTo(radarX + xSize, radarY - xSize);
        ctx.lineTo(radarX - xSize, radarY + xSize);
        ctx.stroke();
      } else {
        // Draw active player dot
        ctx.fillStyle = dotColor;
        ctx.beginPath();
        ctx.arc(radarX, radarY, adjustedDotSize, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw outline
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
        
        // Draw direction indicator if tank rotation is available
        if (otherPlayer.tankRotation !== undefined) {
          const dirLength = adjustedDotSize * 1.5;
          const dirX = radarX + Math.sin(otherPlayer.tankRotation) * dirLength;
          const dirY = radarY + Math.cos(otherPlayer.tankRotation) * dirLength;
          
          ctx.strokeStyle = dotColor;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(radarX, radarY);
          ctx.lineTo(dirX, dirY);
          ctx.stroke();
        }
      }
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'game-radar': GameRadar;
  }
}