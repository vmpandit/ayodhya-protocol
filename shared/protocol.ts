// ── Ayodhya Protocol: Lanka Reforged ── Binary Protocol ──
// All runtime messages use fixed-layout Uint8Array. Zero JSON.

import {
  MsgType, PlayerState, ProjectileState, EnemyState, BossState,
  GameSnapshot, PlayerInput, ProjectileType, AbilityType,
  PlayerStatus, EnemyAIState, BossPhase, Vec3,
} from './types';

// ── Helpers ──
const F32 = 4;
const U8 = 1;
const U16 = 2;
const U32 = 4;
const I16 = 2;

function writeF32(buf: DataView, off: number, v: number): number {
  buf.setFloat32(off, v, true);
  return off + F32;
}
function readF32(buf: DataView, off: number): [number, number] {
  return [buf.getFloat32(off, true), off + F32];
}
function writeU8(buf: DataView, off: number, v: number): number {
  buf.setUint8(off, v);
  return off + U8;
}
function readU8(buf: DataView, off: number): [number, number] {
  return [buf.getUint8(off), off + U8];
}
function writeU16(buf: DataView, off: number, v: number): number {
  buf.setUint16(off, v, true);
  return off + U16;
}
function readU16(buf: DataView, off: number): [number, number] {
  return [buf.getUint16(off, true), off + U16];
}
function writeU32(buf: DataView, off: number, v: number): number {
  buf.setUint32(off, v, true);
  return off + U32;
}
function readU32(buf: DataView, off: number): [number, number] {
  return [buf.getUint32(off, true), off + U32];
}
function writeI16(buf: DataView, off: number, v: number): number {
  buf.setInt16(off, v, true);
  return off + I16;
}
function readI16(buf: DataView, off: number): [number, number] {
  return [buf.getInt16(off, true), off + I16];
}

function writeVec3(buf: DataView, off: number, v: Vec3): number {
  off = writeF32(buf, off, v.x);
  off = writeF32(buf, off, v.y);
  off = writeF32(buf, off, v.z);
  return off;
}
function readVec3(buf: DataView, off: number): [Vec3, number] {
  let x: number, y: number, z: number;
  [x, off] = readF32(buf, off);
  [y, off] = readF32(buf, off);
  [z, off] = readF32(buf, off);
  return [{ x, y, z }, off];
}

// ── Join (Client → Server): [MsgType(1)] ──
export function encodeJoin(): Uint8Array {
  const buf = new Uint8Array(1);
  buf[0] = MsgType.Join;
  return buf;
}

// ── PlayerJoined (Server → Client): [MsgType(1), playerId(1)] ──
export function encodePlayerJoined(playerId: number): Uint8Array {
  const buf = new Uint8Array(2);
  buf[0] = MsgType.PlayerJoined;
  buf[1] = playerId;
  return buf;
}
export function decodePlayerJoined(data: Uint8Array): number {
  return data[1];
}

// ── PlayerLeft (Server → Client): [MsgType(1), playerId(1)] ──
export function encodePlayerLeft(playerId: number): Uint8Array {
  const buf = new Uint8Array(2);
  buf[0] = MsgType.PlayerLeft;
  buf[1] = playerId;
  return buf;
}
export function decodePlayerLeft(data: Uint8Array): number {
  return data[1];
}

// ── Input (Client → Server) ──
// [MsgType(1), seq(4), flags(2), yaw(4), pitch(4), chargeMs(2), dt(4)] = 21 bytes
const INPUT_SIZE = 1 + U32 + U16 + F32 + F32 + U16 + F32;

export function encodeInput(input: PlayerInput): Uint8Array {
  const arr = new Uint8Array(INPUT_SIZE);
  const buf = new DataView(arr.buffer);
  let off = 0;
  off = writeU8(buf, off, MsgType.Input);
  off = writeU32(buf, off, input.seq);
  off = writeU16(buf, off, input.flags);
  off = writeF32(buf, off, input.yaw);
  off = writeF32(buf, off, input.pitch);
  off = writeU16(buf, off, input.chargeMs);
  writeF32(buf, off, input.dt);
  return arr;
}

export function decodeInput(data: Uint8Array): PlayerInput {
  const buf = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let off = 1; // skip msg type
  let seq: number, flags: number, yaw: number, pitch: number, chargeMs: number, dt: number;
  [seq, off] = readU32(buf, off);
  [flags, off] = readU16(buf, off);
  [yaw, off] = readF32(buf, off);
  [pitch, off] = readF32(buf, off);
  [chargeMs, off] = readU16(buf, off);
  [dt, off] = readF32(buf, off);
  return { seq, flags, yaw, pitch, chargeMs, dt };
}

// ── Ability (Client → Server) ──
// [MsgType(1), abilityType(1), dirX(4), dirY(4), dirZ(4)] = 14 bytes
export function encodeAbility(type: AbilityType, dir: Vec3): Uint8Array {
  const arr = new Uint8Array(14);
  const buf = new DataView(arr.buffer);
  let off = 0;
  off = writeU8(buf, off, MsgType.Ability);
  off = writeU8(buf, off, type);
  writeVec3(buf, off, dir);
  return arr;
}
export function decodeAbility(data: Uint8Array): { type: AbilityType; dir: Vec3 } {
  const buf = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let off = 1;
  let type: number;
  [type, off] = readU8(buf, off);
  const [dir] = readVec3(buf, off);
  return { type: type as AbilityType, dir };
}

// ── Snapshot (Server → Client) ──
// Header: [MsgType(1), tick(4), serverTime(8), playerCount(1), projCount(2), enemyCount(2), hasBoss(1)]
// Per player: [id(1), posXYZ(12), velXYZ(12), yaw(4), hp(2), maxHp(2), stamina(2), status(1), isDodging(1), lastSeq(4)] = 41
// Per projectile: [id(2), type(1), ownerId(1), posXYZ(12), velXYZ(12), damage(2)] = 30
// Per enemy: [id(2), posXYZ(12), yaw(4), hp(2), maxHp(2), aiState(1), targetId(1)] = 24
// Boss: [posXYZ(12), yaw(4), hp(4), maxHp(4), phase(1), isAoE(1), isBarrage(1)] = 27

const SNAP_HEADER = 1 + U32 + 8 + U8 + U16 + U16 + U8;
const SNAP_PLAYER = U8 + 12 + 12 + F32 + U16 + U16 + U16 + U8 + U8 + U32;
const SNAP_PROJ = U16 + U8 + U8 + 12 + 12 + U16;
const SNAP_ENEMY = U16 + 12 + F32 + U16 + U16 + U8 + U8;
const SNAP_BOSS = 12 + F32 + U32 + U32 + U8 + U8 + U8;

export function encodeSnapshot(snap: GameSnapshot): Uint8Array {
  const size = SNAP_HEADER
    + snap.players.length * SNAP_PLAYER
    + snap.projectiles.length * SNAP_PROJ
    + snap.enemies.length * SNAP_ENEMY
    + (snap.boss ? SNAP_BOSS : 0);
  const arr = new Uint8Array(size);
  const buf = new DataView(arr.buffer);
  let off = 0;

  // Header
  off = writeU8(buf, off, MsgType.Snapshot);
  off = writeU32(buf, off, snap.tick);
  buf.setFloat64(off, snap.serverTime, true); off += 8;
  off = writeU8(buf, off, snap.players.length);
  off = writeU16(buf, off, snap.projectiles.length);
  off = writeU16(buf, off, snap.enemies.length);
  off = writeU8(buf, off, snap.boss ? 1 : 0);

  // Players
  for (const p of snap.players) {
    off = writeU8(buf, off, p.id);
    off = writeVec3(buf, off, p.pos);
    off = writeVec3(buf, off, p.vel);
    off = writeF32(buf, off, p.yaw);
    off = writeU16(buf, off, Math.round(p.hp));
    off = writeU16(buf, off, Math.round(p.maxHp));
    off = writeU16(buf, off, Math.round(p.stamina));
    off = writeU8(buf, off, p.status);
    off = writeU8(buf, off, p.isDodging ? 1 : 0);
    off = writeU32(buf, off, p.lastProcessedSeq);
  }

  // Projectiles
  for (const pr of snap.projectiles) {
    off = writeU16(buf, off, pr.id);
    off = writeU8(buf, off, pr.type);
    off = writeU8(buf, off, pr.ownerId);
    off = writeVec3(buf, off, pr.pos);
    off = writeVec3(buf, off, pr.vel);
    off = writeU16(buf, off, Math.round(pr.damage));
  }

  // Enemies
  for (const e of snap.enemies) {
    off = writeU16(buf, off, e.id);
    off = writeVec3(buf, off, e.pos);
    off = writeF32(buf, off, e.yaw);
    off = writeU16(buf, off, Math.round(e.hp));
    off = writeU16(buf, off, Math.round(e.maxHp));
    off = writeU8(buf, off, e.aiState);
    off = writeU8(buf, off, e.targetId);
  }

  // Boss
  if (snap.boss) {
    const b = snap.boss;
    off = writeVec3(buf, off, b.pos);
    off = writeF32(buf, off, b.yaw);
    off = writeU32(buf, off, Math.round(b.hp));
    off = writeU32(buf, off, Math.round(b.maxHp));
    off = writeU8(buf, off, b.phase);
    off = writeU8(buf, off, b.isAoE ? 1 : 0);
    off = writeU8(buf, off, b.isBarrage ? 1 : 0);
  }

  return arr;
}

export function decodeSnapshot(data: Uint8Array): GameSnapshot {
  const buf = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let off = 1; // skip msg type

  let tick: number;
  [tick, off] = readU32(buf, off);
  const serverTime = buf.getFloat64(off, true); off += 8;
  let playerCount: number, projCount: number, enemyCount: number, hasBoss: number;
  [playerCount, off] = readU8(buf, off);
  [projCount, off] = readU16(buf, off);
  [enemyCount, off] = readU16(buf, off);
  [hasBoss, off] = readU8(buf, off);

  const players: PlayerState[] = [];
  for (let i = 0; i < playerCount; i++) {
    let id: number, pos: Vec3, vel: Vec3, yaw: number;
    let hp: number, maxHp: number, stamina: number, status: number, isDodgingU8: number, lastProcessedSeq: number;
    [id, off] = readU8(buf, off);
    [pos, off] = readVec3(buf, off);
    [vel, off] = readVec3(buf, off);
    [yaw, off] = readF32(buf, off);
    [hp, off] = readU16(buf, off);
    [maxHp, off] = readU16(buf, off);
    [stamina, off] = readU16(buf, off);
    [status, off] = readU8(buf, off);
    [isDodgingU8, off] = readU8(buf, off);
    [lastProcessedSeq, off] = readU32(buf, off);
    players.push({ id, pos, vel, yaw, hp, maxHp, stamina, status: status as PlayerStatus, isDodging: isDodgingU8 === 1, lastProcessedSeq });
  }

  const projectiles: ProjectileState[] = [];
  for (let i = 0; i < projCount; i++) {
    let id: number, type: number, ownerId: number, pos: Vec3, vel: Vec3, damage: number;
    [id, off] = readU16(buf, off);
    [type, off] = readU8(buf, off);
    [ownerId, off] = readU8(buf, off);
    [pos, off] = readVec3(buf, off);
    [vel, off] = readVec3(buf, off);
    [damage, off] = readU16(buf, off);
    projectiles.push({ id, type: type as ProjectileType, ownerId, pos, vel, damage });
  }

  const enemies: EnemyState[] = [];
  for (let i = 0; i < enemyCount; i++) {
    let id: number, pos: Vec3, yaw: number, hp: number, maxHp: number, aiState: number, targetId: number;
    [id, off] = readU16(buf, off);
    [pos, off] = readVec3(buf, off);
    [yaw, off] = readF32(buf, off);
    [hp, off] = readU16(buf, off);
    [maxHp, off] = readU16(buf, off);
    [aiState, off] = readU8(buf, off);
    [targetId, off] = readU8(buf, off);
    enemies.push({ id, pos, yaw, hp, maxHp, aiState: aiState as EnemyAIState, targetId });
  }

  let boss: BossState | null = null;
  if (hasBoss) {
    let pos: Vec3, yaw: number, hp: number, maxHp: number, phase: number, isAoEU8: number, isBarrageU8: number;
    [pos, off] = readVec3(buf, off);
    [yaw, off] = readF32(buf, off);
    [hp, off] = readU32(buf, off);
    [maxHp, off] = readU32(buf, off);
    [phase, off] = readU8(buf, off);
    [isAoEU8, off] = readU8(buf, off);
    [isBarrageU8, off] = readU8(buf, off);
    boss = { pos, yaw, hp, maxHp, phase: phase as BossPhase, isAoE: isAoEU8 === 1, isBarrage: isBarrageU8 === 1 };
  }

  return { tick, serverTime, players, projectiles, enemies, boss };
}

// ── ProjectileSpawn (Server → Client) ──
// [MsgType(1), id(2), type(1), ownerId(1), posXYZ(12), velXYZ(12), damage(2)] = 31
export function encodeProjectileSpawn(p: ProjectileState): Uint8Array {
  const arr = new Uint8Array(31);
  const buf = new DataView(arr.buffer);
  let off = 0;
  off = writeU8(buf, off, MsgType.ProjectileSpawn);
  off = writeU16(buf, off, p.id);
  off = writeU8(buf, off, p.type);
  off = writeU8(buf, off, p.ownerId);
  off = writeVec3(buf, off, p.pos);
  off = writeVec3(buf, off, p.vel);
  writeU16(buf, off, Math.round(p.damage));
  return arr;
}
export function decodeProjectileSpawn(data: Uint8Array): ProjectileState {
  const buf = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let off = 1;
  let id: number, type: number, ownerId: number, pos: Vec3, vel: Vec3, damage: number;
  [id, off] = readU16(buf, off);
  [type, off] = readU8(buf, off);
  [ownerId, off] = readU8(buf, off);
  [pos, off] = readVec3(buf, off);
  [vel, off] = readVec3(buf, off);
  [damage, off] = readU16(buf, off);
  return { id, type: type as ProjectileType, ownerId, pos, vel, damage };
}

// ── Damage (Server → Client) ──
// [MsgType(1), targetType(1), targetId(2), damage(2), sourceId(1)] = 7
export const enum DamageTargetType {
  Player = 0,
  Enemy = 1,
  Boss = 2,
}
export function encodeDamage(targetType: DamageTargetType, targetId: number, damage: number, sourceId: number): Uint8Array {
  const arr = new Uint8Array(7);
  const buf = new DataView(arr.buffer);
  let off = 0;
  off = writeU8(buf, off, MsgType.Damage);
  off = writeU8(buf, off, targetType);
  off = writeU16(buf, off, targetId);
  off = writeU16(buf, off, Math.round(damage));
  writeU8(buf, off, sourceId);
  return arr;
}
export function decodeDamage(data: Uint8Array): { targetType: DamageTargetType; targetId: number; damage: number; sourceId: number } {
  const buf = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let off = 1;
  let targetType: number, targetId: number, damage: number, sourceId: number;
  [targetType, off] = readU8(buf, off);
  [targetId, off] = readU16(buf, off);
  [damage, off] = readU16(buf, off);
  [sourceId, off] = readU8(buf, off);
  return { targetType: targetType as DamageTargetType, targetId, damage, sourceId };
}

// ── Revive (Client → Server / Server → Client) ──
// [MsgType(1), targetPlayerId(1)] = 2
export function encodeRevive(targetId: number): Uint8Array {
  const arr = new Uint8Array(2);
  arr[0] = MsgType.Revive;
  arr[1] = targetId;
  return arr;
}
export function decodeRevive(data: Uint8Array): number {
  return data[1];
}

// ── GameOver (Server → Client) ──
// [MsgType(1), won(1)] = 2
export function encodeGameOver(won: boolean): Uint8Array {
  const arr = new Uint8Array(2);
  arr[0] = MsgType.GameOver;
  arr[1] = won ? 1 : 0;
  return arr;
}
export function decodeGameOver(data: Uint8Array): boolean {
  return data[1] === 1;
}
