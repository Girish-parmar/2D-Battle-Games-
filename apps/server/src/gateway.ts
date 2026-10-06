import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { C_EMOTE, C_INPUT, C_PING, WS_MSG_PER_S, bracketForLevel, decodeInput, fitLoadout, type ClientJson, type ServerJson } from '@war/shared';
import { RateLimiter } from './auth.js';
import type { Matchmaker } from './matchmaker.js';
import type { Link, Room, Unit } from './room.js';
import type { Store } from './store.js';

export interface GatewayOpts {
  allowedOrigins: string[];
  log: (m: string) => void;
}

function originAllowed(origin: string | undefined, host: string | undefined, allowed: string[]): boolean {
  if (!origin) return true; // headless bots and tools do not send an Origin header
  try {
    const u = new URL(origin);
    if (host && u.host === host) return true;
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    return allowed.includes(u.origin);
  } catch { return false; }
}

class WsLink implements Link {
  rtt = 0;
  constructor(private ws: WebSocket) {}
  send(data: Uint8Array | string) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    if (this.ws.bufferedAmount > 512 * 1024) { this.ws.close(1013, 'too slow'); return; }
    this.ws.send(data, { binary: typeof data !== 'string' });
  }
  close(reason?: string) { try { this.ws.close(1000, reason?.slice(0, 100)); } catch { /* already closed */ } }
}

export function attachGateway(server: HttpServer, mm: Matchmaker, store: Store, opts: GatewayOpts) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  const connLimit = new RateLimiter();

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/ws') { socket.destroy(); return; }
    const ip = (req.socket.remoteAddress ?? 'x');
    if (!originAllowed(req.headers.origin, req.headers.host, opts.allowedOrigins)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    if (!connLimit.allow('ws:' + ip, 600, 60_000)) { socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws));
  });

  function onConnection(ws: WebSocket) {
    const link = new WsLink(ws);
    let room: Room | null = null;
    let unit: Unit | null = null;
    let window = 0;
    let windowStart = Date.now();
    const sendJson = (m: ServerJson) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

    const helloTimer = setTimeout(() => { if (!unit) ws.close(1008, 'hello timeout'); }, 5000);
    let pingAt = 0;
    const pinger = setInterval(() => { if (ws.readyState === WebSocket.OPEN) { pingAt = Date.now(); ws.ping(); } }, 2000);
    ws.on('pong', () => {
      link.rtt = Date.now() - pingAt;
      if (unit) unit.rtt = link.rtt;
    });

    ws.on('message', (data, isBinary) => {
      const now = Date.now();
      if (now - windowStart >= 1000) { window = 0; windowStart = now; }
      if (++window > WS_MSG_PER_S) { ws.close(1008, 'rate limit'); return; }

      if (!isBinary) {
        let msg: ClientJson;
        try { msg = JSON.parse(data.toString()); } catch { return; }
        if (msg.t === 'hello' && !unit) {
          const ticket = typeof msg.ticket === 'string' ? mm.consumeRoomTicket(msg.ticket) : null;
          if (!ticket) { sendJson({ t: 'error', message: 'invalid or expired ticket' }); ws.close(1008, 'bad ticket'); return; }
          const prof = store.profile(ticket.accountId);
          if (!prof || store.isBanned(ticket.accountId)) { sendJson({ t: 'error', message: 'account unavailable' }); ws.close(1008, 'banned'); return; }
          const r = ticket.room;
          const returning = r.findOwned(ticket.accountId);
          if (!returning && !r.canJoin()) { sendJson({ t: 'error', message: 'that room is closed to new players' }); ws.close(1008, 'room closed'); return; }
          if (returning?.link) returning.link.close('opened elsewhere');
          const lo = prof.presets[prof.activePreset] ?? {};
          const fit = fitLoadout(prof.level, r.bracket, lo, prof.inventory);
          const joined = r.join({ accountId: prof.accountId, name: prof.displayName, level: prof.level, cr: prof.cr, fit, link });
          if (!joined) { sendJson({ t: 'error', message: 'room is full' }); ws.close(1008, 'full'); return; }
          room = r; unit = joined; unit.rtt = link.rtt;
          store.touch(prof.accountId);
          clearTimeout(helloTimer);
        } else if (msg.t === 'leave' && room && unit) {
          room.leave(unit);
          ws.close(1000, 'left');
        }
        return;
      }
      if (!room || !unit) return;
      const buf = new Uint8Array(data as Buffer);
      switch (buf[0]) {
        case C_INPUT: if (buf.length === 10) room.receiveInput(unit, decodeInput(buf)); break;
        case C_PING: if (buf.length === 5) room.receivePing(unit, new DataView(buf.buffer, buf.byteOffset).getUint32(1, true)); break;
        case C_EMOTE: if (buf.length === 2) room.receiveEmote(unit, buf[1]); break;
        default:
      }
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      clearInterval(pinger);
      if (room && unit && unit.link === link) room.disconnect(unit);
    });
    ws.on('error', () => { /* the close handler runs next */ });
  }

  void bracketForLevel;
  return { wss };
}
