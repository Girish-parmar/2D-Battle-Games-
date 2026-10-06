import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TICK_MS } from '@war/shared';
import { buildApi } from './api.js';
import { attachGateway } from './gateway.js';
import { Matchmaker } from './matchmaker.js';
import { Store } from './store.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const env = process.env;
const PORT = Number(env.PORT ?? 8080);
const HOST = env.HOST ?? '0.0.0.0';
const DEV = env.NODE_ENV !== 'production';
const DATA_FILE = env.DATA_FILE ?? resolve(root, 'data/db.json');
const TIME_SCALE = Number(env.TIME_SCALE ?? 1);
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

function loadSecret(): string {
  if (env.SECRET) return env.SECRET;
  const f = resolve(dirname(DATA_FILE), 'secret.key');
  if (existsSync(f)) return readFileSync(f, 'utf8').trim();
  const s = randomBytes(32).toString('hex');
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, s, { mode: 0o600 });
  log(`generated a signing secret at ${f}; set SECRET in production`);
  return s;
}

const store = new Store(DATA_FILE === ':memory:' ? null : DATA_FILE);
const secret = loadSecret();
const mm = new Matchmaker(store, secret, TIME_SCALE);
const staticDir = env.STATIC_DIR ?? resolve(root, 'apps/web/dist');
const app = await buildApi(store, mm, {
  secret, dev: DEV, leaderboardOpen: env.LEADERBOARD_OPEN === '1', staticDir,
  publicUrl: env.PUBLIC_URL ?? `http://localhost:${DEV ? 5173 : PORT}`, log
});
attachGateway(app.server, mm, store, { allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean), log });
await app.listen({ port: PORT, host: HOST });
log(`2D War Arena server on http://${HOST}:${PORT}  (time scale ${TIME_SCALE}, ${DEV ? 'development' : 'production'}, data ${DATA_FILE})`);
if (!existsSync(staticDir)) log('no built client found; run "pnpm build" or use "pnpm dev:web" on port 5173');

// ---- the game loop: 20 Hz, drift corrected --------------------------------------------------
let next = performance.now() + TICK_MS;
let ticks = 0;
function loop() {
  const t0 = performance.now();
  mm.stepRooms(log);
  ticks++;
  if (ticks % 20 === 0) mm.tick();
  const lag = performance.now() - next;
  next += TICK_MS;
  if (lag > TICK_MS * 5) next = performance.now() + TICK_MS; // fell far behind: do not spiral
  setTimeout(loop, Math.max(0, next - performance.now()));
  void t0;
}
loop();

setInterval(() => {
  const s = mm.stats();
  if (s.rooms || s.queued) log(`rooms ${s.rooms} humans ${s.players} bots ${s.bots} queued ${s.queued} tick ${s.tickMsEma}ms (max ${s.tickMsMax}ms)`);
}, 30_000).unref();

function shutdown() {
  log('shutting down');
  for (const r of mm.rooms.values()) r.forceClose('server restarting');
  store.flush();
  app.close().finally(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
