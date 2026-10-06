// Network load test with real clients (Section 15): N headless players use the REST API, the queue and WebSocket.
//   BASE=http://localhost:8080 pnpm --filter @war/server exec tsx scripts/bots.ts [players=48] [seconds=60]
// Start the server first. A fast clock (TIME_SCALE=6) lets matches end during the test.
import { WebSocket } from 'ws';
import { BTN_FIRE, S_SNAPSHOT, decodeSnapshot, encodeInput } from '@war/shared';
import { percentile } from './fake.js';

const BASE = process.env.BASE ?? 'http://localhost:8080';
const PLAYERS = Number(process.argv[2] ?? 48);
const SECONDS = Number(process.argv[3] ?? 60);
const WS = BASE.replace('http', 'ws') + '/ws';

async function api(path: string, token?: string, body?: unknown) {
  const res = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { ok: res.ok, status: res.status, json: (await res.json()) as any };
}

const stats = { connected: 0, failed: 0, snapshots: 0, results: 0, connectedMs: 0, gaps: [] as number[], connectMs: [] as number[], seatMs: [] as number[] };
const stop = Date.now() + SECONDS * 1000;

async function player(i: number) {
  const g = await api('/api/auth/guest', undefined, { name: `Bot${i}` });
  if (!g.ok) { stats.failed++; return; }
  const token = g.json.access as string;
  while (Date.now() < stop) {
    const tQueue = Date.now();
    const q = await api('/api/queue/join', token, {});
    if (!q.ok) { await new Promise((r) => setTimeout(r, 1000)); continue; }
    let ticket: string | null = null;
    while (Date.now() < stop && !ticket) {
      const s = await api('/api/queue/status?ticket=' + q.json.ticket, token);
      if (s.json.state === 'ready') ticket = s.json.roomTicket; else await new Promise((r) => setTimeout(r, 500));
    }
    if (!ticket) return;
    stats.seatMs.push(Date.now() - tQueue);
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(WS);
      const tOpen = Date.now();
      let tWelcome = 0;
      let seq = 0, last = 0, timer: NodeJS.Timeout | undefined;
      ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', ticket, version: 1 })));
      ws.on('message', (d, bin) => {
        if (!bin) {
          const m = JSON.parse(d.toString());
          if (m.t === 'welcome') { stats.connected++; tWelcome = Date.now(); stats.connectMs.push(tWelcome - tOpen); }
          if (m.t === 'results') { stats.results++; ws.close(); }
          return;
        }
        const b = new Uint8Array(d as Buffer);
        if (b[0] === S_SNAPSHOT) {
          stats.snapshots++;
          const now = Date.now();
          if (last) stats.gaps.push(now - last);
          last = now;
          void decodeSnapshot;
        }
      });
      ws.on('open', () => {
        timer = setInterval(() => {
          seq = (seq % 65535) + 1;
          const a = Date.now() / 700 + i;
          if (ws.readyState === WebSocket.OPEN) ws.send(encodeInput({ seq, mx: Math.round(Math.cos(a) * 127), my: Math.round(Math.sin(a * 1.3) * 127), aim: a, buttons: BTN_FIRE, ack: 0 }));
        }, 50);
      });
      ws.on('close', () => { clearInterval(timer); if (tWelcome) stats.connectedMs += Date.now() - tWelcome; resolve(); });
      ws.on('error', () => { stats.failed++; });
      setTimeout(() => ws.close(), Math.max(1000, stop - Date.now()));
    });
  }
}

const started = Date.now();
await Promise.all(Array.from({ length: PLAYERS }, (_, i) => new Promise<void>((r) => setTimeout(r, (i * 2000) / PLAYERS)).then(() => player(i))));
const secs = (Date.now() - started) / 1000;
stats.gaps.sort((a, b) => a - b);
stats.connectMs.sort((a, b) => a - b);
stats.seatMs.sort((a, b) => a - b);
const health = await api('/api/health');
console.log(`${PLAYERS} players for ${secs.toFixed(0)} s`);
console.log(`connections ${stats.connected} (a player reconnects for each match), failed ${stats.failed}, matches completed ${stats.results}`);
console.log(`snapshots per connected player per second: ${(stats.snapshots / Math.max(1, stats.connectedMs / 1000)).toFixed(1)} (design 20)`);
console.log(`gap between snapshots: p50 ${percentile(stats.gaps, 50)} ms, p99 ${percentile(stats.gaps, 99)} ms`);
console.log(`socket open to welcome: p50 ${percentile(stats.connectMs, 50)} ms, p99 ${percentile(stats.connectMs, 99)} ms`);
console.log(`wait for a seat in the queue: p50 ${percentile(stats.seatMs, 50)} ms, p99 ${percentile(stats.seatMs, 99)} ms`);
console.log('server:', JSON.stringify(health.json));
process.exit(stats.failed ? 1 : 0);
