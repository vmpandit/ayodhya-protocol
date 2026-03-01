// ── Ayodhya Protocol: Lanka Reforged ── Snapshot Interpolation ──

import { GameSnapshot, PlayerState, EnemyState, BossState, ProjectileState, Vec3 } from '@shared/types';
import { TICK_MS } from '@shared/constants';

interface TimedSnapshot {
  snapshot: GameSnapshot;
  receiveTime: number;
}

const BUFFER_SIZE = 30;
const INTERP_DELAY_MS = TICK_MS * 3; // 3-tick interpolation delay for smoothness

export class Interpolation {
  private buffer: TimedSnapshot[] = [];

  pushSnapshot(snap: GameSnapshot): void {
    this.buffer.push({ snapshot: snap, receiveTime: performance.now() });
    if (this.buffer.length > BUFFER_SIZE) {
      this.buffer.shift();
    }
  }

  getInterpolated(now: number): GameSnapshot | null {
    if (this.buffer.length < 2) {
      return this.buffer.length === 1 ? this.buffer[0].snapshot : null;
    }

    const renderTime = now - INTERP_DELAY_MS;

    // Find the two snapshots to interpolate between
    let from: TimedSnapshot | null = null;
    let to: TimedSnapshot | null = null;

    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i].receiveTime <= renderTime && this.buffer[i + 1].receiveTime >= renderTime) {
        from = this.buffer[i];
        to = this.buffer[i + 1];
        break;
      }
    }

    // If no bracket found, use latest
    if (!from || !to) {
      return this.buffer[this.buffer.length - 1].snapshot;
    }

    const range = to.receiveTime - from.receiveTime;
    const t = range > 0 ? (renderTime - from.receiveTime) / range : 0;
    const alpha = Math.max(0, Math.min(1, t));

    return this.lerpSnapshot(from.snapshot, to.snapshot, alpha);
  }

  private lerpSnapshot(a: GameSnapshot, b: GameSnapshot, t: number): GameSnapshot {
    const players: PlayerState[] = [];
    for (const bp of b.players) {
      const ap = a.players.find(p => p.id === bp.id);
      if (ap) {
        players.push({
          ...bp,
          pos: lerpVec3(ap.pos, bp.pos, t),
          vel: lerpVec3(ap.vel, bp.vel, t),
          yaw: lerpAngle(ap.yaw, bp.yaw, t),
        });
      } else {
        players.push(bp);
      }
    }

    const enemies: EnemyState[] = [];
    for (const be of b.enemies) {
      const ae = a.enemies.find(e => e.id === be.id);
      if (ae) {
        enemies.push({
          ...be,
          pos: lerpVec3(ae.pos, be.pos, t),
          yaw: lerpAngle(ae.yaw, be.yaw, t),
        });
      } else {
        enemies.push(be);
      }
    }

    const projectiles: ProjectileState[] = [];
    for (const bp of b.projectiles) {
      const ap = a.projectiles.find(p => p.id === bp.id);
      if (ap) {
        projectiles.push({
          ...bp,
          pos: lerpVec3(ap.pos, bp.pos, t),
        });
      } else {
        projectiles.push(bp);
      }
    }

    let boss: BossState | null = null;
    if (b.boss) {
      if (a.boss) {
        boss = {
          ...b.boss,
          pos: lerpVec3(a.boss.pos, b.boss.pos, t),
          yaw: lerpAngle(a.boss.yaw, b.boss.yaw, t),
        };
      } else {
        boss = b.boss;
      }
    }

    return { tick: b.tick, serverTime: b.serverTime, players, projectiles, enemies, boss };
  }
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
