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
  mapScale: number = 0.08;    // Scale factor for map

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
      background-color: rgba(0, 0, 0, 0.6);
      border: 2px solid rgba(200, 200, 200, 0.7);
      overflow: hidden;
      box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
    }

    canvas {
      width: 100%;
      height: 100%;
    }
  `;

  render() {
    return html`
      <div class="radar-container">
        <canvas></canvas>
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
      requestAnimationFrame(() => this.animateRadar());
    }
  }

  updated(changedProperties: Map<string, any>) {
    if (changedProperties.has('gameState') && this.gameState) {
      this.drawRadar();
    }
  }
  
  private animateRadar() {
    // Draw the radar every frame
    this.drawRadar();
    
    // Continue animation
    requestAnimationFrame(() => this.animateRadar());
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
    
    // Find player data
    const player = this.gameState.players[this.playerId];
    if (!player) {
      return;
    }
    
    // Draw radar background
    ctx.fillStyle = 'rgba(0, 30, 0, 0.7)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, this.radarRadius / 2, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw radar border
    ctx.strokeStyle = 'rgba(0, 200, 0, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, this.radarRadius / 2, 0, Math.PI * 2);
    ctx.stroke();
    
    // Draw radar rings
    ctx.strokeStyle = 'rgba(0, 200, 0, 0.2)';
    ctx.lineWidth = 1;
    
    // Draw concentric circles
    for (let i = 1; i < 3; i++) {
      const radius = (this.radarRadius / 2) * (i / 3);
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    
    // Draw fixed crosshairs (no rotation)
    ctx.strokeStyle = 'rgba(0, 200, 0, 0.3)';
    ctx.lineWidth = 1;
    
    // Vertical line
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - this.radarRadius/2);
    ctx.lineTo(centerX, centerY + this.radarRadius/2);
    ctx.stroke();
    
    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(centerX - this.radarRadius/2, centerY);
    ctx.lineTo(centerX + this.radarRadius/2, centerY);
    ctx.stroke();
    
    // Draw fixed direction marker (always pointing up)
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
    ctx.fillStyle = 'rgba(0, 255, 0, 0.8)';
    ctx.lineWidth = 2;
    
    // Forward triangle pointer
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - this.radarRadius/2 + 5);
    ctx.lineTo(centerX - 5, centerY - this.radarRadius/2 + 15);
    ctx.lineTo(centerX + 5, centerY - this.radarRadius/2 + 15);
    ctx.closePath();
    ctx.fill();
    
    // Draw player (always at center)
    ctx.fillStyle = 'rgba(0, 255, 0, 0.9)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 4, 0, Math.PI * 2);
    ctx.fill();
    
    // Get player position and rotation
    const playerPos = new THREE.Vector3(player.position.x, player.position.y, player.position.z);
    const playerRot = player.tankRotation || 0;
    
    // Draw other players with fixed coordinate system (arrow is north)
    Object.entries(this.gameState.players).forEach(([id, otherPlayer]) => {
      // Skip self
      if (id === this.playerId) return;
      
      // Get other player position
      const otherPos = new THREE.Vector3(
        otherPlayer.position.x,
        otherPlayer.position.y,
        otherPlayer.position.z
      );
      
      // Calculate relative position vector (other - player)
      const relativePos = otherPos.clone().sub(playerPos);
      
      // Calculate distance for scaling and range check
      const distance = relativePos.length();
      const radarRange = this.radarRadius / (2 * this.mapScale);
      
      // Skip if out of radar range
      if (distance > radarRange) return;
      
      // In THREE.js, the world coordinate system has:
      // +X = right
      // +Y = up 
      // +Z = towards viewer (out of screen)
      //
      // For the radar, we want:
      // +X (radar) = right
      // +Y (radar) = up (which is -Z in THREE.js coordinates)
      
      // Create a world-forward vector (player looking direction)
      const forwardVec = new THREE.Vector3(0, 0, -1);  // -Z is forward in THREE.js
      
      // Create a rotation to apply to this vector based on player rotation
      const rotationY = new THREE.Matrix4().makeRotationY(playerRot);
      forwardVec.applyMatrix4(rotationY);
      
      // Now we need to find the angle between the relative position and the forward vector,
      // in the XZ plane.
      
      // Project both vectors onto XZ plane (ignore Y component)
      const relXZ = new THREE.Vector2(relativePos.x, relativePos.z).normalize();
      const forwardXZ = new THREE.Vector2(forwardVec.x, forwardVec.z).normalize();
      
      // Calculate the angle between these vectors
      // We use the 2D cross product (determinant) and dot product
      const dot = relXZ.x * forwardXZ.x + relXZ.y * forwardXZ.y;
      const det = relXZ.x * forwardXZ.y - relXZ.y * forwardXZ.x;
      const angle = Math.atan2(det, dot);
      
      // Calculate radar position using the angle and distance
      // Invert the angle to fix rotation direction
      const radarDistance = distance * this.mapScale;
      const radarX = centerX - Math.sin(angle) * radarDistance;
      const radarY = centerY + Math.cos(angle) * radarDistance;
      
      // Adjust dot size and opacity based on distance
      const distanceRatio = Math.min(1, distance / radarRange);
      const dotSize = 5 * (1 - distanceRatio * 0.5);
      const dotOpacity = 1 - distanceRatio * 0.6;
      
      // Set dot color based on player color or default to red
      let dotColor = `rgba(255, 50, 50, ${dotOpacity})`;
      if (otherPlayer.color) {
        // Convert hex color to rgb with opacity
        const hex = otherPlayer.color.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        dotColor = `rgba(${r}, ${g}, ${b}, ${dotOpacity})`;
      }
      
      // Draw destroyed players as X
      if (otherPlayer.isDestroyed) {
        ctx.strokeStyle = dotColor;
        ctx.lineWidth = 2;
        
        ctx.beginPath();
        ctx.moveTo(radarX - dotSize, radarY - dotSize);
        ctx.lineTo(radarX + dotSize, radarY + dotSize);
        ctx.moveTo(radarX + dotSize, radarY - dotSize);
        ctx.lineTo(radarX - dotSize, radarY + dotSize);
        ctx.stroke();
      } else {
        // Draw active player dot
        ctx.fillStyle = dotColor;
        ctx.beginPath();
        ctx.arc(radarX, radarY, dotSize, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw outline
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'game-radar': GameRadar;
  }
}