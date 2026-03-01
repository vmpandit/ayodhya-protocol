// ── Ayodhya Protocol: Lanka Reforged ── Server Entry ──

import { WebSocketServer, WebSocket } from 'ws';
import RAPIER from '@dimforge/rapier3d-compat';
import { GameServer } from './GameServer.js';

const PORT = parseInt(process.env.PORT || '9001', 10);

async function main(): Promise<void> {
  await RAPIER.init();
  console.log('[Server] Rapier physics initialized');

  const wss = new WebSocketServer({ port: PORT });
  const game = new GameServer(RAPIER);

  wss.on('connection', (ws: WebSocket) => {
    game.onConnect(ws);

    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      let data: Uint8Array;
      if (raw instanceof ArrayBuffer) {
        data = new Uint8Array(raw);
      } else if (Buffer.isBuffer(raw)) {
        data = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
      } else {
        const buf = Buffer.concat(raw as Buffer[]);
        data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      }
      game.onMessage(ws, data);
    });

    ws.on('close', () => {
      game.onDisconnect(ws);
    });

    ws.on('error', (err: Error) => {
      console.error('[Server] WS error:', err.message);
    });
  });

  game.start();
  console.log(`[Server] Listening on ws://localhost:${PORT}`);
}

main().catch(console.error);
