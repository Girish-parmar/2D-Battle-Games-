import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { BTN_FIRE, S_SNAPSHOT, decodeSnapshot, encodeInput, type ResultsMsg, type ServerJson, type Snapshot, type WelcomeMsg } from '@war/shared';
import { buildApi } from '../src/api.js';
import { attachGateway } from '../src/gateway.js';
import { Matchmaker } from '../src/matchmaker.js';
import { Store } from '../src/store.js';

const SECRET = 'test-secret';
let base = '';
let store: Store;
let mm: Matchmaker;
let app: Awaited<ReturnType<typeof buildApi>>;
let timers: NodeJS.Timeout[] = [];

beforeAll(async () => {
  store = new Store(null);
  mm = new Matchmaker(store, SECRET, 40); // 40x faster phases so a whole match fits in seconds
  app = await buildApi(store, mm, { secret: SECRET, dev: true, leaderboardOpen: true, publicUrl: 'http://x', log: () => {} });
  attachGateway(app.server, mm, store, { allowedOrigins: [], log: () => {} });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  timers.push(setInterval(() => mm.stepRooms(() => {}), 50));
  timers.push(setInterval(() => mm.tick(), 100));
});
afterAll(async () => {
  timers.forEach(clearInterval);
  for (const r of mm.rooms.values()) r.forceClose();
  await app.close();
});

async function api(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: 'Bearer ' + opts.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function newGuest(name?: string) {
  const r = await api('/api/auth/guest', { body: { name } });
  expect(r.status).toBe(200);
  return { token: r.json.access as string, refresh: r.json.refresh as string, id: r.json.profile.id as string };
}

async function enterRoom(token: string) {
  const j = await api('/api/queue/join', { token, body: {} });
  expect(j.status).toBe(200);
  let ready: any = null;
  for (let i = 0; i < 100 && !ready; i++) {
    const s = await api('/api/queue/status?ticket=' + j.json.ticket, { token });
    if (s.json.state === 'ready') ready = s.json;
    else await new Promise((r) => setTimeout(r, 100));
  }
  expect(ready).not.toBeNull();
  return ready as { roomId: string; roomTicket: string; bracket: number };
}

function connect(ticket: string) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  const json: ServerJson[] = [];
  const snaps: Snapshot[] = [];
  ws.on('message', (d, bin) => {
    if (!bin) json.push(JSON.parse(d.toString()));
    else { const b = new Uint8Array(d as Buffer); if (b[0] === S_SNAPSHOT) snaps.push(decodeSnapshot(b)); }
  });
  const open = new Promise<void>((res) => ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', ticket, version: 1 })); res(); }));
  return { ws, json, snaps, open };
}

describe('REST', () => {
  it('guest account, shop, loadout and salvage follow the design numbers', async () => {
    const g = await newGuest('Shopper');
    const me = await api('/api/me', { token: g.token });
    expect(me.json.level).toBe(1);
    expect(me.json.budget).toBe(20);
    expect(me.json.slots).toEqual(['weapon', 'hull', 'engine']);
    // no credits yet
    expect((await api('/api/shop/buy', { token: g.token, body: { item: 'hardened_rounds' } })).status).toBe(400);
    store.profile(g.id)!.credits = 1000;
    const buy = await api('/api/shop/buy', { token: g.token, body: { item: 'hardened_rounds' } });
    expect(buy.status).toBe(200);
    expect(buy.json.profile.credits).toBe(850);
    expect(buy.json.items.find((i: any) => i.id === 'hardened_rounds').owned).toBe(1);
    // Mk II is locked below level 3
    const locked = await api('/api/shop/buy', { token: g.token, body: { item: 'hardened_rounds' } });
    expect(locked.status).toBe(400);
    expect(locked.json.error).toMatch(/unlocks at level 3/);
    // loadout validation
    expect((await api('/api/loadout', { token: g.token, method: 'PUT', body: { preset: 0, loadout: { weapon: 'rapid_loader' } } })).status).toBe(400);
    expect((await api('/api/loadout', { token: g.token, method: 'PUT', body: { preset: 0, loadout: { hull: 'hardened_rounds' } } })).status).toBe(400);
    const ok = await api('/api/loadout', { token: g.token, method: 'PUT', body: { preset: 0, loadout: { weapon: 'hardened_rounds' } } });
    expect(ok.status).toBe(200);
    expect(ok.json.ppUsed).toBe(2);
    expect((await api('/api/loadout', { token: g.token, method: 'PUT', body: { preset: 1, loadout: {} } })).status).toBe(400);
    // salvage refunds 70% of the Mk I price (150)
    const before = store.profile(g.id)!.credits;
    const s = await api('/api/shop/salvage', { token: g.token, body: { item: 'hardened_rounds' } });
    expect(s.status).toBe(200);
    expect(s.json.profile.credits).toBe(before + 105);
    expect(s.json.profile.presets[0]).toEqual({}); // the salvaged item leaves every preset
  });

  it('refuses under-13 signups and rotates refresh tokens', async () => {
    const young = await api('/api/auth/email/request', { body: { email: 'kid@example.com', birthYear: new Date().getUTCFullYear() - 10 } });
    expect(young.status).toBe(403);
    const g = await newGuest();
    const r1 = await api('/api/auth/refresh', { body: { refresh: g.refresh } });
    expect(r1.status).toBe(200);
    expect((await api('/api/auth/refresh', { body: { refresh: g.refresh } })).status).toBe(401); // used once
    expect((await api('/api/auth/refresh', { body: { refresh: r1.json.refresh } })).status).toBe(200);
  });

  it('a guest can claim their progress with an email login link', async () => {
    const g = await newGuest('Claimer');
    store.profile(g.id)!.credits = 321;
    const req = await api('/api/auth/email/request', { token: g.token, body: { email: 'claim@example.com', birthYear: 1990 } });
    expect(req.status).toBe(200);
    const ver = await api('/api/auth/email/verify', { body: { token: req.json.devToken, guestAccess: g.token } });
    expect(ver.status).toBe(200);
    expect(ver.json.profile.id).toBe(g.id);
    expect(ver.json.profile.kind).toBe('email');
    expect(ver.json.profile.credits).toBe(321);
    expect((await api('/api/auth/email/verify', { body: { token: req.json.devToken } })).status).toBe(400); // single use
  });

  it('rejects calls without a token and forged tokens', async () => {
    expect((await api('/api/me')).status).toBe(401);
    expect((await api('/api/me', { token: 'abc.def' })).status).toBe(401);
  });

  it('leaderboard endpoint validates input', async () => {
    expect((await api('/api/leaderboard?bracket=9&period=daily')).status).toBe(400);
    const r = await api('/api/leaderboard?bracket=1&period=weekly');
    expect(r.status).toBe(200);
    expect(r.json.top).toEqual([]);
  });
});

describe('a full match over a real WebSocket', () => {
  it('connects, plays, gets results and rewards, and can reconnect', async () => {
    const g = await newGuest('Runner');
    const ready = await enterRoom(g.token);
    expect(ready.bracket).toBe(1);
    const c = connect(ready.roomTicket);
    await c.open;
    for (let i = 0; i < 100 && !c.json.some((m) => m.t === 'welcome'); i++) await new Promise((r) => setTimeout(r, 50));
    const welcome = c.json.find((m) => m.t === 'welcome') as WelcomeMsg;
    expect(welcome).toBeTruthy();
    expect(welcome.bracket).toBe(1);

    // a ticket cannot be used twice
    const dup = connect(ready.roomTicket);
    await dup.open;
    await new Promise((r) => setTimeout(r, 300));
    expect(dup.json.some((m) => m.t === 'error')).toBe(true);

    let seq = 0;
    const t0 = Date.now();
    let reconnected = false;
    let cur = c;
    const sender = setInterval(() => {
      const i = ++seq;
      if (cur.ws.readyState === WebSocket.OPEN) cur.ws.send(encodeInput({ seq: i & 0xffff, mx: Math.round(Math.cos(i / 12) * 127), my: Math.round(Math.sin(i / 16) * 127), aim: i / 10, buttons: BTN_FIRE, ack: 0 }));
    }, 50);
    // drop the connection mid-match and come back through the queue
    await new Promise((r) => setTimeout(r, 2500));
    c.ws.close();
    await new Promise((r) => setTimeout(r, 300));
    const again = await enterRoom(g.token);
    expect(again.roomId).toBe(ready.roomId);
    cur = connect(again.roomTicket);
    await cur.open;
    reconnected = true;
    for (let i = 0; i < 400 && !cur.json.some((m) => m.t === 'results'); i++) await new Promise((r) => setTimeout(r, 100));
    clearInterval(sender);
    expect(reconnected).toBe(true);
    const results = cur.json.find((m) => m.t === 'results') as ResultsMsg;
    expect(results, `no results after ${Date.now() - t0} ms`).toBeTruthy();
    expect(results.rows.length).toBeGreaterThanOrEqual(12);
    expect(results.rows.some((r) => r.name === 'Runner')).toBe(true);
    expect(results.mine).toBeTruthy();
    expect(results.mine!.xp).toBeGreaterThan(0);
    // one human in the room, so the match part is halved; the 100 first-match-of-day bonus is not
    expect(results.mine!.credits).toBeGreaterThanOrEqual(110);
    expect(results.mine!.credits).toBeLessThan(260);
    expect(results.mine!.rp).toBe(0); // one human: unrated
    expect(cur.snaps.length).toBeGreaterThan(20);
    expect(cur.snaps.every((s) => Number.isFinite(s.own.x))).toBe(true);
    cur.ws.close();

    const me = await api('/api/me', { token: g.token });
    expect(me.json.xp).toBe(results.mine!.xp);
    expect(me.json.credits).toBe(results.mine!.credits);
    expect(me.json.totalMatches).toBe(1);
    expect(store.matchCount()).toBeGreaterThanOrEqual(1);
    // paying twice is impossible
    const ledger = store.ledgerFor(g.id);
    expect(ledger.filter((l) => l.kind === 'credits' && l.reason === 'match').length).toBe(1);
  }, 60000);
});
