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

    /* Radar sweep effect - now dynamically rotated in JS */
    .radar-sweep {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: linear-gradient(90deg, rgba(0, 255, 0, 0.2) 0%, transparent 50%, transparent 100%);
      pointer-events: none;
      transform-origin: center;
      animation: pulse 4s infinite ease-in-out;
    }
    
    @keyframes pulse {
      0% { opacity: 0.3; }
      50% { opacity: 0.7; }
      100% { opacity: 0.3; }
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
    // When we render, we won't include the radar-grid div anymore
    // since we're drawing the grid directly on the canvas
    return html`
      <div class="radar-container">
        <canvas></canvas>
        <div class="radar-sweep"></div>
      </div>
    `;
  }

  // Track sweep rotation independently
  private sweepAngle = 0;
  private lastTimestamp = 0;
  
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
      
      // Start radar sweep animation
      this.lastTimestamp = performance.now();
      
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

  private animateRadar(timestamp = performance.now()) {
    // Calculate time delta
    const delta = timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;
    
    // Update sweep angle (complete rotation every 4 seconds)
    this.sweepAngle += (delta / 4000) * Math.PI * 2;
    if (this.sweepAngle > Math.PI * 2) {
      this.sweepAngle -= Math.PI * 2;
    }
    
    // Get player rotation if available
    let playerRotation = 0;
    if (this.gameState?.players && this.playerId && this.gameState.players[this.playerId]) {
      playerRotation = this.gameState.players[this.playerId].tankRotation || 0;
    }
    
    // Update the radar sweep element
    const sweepElement = this.shadowRoot?.querySelector('.radar-sweep') as HTMLElement;
    if (sweepElement) {
      // Combine the sweep rotation with player orientation
      // The sweep rotates in world coordinates, so we add player rotation
      sweepElement.style.transform = `rotate(${this.sweepAngle + playerRotation}rad)`;
    }
    
    // Draw the radar
    this.drawRadar();
    
    // Continue animation
    requestAnimationFrame((t) => this.animateRadar(t));
  }

  private drawRadar() {
    if (!this.ctx || !this.canvas) return;
    
    const ctx = this.ctx;
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;
    
    // Clear the canvas
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Exit if no game state
    if (!this.gameState || !this.gameState.players) {
      return;
    }
    
    // Find player position and rotation
    const player = this.gameState.players[this.playerId];
    if (!player) {
      return;
    }
    
    const playerPos = new THREE.Vector3(
      player.position.x,
      player.position.y,
      player.position.z
    );
    
    // Get player rotation (default to 0 if not defined)
    const playerRotation = player.tankRotation || 0;
    
    // Draw radar background with rotation
    ctx.save();
    
    // Draw radar background (transparent black circle)
    ctx.fillStyle = 'rgba(10, 20, 10, 0.6)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, this.radarRadius / 2, 0, Math.PI * 2);
    ctx.fill();
    
    // Rotate canvas for grid lines to create fixed orientation relative to player
    ctx.translate(centerX, centerY);
    ctx.rotate(-playerRotation); // Negative rotation to counter player rotation
    ctx.translate(-centerX, -centerY);
    
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
    
    // Draw cardinal direction lines (N, S, E, W markings)
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
    ctx.lineWidth = 1;
    
    // North-South line
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - this.radarRadius/2);
    ctx.lineTo(centerX, centerY + this.radarRadius/2);
    ctx.stroke();
    
    // East-West line
    ctx.beginPath();
    ctx.moveTo(centerX - this.radarRadius/2, centerY);
    ctx.lineTo(centerX + this.radarRadius/2, centerY);
    ctx.stroke();
    
    // Add N,S,E,W labels
    ctx.fillStyle = 'rgba(0, 255, 0, 0.7)';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Draw cardinal direction labels
    ctx.fillText('N', centerX, centerY - this.radarRadius/2 + 8);
    ctx.fillText('S', centerX, centerY + this.radarRadius/2 - 8);
    ctx.fillText('E', centerX + this.radarRadius/2 - 8, centerY);
    ctx.fillText('W', centerX - this.radarRadius/2 + 8, centerY);
    
    // Restore canvas state to draw player dots without rotation
    ctx.restore();
    
    // Draw player (always at center, pointing up)
    ctx.fillStyle = 'rgba(0, 255, 0, 0.9)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, this.dotSize/2, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw forward direction indicator for player (always points up)
    const dirLength = this.dotSize * 1.5;
    const tankDirX = centerX; 
    const tankDirY = centerY - dirLength; // Always points up (north)
    
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(tankDirX, tankDirY);
    ctx.stroke();
    
    // Draw other players (with positions rotated relative to player)
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
      
      // Calculate distance for dot size/opacity scaling
      const distance = relativePos.length();
      const radarRange = this.radarRadius / (2 * this.mapScale);
      
      // Skip if out of radar range
      if (distance > radarRange) return;
      
      // Rotate the relative position based on player's rotation
      // Create a rotated coordinate system where player is facing up (negative z)
      const rotatedX = relativePos.x * Math.cos(-playerRotation) - relativePos.z * Math.sin(-playerRotation);
      const rotatedZ = relativePos.x * Math.sin(-playerRotation) + relativePos.z * Math.cos(-playerRotation);
      
      // Scale position to radar
      const scaledX = rotatedX * this.mapScale;
      const scaledZ = rotatedZ * this.mapScale;
      
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
          // Calculate relative rotation angle
          const relativeRotation = otherPlayer.tankRotation - playerRotation;
          
          const dirLength = adjustedDotSize * 1.5;
          const dirX = radarX + Math.sin(relativeRotation) * dirLength;
          const dirY = radarY + Math.cos(relativeRotation) * dirLength;
          
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