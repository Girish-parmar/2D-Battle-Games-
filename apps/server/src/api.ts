import { existsSync } from 'node:fs';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { BRACKETS, SLOTS, type LoadoutIds } from '@war/shared';
import { RateLimiter, sign, verify } from './auth.js';
import { NAME_CHANGE_COST, buyOrUpgrade, catalogFor, changeName, profileView, salvage, saveLoadout } from './economy.js';
import type { Matchmaker } from './matchmaker.js';
import type { Store } from './store.js';

/** New guest accounts one IP may create per hour. Raise it only for load tests from a single machine. */
const GUEST_PER_IP_HOUR = Number(process.env.GUEST_PER_IP_HOUR ?? 20);

export interface ApiConfig {
  secret: string;
  dev: boolean;
  leaderboardOpen: boolean;
  staticDir?: string;
  publicUrl: string;
  log: (m: string) => void;
}

const loadoutSchema = z.object(Object.fromEntries(SLOTS.map((s) => [s, z.string().max(40).optional()]))).strict();

export async function buildApi(store: Store, mm: Matchmaker, cfg: ApiConfig) {
  const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 16 * 1024 });
  const limiter = new RateLimiter();
  const ACCESS_TTL = 15 * 60;

  const tokens = (accountId: string) => ({
    access: sign({ typ: 'access', sub: accountId }, cfg.secret, ACCESS_TTL),
    refresh: store.issueRefresh(accountId)
  });
  const accountOf = (req: FastifyRequest): string | null => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return null;
    const p = verify<{ typ: string; sub: string }>(h.slice(7), cfg.secret);
    return p && p.typ === 'access' ? p.sub : null;
  };
  const need = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const id = accountOf(req);
    if (!id || !store.account(id) || store.account(id)!.deletedAt) { reply.code(401).send({ error: 'sign in first' }); return null; }
    return id;
  };
  const body = <T extends z.ZodTypeAny>(schema: T, req: FastifyRequest, reply: FastifyReply): z.infer<T> | null => {
    const r = schema.safeParse(req.body ?? {});
    if (!r.success) { reply.code(400).send({ error: r.error.issues[0]?.message ?? 'bad request' }); return null; }
    return r.data;
  };

  // ---- rate limits (Section 14) --------------------------------------------------------
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const acc = accountOf(req);
    const ok = acc ? limiter.allow('u:' + acc, 600, 60_000) : limiter.allow('ip:' + req.ip, 60, 60_000);
    if (!ok) return reply.code(429).send({ error: 'slow down' });
  });
  app.addHook('onSend', async (_req, reply) => { reply.header('cache-control', 'no-store'); });

  // ---- auth -------------------------------------------------------------------------------
  app.post('/api/auth/guest', async (req, reply) => {
    if (!limiter.allow('guest:' + req.ip, GUEST_PER_IP_HOUR, 3_600_000)) return reply.code(429).send({ error: 'too many new guests from this network' });
    const b = body(z.object({ name: z.string().max(16).optional() }), req, reply);
    if (!b) return;
    const { account, profile } = store.createAccount('guest', { name: b.name });
    return { ...tokens(account.id), profile: profileView(profile, account.kind) };
  });

  app.post('/api/auth/email/request', async (req, reply) => {
    const b = body(z.object({ email: z.string().email().max(120), birthYear: z.number().int().min(1900).max(2100) }), req, reply);
    if (!b) return;
    const age = new Date().getUTCFullYear() - b.birthYear;
    if (age < 13) return reply.code(403).send({ error: 'You must be 13 or older to create an account.' });
    if (!limiter.allow('mail:' + b.email.toLowerCase(), 5, 3_600_000) || !limiter.allow('mailip:' + req.ip, 20, 3_600_000)) return reply.code(429).send({ error: 'too many login emails, try again later' });
    const token = store.issueMagic(b.email, b.birthYear);
    const link = `${cfg.publicUrl}/?magic=${token}`;
    cfg.log(`[email] login link for ${b.email}: ${link}`);
    // Real delivery needs an email provider. In development the link is returned so the flow can be tested.
    return { sent: true, ...(cfg.dev ? { devLink: link, devToken: token } : {}) };
  });

  app.post('/api/auth/email/verify', async (req, reply) => {
    const b = body(z.object({ token: z.string().max(100), guestAccess: z.string().max(600).optional() }), req, reply);
    if (!b) return;
    const m = store.consumeMagic(b.token);
    if (!m) return reply.code(400).send({ error: 'that link is invalid or has expired' });
    let acc = store.findByEmail(m.email);
    if (!acc) {
      const gid = b.guestAccess ? verify<{ typ: string; sub: string }>(b.guestAccess, cfg.secret) : null;
      const guest = gid && gid.typ === 'access' ? store.account(gid.sub) : undefined;
      if (guest && guest.kind === 'guest') { // claim: the guest's progress becomes the email account
        guest.kind = 'email'; guest.email = m.email; guest.birthYear = m.birthYear;
        acc = guest; store.save();
      } else acc = store.createAccount('email', { email: m.email, birthYear: m.birthYear, name: m.email.split('@')[0] }).account;
    }
    return { ...tokens(acc.id), profile: profileView(store.profile(acc.id)!, acc.kind) };
  });

  app.post('/api/auth/refresh', async (req, reply) => {
    const b = body(z.object({ refresh: z.string().max(100) }), req, reply);
    if (!b) return;
    const id = store.consumeRefresh(b.refresh);
    if (!id || !store.account(id) || store.account(id)!.deletedAt) return reply.code(401).send({ error: 'session expired' });
    return tokens(id);
  });

  // ---- profile -----------------------------------------------------------------------------
  app.get('/api/me', async (req, reply) => {
    const id = need(req, reply); if (!id) return;
    store.touch(id);
    return profileView(store.profile(id)!, store.account(id)!.kind);
  });
  app.put('/api/me/name', async (req, reply) => {
    const id = need(req, reply); if (!id) return;
    const b = body(z.object({ name: z.string().min(3).max(16) }), req, reply); if (!b) return;
    const err = changeName(store, store.profile(id)!, b.name.trim());
    if (err) return reply.code(400).send({ error: err });
    return profileView(store.profile(id)!, store.account(id)!.kind);
  });
  app.delete('/api/me', async (req, reply) => {
    const id = need(req, reply); if (!id) return;
    store.deleteAccount(id);
    return { deleted: true };
  });
  app.get('/api/me/export', async (req, reply) => {
    const id = need(req, reply); if (!id) return;
    return { account: store.account(id), profile: store.profile(id), ledger: store.ledgerFor(id, 500), matches: store.matchesOf(id, 500) };
  });
  app.get('/api/matches', async (req, reply) => {
    const id = need(req, reply); if (!id) return;
    return { matches: store.matchesOf(id, 20) };
  });

  // ---- shop and loadout ----------------------------------------------------------------------
  app.get('/api/shop', async (req, reply) => {
    const id = need(req, reply); if (!id) return;
    return { ...catalogFor(store.profile(id)!), nameChangeCost: NAME_CHANGE_COST, profile: profileView(store.profile(id)!, store.account(id)!.kind) };
  });
  app.post('/api/shop/buy', async (req, reply) => {
    const id = need(req, reply); if (!id) return;
    const b = body(z.object({ item: z.string().max(40) }), req, reply); if (!b) return;
    const r = buyOrUpgrade(store, store.profile(id)!, b.item);
    if (!r.ok) return reply.code(400).send({ error: r.error });
    return { ...catalogFor(r.profile), profile: profileView(r.profile, store.account(id)!.kind) };
  });
  app.post('/api/shop/salvage', async (req, reply) => {
    const id = need(req, reply); if (!id) return;
    const b = body(z.object({ item: z.string().max(40) }), req, reply); if (!b) return;
    const r = salvage(store, store.profile(id)!, b.item);
    if (!r.ok) return reply.code(400).send({ error: r.error });
    return { ...catalogFor(r.profile), profile: profileView(r.profile, store.account(id)!.kind) };
  });
  app.put('/api/loadout', async (req, reply) => {
    const id = need(req, reply); if (!id) return;
    const b = body(z.object({ preset: z.number().int().min(0).max(2), loadout: loadoutSchema }), req, reply); if (!b) return;
    const p = store.profile(id)!;
    const r = saveLoadout(store, p, b.preset, b.loadout as LoadoutIds);
    if (!r.ok) return reply.code(400).send({ error: r.errors.join('; '), errors: r.errors });
    return profileView(p, store.account(id)!.kind);
  });
  app.post('/api/loadout/active', async (req, reply) => {
    const id = need(req, reply); if (!id) return;
    const b = body(z.object({ preset: z.number().int().min(0).max(2) }), req, reply); if (!b) return;
    const p = store.profile(id)!;
    if (b.preset >= profileView(p, '').presetsUnlocked) return reply.code(400).send({ error: 'that preset is still locked' });
    p.activePreset = b.preset;
    store.save();
    return profileView(p, store.account(id)!.kind);
  });

  // ---- queue -----------------------------------------------------------------------------------
  app.post('/api/queue/join', async (req, reply) => {
    const id = need(req, reply); if (!id) return;
    if (!limiter.allow('qj:' + id, 6, 60_000)) return reply.code(429).send({ error: 'slow down' });
    const t = mm.join(id);
    if ('error' in t) return reply.code(403).send({ error: t.error });
    return { ticket: t.id };
  });
  app.get('/api/queue/status', async (req, reply) => {
    const id = need(req, reply); if (!id) return;
    const q = z.object({ ticket: z.string().max(60) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'ticket required' });
    return mm.status(q.data.ticket, id);
  });
  app.post('/api/queue/cancel', async (req, reply) => {
    const id = need(req, reply); if (!id) return;
    const b = body(z.object({ ticket: z.string().max(60) }), req, reply); if (!b) return;
    mm.cancel(b.ticket, id);
    return { ok: true };
  });
  app.post('/api/queue/accept-down', async (req, reply) => {
    const id = need(req, reply); if (!id) return;
    const b = body(z.object({ ticket: z.string().max(60) }), req, reply); if (!b) return;
    return { ok: mm.acceptDown(b.ticket, id) };
  });

  // ---- leaderboards and reports ----------------------------------------------------------------
  app.get('/api/leaderboard', async (req, reply) => {
    const q = z.object({ bracket: z.coerce.number().int().min(1).max(5), period: z.enum(['daily', 'weekly', 'all']) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'bracket 1-5 and period daily, weekly or all' });
    const me = accountOf(req);
    const board = store.leaderboard(q.data.bracket, q.data.period, me, cfg.leaderboardOpen);
    const acc = me ? store.account(me) : undefined;
    const note = acc?.kind === 'guest' && !cfg.leaderboardOpen ? 'Sign in with email to appear on the boards. Boards need 5 matches in the period (30 for all-time).' : undefined;
    return { ...board, brackets: BRACKETS.map((b) => ({ id: b.id, name: b.name })), note };
  });
  app.post('/api/report', async (req, reply) => {
    const id = need(req, reply); if (!id) return;
    const b = body(z.object({ matchId: z.string().max(60), targetName: z.string().max(16), reason: z.enum(['cheating', 'boosting', 'name', 'other']) }), req, reply); if (!b) return;
    if (store.reportsToday(id) >= 5) return reply.code(429).send({ error: 'you can send 5 reports a day' });
    const t = store.allMatchPlayers().find((r) => r.matchId === b.matchId && r.accountId && store.profile(r.accountId)?.displayName === b.targetName);
    if (!t?.accountId) return reply.code(404).send({ error: 'player not found in that match' });
    store.addReport({ reporterId: id, targetId: t.accountId, matchId: b.matchId, reason: b.reason });
    if (store.openReportsAgainst(t.accountId) >= 3 && b.reason === 'name') {
      const tp = store.profile(t.accountId)!;
      tp.displayName = 'Player' + t.accountId.slice(0, 4); // hidden until a person reviews it
      store.save();
    }
    return { ok: true };
  });

  app.get('/api/health', async () => ({ ok: true, ...mm.stats(), matches: store.matchCount() }));
  app.get('/api/brackets', async () => BRACKETS);

  // ---- static client ------------------------------------------------------------------------------
  if (cfg.staticDir && existsSync(cfg.staticDir)) {
    await app.register(fastifyStatic, { root: cfg.staticDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not found' }));
  }
  return app;
}
