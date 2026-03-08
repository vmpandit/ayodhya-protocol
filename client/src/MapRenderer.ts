// ── Ayodhya Protocol: Lanka Reforged ── Map Renderer ──
// Ancient Ramayana-era parchment map with fog-of-war, waypoints, and save/load.
// Renders to a <canvas> element styled like a hand-drawn map from Treta Yuga.

import { Vec3 } from '@shared/types';

// ── Waypoint types ──────────────────────────────────────────────────────────
export const enum WaypointType {
  PlayerVisited = 0,    // Breadcrumb trail
  NPCLocation = 1,      // Discovered NPC
  EnemyCamp = 2,        // Enemy cluster
  BossArena = 3,        // Boss location
  Pickup = 4,           // Arrow pickup / loot
  Landmark = 5,         // Rock, tree cluster, etc.
  ChapterGate = 6,      // Chapter transition zone
  CompanionMet = 7,     // Where you met a companion
  Bridge = 8,           // Bridge crossing
  Temple = 9,           // Temple or shrine
  Cave = 10,            // Cave entrance
  BattleSite = 11,      // Important battle location
  WaterCrossing = 12,   // River/water crossing
}

export interface MapWaypoint {
  x: number;            // World X
  z: number;            // World Z
  type: WaypointType;
  label: string;
  chapter: number;      // Which chapter it was discovered in
  timestamp: number;    // When it was discovered
}

export interface MapRegion {
  cx: number;           // World center X
  cz: number;           // World center Z
  radius: number;       // Revealed radius
  chapter: number;
}

export interface MapSaveData {
  chapter: number;
  playerHp: number;
  playerMaxHp: number;
  playerStamina: number;
  playerPos: Vec3;
  arrowAmmo: number;
  waypoints: MapWaypoint[];
  revealedRegions: MapRegion[];
  chapterGoals: Record<number, { description: string; revealed: boolean; completed: boolean }>;
  companionIds: string[];
  loneWarriorBuff: boolean;
  lakshmanChoice: 'accepted' | 'declined' | null;
  tutorialComplete: boolean;
  timestamp: number;
  playTimeMs: number;
}

// ── Color palette — ancient parchment aesthetic ─────────────────────────────
const PARCHMENT_BG = '#d4b896';
const PARCHMENT_DARK = '#a8885c';
const PARCHMENT_EDGE = '#8b6e3e';
const FOG_COLOR = 'rgba(90, 65, 35, 0.88)';
const INK_COLOR = '#2a1a0a';
const INK_LIGHT = '#5c3d1e';
const GOLD_COLOR = '#b8860b';
const RED_INK = '#6b2020';
const GREEN_INK = '#2e5c2e';
const BLUE_INK = '#1a3a5c';
const PLAYER_COLOR = '#c0392b';
const TRAIL_COLOR = 'rgba(139, 69, 19, 0.35)';

// ── Waypoint icon configs ───────────────────────────────────────────────────
const WAYPOINT_ICONS: Record<WaypointType, { symbol: string; color: string; size: number }> = {
  [WaypointType.PlayerVisited]: { symbol: '·', color: TRAIL_COLOR, size: 3 },
  [WaypointType.NPCLocation]: { symbol: '◈', color: GOLD_COLOR, size: 8 },
  [WaypointType.EnemyCamp]: { symbol: '⚔', color: RED_INK, size: 9 },
  [WaypointType.BossArena]: { symbol: '☠', color: RED_INK, size: 12 },
  [WaypointType.Pickup]: { symbol: '◆', color: GREEN_INK, size: 6 },
  [WaypointType.Landmark]: { symbol: '▲', color: INK_LIGHT, size: 7 },
  [WaypointType.ChapterGate]: { symbol: '⊕', color: BLUE_INK, size: 9 },
  [WaypointType.CompanionMet]: { symbol: '★', color: GOLD_COLOR, size: 9 },
  [WaypointType.Bridge]: { symbol: '⌇', color: GOLD_COLOR, size: 10 },
  [WaypointType.Temple]: { symbol: '◎', color: GOLD_COLOR, size: 9 },
  [WaypointType.Cave]: { symbol: '◉', color: '#6b4226', size: 8 },
  [WaypointType.BattleSite]: { symbol: '⚔', color: RED_INK, size: 9 },
  [WaypointType.WaterCrossing]: { symbol: '≈', color: BLUE_INK, size: 9 },
};

export class MapRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private miniCanvas: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D;

  // Map data
  private waypoints: MapWaypoint[] = [];
  private revealedRegions: MapRegion[] = [];
  private playerPos: Vec3 = { x: 0, y: 0, z: 0 };
  private playerYaw = 0;

  // World bounds for mapping world→canvas coords
  private readonly WORLD_MIN_X = -60;
  private readonly WORLD_MAX_X = 60;
  private readonly WORLD_MIN_Z = -60;
  private readonly WORLD_MAX_Z = 60;

  // Breadcrumb trail
  private breadcrumbs: { x: number; z: number }[] = [];
  private lastBreadcrumbTime = 0;
  private readonly BREADCRUMB_INTERVAL = 800; // ms between breadcrumbs

  // Map info text
  private mapNotes: string[] = [];

  // Play timer
  public playTimeMs = 0;

  constructor(mapCanvas: HTMLCanvasElement, miniMapCanvas: HTMLCanvasElement) {
    this.canvas = mapCanvas;
    this.ctx = mapCanvas.getContext('2d')!;
    this.miniCanvas = miniMapCanvas;
    this.miniCtx = miniMapCanvas.getContext('2d')!;
  }

  // ── Data management ───────────────────────────────────────────────────────

  addWaypoint(wp: MapWaypoint): void {
    // Don't duplicate waypoints at roughly the same position
    const exists = this.waypoints.find(
      w => w.type === wp.type && Math.abs(w.x - wp.x) < 3 && Math.abs(w.z - wp.z) < 3
    );
    if (!exists) {
      this.waypoints.push(wp);
    }
  }

  revealRegion(cx: number, cz: number, radius: number, chapter: number): void {
    this.revealedRegions.push({ cx, cz, radius, chapter });
  }

  /** Reveal area around the player (called every frame while playing) */
  updatePlayerPosition(pos: Vec3, yaw: number): void {
    this.playerPos = pos;
    this.playerYaw = yaw;

    // Auto-reveal around player
    const now = performance.now();
    if (now - this.lastBreadcrumbTime > this.BREADCRUMB_INTERVAL) {
      this.lastBreadcrumbTime = now;
      this.breadcrumbs.push({ x: pos.x, z: pos.z });
      // Keep breadcrumbs manageable
      if (this.breadcrumbs.length > 500) {
        this.breadcrumbs = this.breadcrumbs.filter((_, i) => i % 2 === 0);
      }
    }

    // Auto-reveal a small radius around the player
    // We use a lightweight approach: just track that the player has been nearby
    const existingRegion = this.revealedRegions.find(
      r => Math.abs(r.cx - pos.x) < 5 && Math.abs(r.cz - pos.z) < 5
    );
    if (!existingRegion) {
      this.revealedRegions.push({ cx: pos.x, cz: pos.z, radius: 12, chapter: 0 });
    }
  }

  /** Reveal a large area (e.g., from NPC giving you a map or enemy drop) */
  revealLargeArea(cx: number, cz: number, radius: number, chapter: number, note?: string): void {
    this.revealedRegions.push({ cx, cz, radius, chapter });
    if (note) {
      this.mapNotes.push(note);
      if (this.mapNotes.length > 20) this.mapNotes.shift();
    }
  }

  setMapNote(note: string): void {
    this.mapNotes.push(note);
    if (this.mapNotes.length > 20) this.mapNotes.shift();
  }

  // ── Coordinate transforms ─────────────────────────────────────────────────

  private worldToCanvas(wx: number, wz: number, canvasW: number, canvasH: number, margin = 40): { x: number; y: number } {
    const rangeX = this.WORLD_MAX_X - this.WORLD_MIN_X;
    const rangeZ = this.WORLD_MAX_Z - this.WORLD_MIN_Z;
    const x = margin + ((wx - this.WORLD_MIN_X) / rangeX) * (canvasW - margin * 2);
    const y = margin + ((wz - this.WORLD_MIN_Z) / rangeZ) * (canvasH - margin * 2);
    return { x, y };
  }

  private isRevealed(wx: number, wz: number): boolean {
    for (const r of this.revealedRegions) {
      const dx = wx - r.cx;
      const dz = wz - r.cz;
      if (dx * dx + dz * dz < r.radius * r.radius) return true;
    }
    return false;
  }

  // ── Full map rendering ────────────────────────────────────────────────────

  renderFullMap(chapter: number): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Parchment background
    this.drawParchmentBackground(ctx, w, h);

    // Grid lines (faint)
    this.drawGridLines(ctx, w, h);

    // Terrain features (decorative)
    this.drawTerrainFeatures(ctx, w, h);

    // Fog of war
    this.drawFogOfWar(ctx, w, h);

    // Chapter zone labels
    this.drawChapterZoneLabels(ctx, w, h);

    // Breadcrumb trail
    this.drawBreadcrumbs(ctx, w, h);

    // Waypoints
    this.drawWaypoints(ctx, w, h);

    // Player position
    this.drawPlayerMarker(ctx, w, h);

    // Map border (ornate)
    this.drawOrnamentBorder(ctx, w, h);

    // Title cartouche
    this.drawTitleCartouche(ctx, w, h, chapter);

    // Legend
    this.drawLegend(ctx, w, h);

    // Compass rose
    this.drawCompassRose(ctx, w - 80, h - 80, 35);

    // Map notes / lore text
    this.drawMapNotes(ctx, w, h);
  }

  private drawParchmentBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // Base parchment
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.7);
    grad.addColorStop(0, PARCHMENT_BG);
    grad.addColorStop(0.7, '#c8a87a');
    grad.addColorStop(1, PARCHMENT_DARK);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Paper texture (noise dots)
    ctx.globalAlpha = 0.04;
    for (let i = 0; i < 3000; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#fff';
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1;

    // Age stains
    ctx.globalAlpha = 0.06;
    for (let i = 0; i < 5; i++) {
      const sx = Math.random() * w;
      const sy = Math.random() * h;
      const sr = 30 + Math.random() * 80;
      const stain = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      stain.addColorStop(0, '#6b4226');
      stain.addColorStop(1, 'transparent');
      ctx.fillStyle = stain;
      ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    }
    ctx.globalAlpha = 1;
  }

  private drawGridLines(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.strokeStyle = 'rgba(139, 110, 62, 0.15)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 8]);

    // Vertical lines every 20 world units
    for (let wx = this.WORLD_MIN_X; wx <= this.WORLD_MAX_X; wx += 20) {
      const top = this.worldToCanvas(wx, this.WORLD_MIN_Z, w, h);
      const bot = this.worldToCanvas(wx, this.WORLD_MAX_Z, w, h);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bot.x, bot.y);
      ctx.stroke();
    }
    // Horizontal lines
    for (let wz = this.WORLD_MIN_Z; wz <= this.WORLD_MAX_Z; wz += 20) {
      const left = this.worldToCanvas(this.WORLD_MIN_X, wz, w, h);
      const right = this.worldToCanvas(this.WORLD_MAX_X, wz, w, h);
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private drawTerrainFeatures(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // Draw decorative terrain features that look like ancient hand-drawn maps
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = INK_LIGHT;
    ctx.lineWidth = 0.8;

    // Forest areas (small tree symbols scattered)
    const treeClusters = [
      { x: -30, z: -20, count: 8 },
      { x: -20, z: 20, count: 6 },
      { x: 25, z: -35, count: 5 },
      { x: 35, z: 20, count: 7 },
      { x: -40, z: -40, count: 4 },
    ];

    for (const cluster of treeClusters) {
      for (let i = 0; i < cluster.count; i++) {
        const tx = cluster.x + (Math.sin(i * 2.1) * 6);
        const tz = cluster.z + (Math.cos(i * 1.7) * 6);
        if (!this.isRevealed(tx, tz)) continue;
        const p = this.worldToCanvas(tx, tz, w, h);
        this.drawTreeSymbol(ctx, p.x, p.y, 4 + Math.sin(i) * 2);
      }
    }

    // River (matches World.ts water at (10, 0.08, -30), 4 wide, 60 long)
    // Draw from (10, 0) to (10, -60)
    if (this.isRevealed(10, 0) || this.isRevealed(10, -30) || this.isRevealed(10, -60)) {
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = BLUE_INK;
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 3]); // dashed pattern
      ctx.beginPath();
      const riverStart = this.worldToCanvas(10, 0, w, h);
      const riverEnd = this.worldToCanvas(10, -60, w, h);
      ctx.moveTo(riverStart.x, riverStart.y);
      ctx.lineTo(riverEnd.x, riverEnd.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Ocean (matches World.ts water at (0, 0.04, -110), 120 wide, 40 long)
    // Fill rectangle from z=-90 to z=-130 (southern edge), x=-60 to x=60
    // Clamp to visible map bounds
    {
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = BLUE_INK;
      const oceanTop = this.worldToCanvas(-60, -90, w, h);
      const oceanBot = this.worldToCanvas(60, -130, w, h);
      // Clamp to canvas bounds
      const oceanY = Math.max(oceanBot.y, 0);
      const oceanH = Math.min(oceanTop.y - oceanY, h);
      ctx.fillRect(oceanTop.x, oceanY, oceanBot.x - oceanTop.x, oceanH);
    }

    // Rama Setu Bridge (from world (20, -90) to (42, -62))
    if (this.isRevealed(20, -90) || this.isRevealed(42, -62) || this.isRevealed(31, -76)) {
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = GOLD_COLOR;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]); // dotted pattern
      ctx.beginPath();
      const bridgeStart = this.worldToCanvas(20, -90, w, h);
      const bridgeEnd = this.worldToCanvas(42, -62, w, h);
      ctx.moveTo(bridgeStart.x, bridgeStart.y);
      ctx.lineTo(bridgeEnd.x, bridgeEnd.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label "Rama Setu" at midpoint
      const bridgeMid = this.worldToCanvas(31, -76, w, h);
      ctx.globalAlpha = 0.5;
      ctx.font = 'italic 10px "Cinzel", serif';
      ctx.fillStyle = GOLD_COLOR;
      ctx.textAlign = 'center';
      ctx.fillText('Rama Setu', bridgeMid.x, bridgeMid.y - 6);
    }

    // River / water (wavy line) - original decorative feature
    if (this.isRevealed(0, -45) || this.isRevealed(0, 45)) {
      ctx.globalAlpha = 0.2;
      ctx.strokeStyle = BLUE_INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const start = this.worldToCanvas(-55, -50, w, h);
      ctx.moveTo(start.x, start.y);
      for (let t = 0; t <= 1; t += 0.02) {
        const wx = -55 + t * 110;
        const wz = -50 + Math.sin(t * 8) * 5;
        const p = this.worldToCanvas(wx, wz, w, h);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }

    // Mountains (near boss arena)
    if (this.isRevealed(40, 40)) {
      const mtns = [
        { x: 42, z: 42 }, { x: 46, z: 38 }, { x: 38, z: 46 },
      ];
      for (const m of mtns) {
        const p = this.worldToCanvas(m.x, m.z, w, h);
        this.drawMountainSymbol(ctx, p.x, p.y, 8);
      }
    }

    ctx.globalAlpha = 1;
  }

  private drawTreeSymbol(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x - size * 0.6, y + size * 0.3);
    ctx.lineTo(x + size * 0.6, y + size * 0.3);
    ctx.closePath();
    ctx.stroke();
    // Trunk
    ctx.beginPath();
    ctx.moveTo(x, y + size * 0.3);
    ctx.lineTo(x, y + size * 0.7);
    ctx.stroke();
  }

  private drawMountainSymbol(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
    ctx.beginPath();
    ctx.moveTo(x - size, y + size * 0.5);
    ctx.lineTo(x - size * 0.2, y - size);
    ctx.lineTo(x, y - size * 0.3);
    ctx.lineTo(x + size * 0.3, y - size * 0.8);
    ctx.lineTo(x + size, y + size * 0.5);
    ctx.stroke();
  }

  private drawFogOfWar(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // Create fog overlay — everything NOT revealed is covered
    const fogCanvas = document.createElement('canvas');
    fogCanvas.width = w;
    fogCanvas.height = h;
    const fogCtx = fogCanvas.getContext('2d')!;

    // Fill with fog
    fogCtx.fillStyle = FOG_COLOR;
    fogCtx.fillRect(0, 0, w, h);

    // Cut out revealed areas
    fogCtx.globalCompositeOperation = 'destination-out';
    for (const region of this.revealedRegions) {
      const p = this.worldToCanvas(region.cx, region.cz, w, h);
      const radiusCanvas = (region.radius / (this.WORLD_MAX_X - this.WORLD_MIN_X)) * (w - 80);

      const grad = fogCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radiusCanvas);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.7, 'rgba(0,0,0,0.8)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      fogCtx.fillStyle = grad;
      fogCtx.beginPath();
      fogCtx.arc(p.x, p.y, radiusCanvas, 0, Math.PI * 2);
      fogCtx.fill();
    }

    // Composite fog onto main canvas
    ctx.drawImage(fogCanvas, 0, 0);
  }

  private drawChapterZoneLabels(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // Chapter zone labels at their center positions
    const zones: Array<{ label: string; x: number; z: number }> = [
      { label: 'Dandaka Forest', x: 0, z: -15 },
      { label: 'Panchavati', x: -20, z: -55 },
      { label: 'Kishkindha', x: -55, z: -65 },
      { label: 'Southern Shore', x: -10, z: -95 },
      { label: 'Rama Setu', x: 31, z: -76 },
      { label: 'Lanka Gates', x: 40, z: 25 },
      { label: 'Ravana\'s Palace', x: 50, z: 50 },
    ];

    for (const zone of zones) {
      // Only draw in revealed regions
      if (!this.isRevealed(zone.x, zone.z)) continue;

      const p = this.worldToCanvas(zone.x, zone.z, w, h);

      ctx.font = 'italic 11px "Cinzel", serif';
      ctx.fillStyle = INK_COLOR;
      ctx.globalAlpha = 0.6;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(zone.label, p.x, p.y);
    }

    ctx.globalAlpha = 1;
  }

  private drawBreadcrumbs(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.breadcrumbs.length < 2) return;
    ctx.strokeStyle = TRAIL_COLOR;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    const first = this.worldToCanvas(this.breadcrumbs[0].x, this.breadcrumbs[0].z, w, h);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < this.breadcrumbs.length; i++) {
      const p = this.worldToCanvas(this.breadcrumbs[i].x, this.breadcrumbs[i].z, w, h);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawWaypoints(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    for (const wp of this.waypoints) {
      if (!this.isRevealed(wp.x, wp.z)) continue;
      if (wp.type === WaypointType.PlayerVisited) continue; // breadcrumbs handled separately

      const p = this.worldToCanvas(wp.x, wp.z, w, h);
      const icon = WAYPOINT_ICONS[wp.type];

      // Draw icon
      ctx.font = `${icon.size * 2}px serif`;
      ctx.fillStyle = icon.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(icon.symbol, p.x, p.y);

      // Draw label
      if (wp.label) {
        ctx.font = '10px "Rajdhani", serif';
        ctx.fillStyle = INK_COLOR;
        ctx.textAlign = 'center';
        ctx.fillText(wp.label, p.x, p.y + icon.size + 8);
      }
    }
  }

  private drawPlayerMarker(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const p = this.worldToCanvas(this.playerPos.x, this.playerPos.z, w, h);

    // Glowing dot
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-this.playerYaw + Math.PI / 2);

    // Arrow shape pointing in player's facing direction
    ctx.fillStyle = PLAYER_COLOR;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(-6, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Pulsing glow
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 500);
    ctx.globalAlpha = 0.3 * pulse;
    ctx.fillStyle = PLAYER_COLOR;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.restore();

    // "RAMA" label
    ctx.font = 'bold 11px "Rajdhani", serif';
    ctx.fillStyle = PLAYER_COLOR;
    ctx.textAlign = 'center';
    ctx.fillText('RAMA', p.x, p.y + 18);
  }

  private drawOrnamentBorder(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const borderWidth = 8;
    ctx.strokeStyle = PARCHMENT_EDGE;
    ctx.lineWidth = borderWidth;
    ctx.strokeRect(borderWidth / 2, borderWidth / 2, w - borderWidth, h - borderWidth);

    // Inner decorative border
    ctx.strokeStyle = GOLD_COLOR;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(16, 16, w - 32, h - 32);

    // Corner ornaments
    const corners = [
      { x: 16, y: 16 }, { x: w - 16, y: 16 },
      { x: 16, y: h - 16 }, { x: w - 16, y: h - 16 },
    ];
    ctx.fillStyle = GOLD_COLOR;
    for (const c of corners) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Decorative lotus/floral at top corners
    for (const c of [corners[0], corners[1]]) {
      ctx.font = '16px serif';
      ctx.textAlign = 'center';
      ctx.fillText('❋', c.x + (c === corners[0] ? 14 : -14), c.y + 14);
    }
  }

  private drawTitleCartouche(ctx: CanvasRenderingContext2D, w: number, h: number, chapter: number): void {
    // Decorative title box at the top
    const cartW = 300;
    const cartH = 50;
    const cx = w / 2;
    const cy = 45;

    // Box background
    ctx.fillStyle = 'rgba(212, 184, 150, 0.95)';
    ctx.strokeStyle = GOLD_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(cx - cartW / 2, cy - cartH / 2, cartW, cartH, 4);
    ctx.fill();
    ctx.stroke();

    // Title text — Devanagari-inspired styling
    ctx.font = 'bold 18px "Cinzel", serif';
    ctx.fillStyle = INK_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Lanka Reforged — Map of the Realm', cx, cy - 8);

    // Subtitle
    ctx.font = '11px "Rajdhani", serif';
    ctx.fillStyle = INK_LIGHT;
    ctx.fillText(chapter === 0 ? 'Training Grounds' : `Chapter ${chapter} — Path of Dharma`, cx, cy + 14);
  }

  private drawLegend(ctx: CanvasRenderingContext2D, w: number, _h: number): void {
    const lx = 30;
    const ly = 90;
    const lineH = 18;

    ctx.font = 'bold 11px "Rajdhani", serif';
    ctx.fillStyle = INK_COLOR;
    ctx.textAlign = 'left';
    ctx.fillText('LEGEND', lx, ly);

    // Underline
    ctx.strokeStyle = GOLD_COLOR;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(lx, ly + 3);
    ctx.lineTo(lx + 50, ly + 3);
    ctx.stroke();

    const legendItems: { symbol: string; color: string; label: string }[] = [
      { symbol: '▶', color: PLAYER_COLOR, label: 'You (Rama)' },
      { symbol: '◈', color: GOLD_COLOR, label: 'Ally / NPC' },
      { symbol: '⚔', color: RED_INK, label: 'Enemy Camp' },
      { symbol: '☠', color: RED_INK, label: 'Boss Arena' },
      { symbol: '★', color: GOLD_COLOR, label: 'Companion Met' },
      { symbol: '⊕', color: BLUE_INK, label: 'Chapter Gate' },
      { symbol: '◆', color: GREEN_INK, label: 'Supply' },
    ];

    for (let i = 0; i < legendItems.length; i++) {
      const item = legendItems[i];
      const y = ly + 16 + i * lineH;

      ctx.font = '14px serif';
      ctx.fillStyle = item.color;
      ctx.fillText(item.symbol, lx, y);

      ctx.font = '10px "Rajdhani", serif';
      ctx.fillStyle = INK_COLOR;
      ctx.fillText(item.label, lx + 18, y);
    }
  }

  private drawCompassRose(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
    ctx.save();
    ctx.translate(cx, cy);

    // Main cross
    ctx.strokeStyle = INK_COLOR;
    ctx.fillStyle = INK_COLOR;
    ctx.lineWidth = 1.5;

    // N-S line
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(0, size);
    ctx.stroke();

    // E-W line
    ctx.beginPath();
    ctx.moveTo(-size, 0);
    ctx.lineTo(size, 0);
    ctx.stroke();

    // North arrow (filled)
    ctx.fillStyle = RED_INK;
    ctx.beginPath();
    ctx.moveTo(0, -size - 4);
    ctx.lineTo(-4, -size + 8);
    ctx.lineTo(4, -size + 8);
    ctx.closePath();
    ctx.fill();

    // Diagonal lines
    ctx.lineWidth = 0.8;
    const diagSize = size * 0.6;
    ctx.beginPath();
    ctx.moveTo(-diagSize, -diagSize);
    ctx.lineTo(diagSize, diagSize);
    ctx.moveTo(diagSize, -diagSize);
    ctx.lineTo(-diagSize, diagSize);
    ctx.stroke();

    // Direction labels
    ctx.font = 'bold 12px serif';
    ctx.fillStyle = INK_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, -size - 14);
    ctx.fillText('S', 0, size + 14);
    ctx.fillText('E', size + 14, 0);
    ctx.fillText('W', -size - 14, 0);

    // Center dot
    ctx.fillStyle = GOLD_COLOR;
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawMapNotes(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.mapNotes.length === 0) return;

    const startY = h - 120;
    ctx.font = 'italic 10px "Rajdhani", serif';
    ctx.fillStyle = INK_LIGHT;
    ctx.textAlign = 'left';

    const recentNotes = this.mapNotes.slice(-4); // Show last 4 notes
    for (let i = 0; i < recentNotes.length; i++) {
      ctx.fillText(`— ${recentNotes[i]}`, 30, startY + i * 14);
    }
  }

  // ── Minimap rendering ─────────────────────────────────────────────────────

  renderMinimap(): void {
    const w = this.miniCanvas.width;
    const h = this.miniCanvas.height;
    const ctx = this.miniCtx;

    ctx.clearRect(0, 0, w, h);

    // Circular clip
    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
    ctx.clip();

    // Parchment background
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, PARCHMENT_BG);
    grad.addColorStop(1, PARCHMENT_DARK);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Draw nearby revealed terrain (centered on player)
    const viewRadius = 40; // world units visible in minimap
    const scale = (w / 2 - 4) / viewRadius;
    const pcx = w / 2;
    const pcy = h / 2;

    // Fog
    ctx.fillStyle = FOG_COLOR;
    ctx.fillRect(0, 0, w, h);

    // Reveal areas
    ctx.globalCompositeOperation = 'destination-out';
    for (const region of this.revealedRegions) {
      const dx = region.cx - this.playerPos.x;
      const dz = region.cz - this.playerPos.z;
      const sx = pcx + dx * scale;
      const sy = pcy + dz * scale;
      const sr = region.radius * scale;

      const rGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      rGrad.addColorStop(0, 'rgba(0,0,0,1)');
      rGrad.addColorStop(0.8, 'rgba(0,0,0,0.5)');
      rGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rGrad;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // Waypoints
    for (const wp of this.waypoints) {
      if (wp.type === WaypointType.PlayerVisited) continue;
      if (!this.isRevealed(wp.x, wp.z)) continue;

      const dx = wp.x - this.playerPos.x;
      const dz = wp.z - this.playerPos.z;
      if (Math.abs(dx) > viewRadius || Math.abs(dz) > viewRadius) continue;

      const sx = pcx + dx * scale;
      const sy = pcy + dz * scale;
      const icon = WAYPOINT_ICONS[wp.type];

      ctx.fillStyle = icon.color;
      ctx.beginPath();
      ctx.arc(sx, sy, icon.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player dot (center)
    ctx.save();
    ctx.translate(pcx, pcy);
    ctx.rotate(-this.playerYaw + Math.PI / 2);

    ctx.fillStyle = PLAYER_COLOR;
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(-3, 3);
    ctx.lineTo(0, 1.5);
    ctx.lineTo(3, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore(); // Undo clip

    // Border ring
    ctx.strokeStyle = GOLD_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();

    // Small N indicator
    ctx.font = 'bold 9px serif';
    ctx.fillStyle = RED_INK;
    ctx.textAlign = 'center';
    ctx.fillText('N', w / 2, 12);
  }

  // ── Save/Load system ──────────────────────────────────────────────────────

  static readonly SAVE_KEY = 'ayodhya_protocol_save';

  createSaveData(simState: {
    chapter: number;
    playerHp: number;
    playerMaxHp: number;
    playerStamina: number;
    playerPos: Vec3;
    arrowAmmo: number;
    chapterGoals: Record<number, { description: string; revealed: boolean; completed: boolean }>;
    companionIds: string[];
    loneWarriorBuff: boolean;
    lakshmanChoice: 'accepted' | 'declined' | null;
    tutorialComplete: boolean;
  }): MapSaveData {
    return {
      ...simState,
      waypoints: [...this.waypoints],
      revealedRegions: [...this.revealedRegions],
      timestamp: Date.now(),
      playTimeMs: this.playTimeMs,
    };
  }

  saveToLocalStorage(data: MapSaveData): boolean {
    try {
      localStorage.setItem(MapRenderer.SAVE_KEY, JSON.stringify(data));
      return true;
    } catch {
      console.warn('[Map] Failed to save game to localStorage');
      return false;
    }
  }

  static loadFromLocalStorage(): MapSaveData | null {
    try {
      const raw = localStorage.getItem(MapRenderer.SAVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as MapSaveData;
    } catch {
      return null;
    }
  }

  static deleteSave(): void {
    try {
      localStorage.removeItem(MapRenderer.SAVE_KEY);
    } catch { /* ignore */ }
  }

  static hasSave(): boolean {
    try {
      return localStorage.getItem(MapRenderer.SAVE_KEY) !== null;
    } catch {
      return false;
    }
  }

  /** Restore map state from save data */
  restoreFromSave(save: MapSaveData): void {
    this.waypoints = [...save.waypoints];
    this.revealedRegions = [...save.revealedRegions];
    this.playTimeMs = save.playTimeMs;
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  getWaypointCount(): number {
    return this.waypoints.filter(w => w.type !== WaypointType.PlayerVisited).length;
  }

  getRevealedPercentage(): number {
    // Approximate: sample grid points and check how many are revealed
    let total = 0;
    let revealed = 0;
    for (let x = this.WORLD_MIN_X; x <= this.WORLD_MAX_X; x += 5) {
      for (let z = this.WORLD_MIN_Z; z <= this.WORLD_MAX_Z; z += 5) {
        total++;
        if (this.isRevealed(x, z)) revealed++;
      }
    }
    return total > 0 ? (revealed / total) * 100 : 0;
  }

  formatPlayTime(): string {
    const totalSec = Math.floor(this.playTimeMs / 1000);
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
    return `${mins}m ${secs}s`;
  }
}
