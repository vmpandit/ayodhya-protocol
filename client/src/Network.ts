// ── Ayodhya Protocol: Lanka Reforged ── WebSocket Client ──

import {
  MsgType, GameSnapshot, PlayerInput, ProjectileState, Vec3, AbilityType,
} from '@shared/types';
import {
  encodeInput, encodeAbility, encodeJoin, encodeRevive,
  decodeSnapshot, decodePlayerJoined, decodePlayerLeft,
  decodeProjectileSpawn, decodeDamage, decodeGameOver,
  DamageTargetType,
} from '@shared/protocol';

export class Network {
  private ws: WebSocket | null = null;
  private serverUrl: string;

  public onPlayerJoined: (id: number) => void = () => {};
  public onPlayerLeft: (id: number) => void = () => {};
  public onSnapshot: (snap: GameSnapshot) => void = () => {};
  public onProjectileSpawn: (proj: ProjectileState) => void = () => {};
  public onDamage: (targetType: DamageTargetType, targetId: number, damage: number, sourceId: number) => void = () => {};
  public onGameOver: (won: boolean) => void = () => {};

  constructor() {
    const host = window.location.hostname || 'localhost';
    this.serverUrl = `ws://${host}:9001`;
  }

  connect(): void {
    this.ws = new WebSocket(this.serverUrl);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      console.log('[Network] Connected');
      this.ws!.send(encodeJoin());
    };

    this.ws.onmessage = (event: MessageEvent) => {
      const data = new Uint8Array(event.data as ArrayBuffer);
      if (data.length === 0) return;
      this.handleMessage(data);
    };

    this.ws.onclose = () => {
      console.log('[Network] Disconnected');
      setTimeout(() => this.connect(), 2000);
    };

    this.ws.onerror = (err) => {
      console.error('[Network] Error:', err);
    };
  }

  private handleMessage(data: Uint8Array): void {
    const type: MsgType = data[0];

    switch (type) {
      case MsgType.PlayerJoined:
        this.onPlayerJoined(decodePlayerJoined(data));
        break;
      case MsgType.PlayerLeft:
        this.onPlayerLeft(decodePlayerLeft(data));
        break;
      case MsgType.Snapshot:
        this.onSnapshot(decodeSnapshot(data));
        break;
      case MsgType.ProjectileSpawn:
        this.onProjectileSpawn(decodeProjectileSpawn(data));
        break;
      case MsgType.Damage: {
        const d = decodeDamage(data);
        this.onDamage(d.targetType, d.targetId, d.damage, d.sourceId);
        break;
      }
      case MsgType.GameOver:
        this.onGameOver(decodeGameOver(data));
        break;
    }
  }

  sendInput(input: PlayerInput): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeInput(input));
    }
  }

  sendAbility(type: AbilityType, dir: Vec3): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeAbility(type, dir));
    }
  }

  sendRevive(targetId: number): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeRevive(targetId));
    }
  }
}
