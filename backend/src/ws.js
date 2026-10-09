import { WebSocketServer } from 'ws';
import { tokenFromRequest, verifyAuthToken } from './security.js';

let wss;
let heartbeatTimer;

export function attachWs(server) {
  wss = new WebSocketServer({ noServer: true, clientTracking: true });

  server.on('upgrade', (req, socket, head) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/ws') return socket.destroy();
      const user = verifyAuthToken(tokenFromRequest(req));
      if (!user) return socket.destroy();
      wss.handleUpgrade(req, socket, head, ws => {
        ws.user = user;
        ws.isAlive = true;
        wss.emit('connection', ws, req);
      });
    } catch { socket.destroy(); }
  });

  wss.on('connection', ws => {
    ws.on('pong', () => { ws.isAlive = true; });
    ws.send(JSON.stringify({ type:'hello', at:new Date().toISOString() }));
  });

  heartbeatTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);
  heartbeatTimer.unref();
}

export function broadcastEvents(events) {
  if (!wss || !events.length) return;
  const payload = JSON.stringify({ type:'events', events });
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.bufferedAmount < 2_000_000) client.send(payload);
  }
}

export function closeWs() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (!wss) return;
  for (const client of wss.clients) client.close(1001, 'Server shutting down');
  wss.close();
}
