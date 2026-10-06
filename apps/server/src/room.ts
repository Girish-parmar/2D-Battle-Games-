import {
  ABORT_HUMANS_S, ASSIST_DAMAGE_FRACTION, ASSIST_WINDOW_S, AIM_TURN_RATE, BEACON_AFTER_S, BEACON_MIN_MS, BTN_FIRE, BTN_SCOPE,
  CAMERA_FRAMING, CRATE_HP, CRATE_POINTS, CRATE_RADIUS, CRATE_RESPAWN_S, DT, ENDING_S, END_CRATE, END_EXPLODE, END_RANGE, END_UNIT,
  END_WALL, EV_EMOTE, EV_HIT, EV_KILL, EV_PICKUP, EV_PROJ, EV_PROJEND, EV_TIER, FEED_MIN_DEATHS, FEED_SHARE_MAX, FORMING_MAX_S,
  GHOST_S, HISTORY_TICKS, IDLE_KICK_S, LAG_COMP_MAX_MS, LATE_JOIN_FRACTION, LATE_PROTECT_S, MAP_SIZE, MAX_UNITS, MERCY_HOLD_S,
  MERCY_RATIO, MIN_MATCH_S, MIN_PLAYED_S, MIN_START_UNITS, MINE_DAMAGE, MINE_INTERVAL_S, MORTAR_FUSE_RADIUS, OF_ALIVE, OF_BEACON,
  OF_PROTECTED, OF_SCOPING, OF_SHIELD, OVERTIME_RING_DPS, OVERTIME_RING_END, OVERTIME_RING_START, OVERTIME_S,
  OVERTIME_TRIGGER_GAP, PELLET_COUNT, PELLET_MIN_UNIT_DIST, PELLET_RADIUS, PELLET_RESPAWN_S, PICK_CRATE, PICK_PELLET, PICK_POWERUP,
  POWERUPS, POWERUP_KINDS, POWERUP_PICKUP_RADIUS, PROJECTILE_CAP, RECONNECT_S, REPEAT_KILL_WINDOW_S, RESULTS_S, ROOKIE_BOT_AIM_DEG,
  ROOKIE_BOT_REACT_MS, ROOKIE_BOT_SHARE, SPAWN_KILL_WINDOW_S, SPAWN_PADS, SPAWN_PAD_COOLDOWN_S, SPAWN_CLEARANCE, SPAWN_PROTECT_S,
  TARGET_UNITS, TICK_HZ, UF_BEACON, UF_PROTECTED, UF_SCOPING, UF_SHIELD, WARMUP_S, WEAPONS, assistBounty, computeStats, damageAfterArmor,
  deathGs, encodePong, encodeScoreboard, encodeSnapshot, generateWorld, killBounty, mulberry32, pelletValue, respawnSeconds,
  rotateToward, segCircle, segRect, stepPosition, tierFor, tierThreshold, type BracketDef, type EffectiveItem, type FitResult,
  type GameEvent, type InputMsg, type MyRewards, type Phase, type PowerupKind, type ResultRow, type ResultsMsg, type RosterEntry,
  type ScoreRow, type Snapshot, type StateMsg, type StatKey, type UnitStats, type WeaponDef, type World, type WelcomeMsg, type ServerJson
} from '@war/shared';
import { fitLoadout, type Inventory, type LoadoutIds } from '@war/shared';
import { BOT_NAMES, BotBrain, type Archetype, type BotUnit, type BotWorld } from './bots.js';

export const RULESET = 1;
export const FLAG_FEED = 1;
export const FLAG_IDLE = 2;

export interface Link {
  send(data: Uint8Array | string): void;
  close(reason?: string): void;
  rtt: number;
}

export interface JoinParams {
  accountId: string | null;
  name: string;
  level: number;
  cr: number;
  fit: FitResult;
  link?: Link;
  bot?: { archetype: Archetype; aimDeg: number; reactMs: number };
}

export interface ResultPlayer {
  slot: number; accountId: string | null; name: string; bot: boolean; rank: number; rankHuman: number | null;
  ms: number; kills: number; deaths: number; assists: number; maxTier: number; playedS: number; level: number; cr: number;
  loadout: EffectiveItem[]; flags: number; killsOn: Record<number, number>;
}
export interface MatchResult {
  matchId: string; roomId: string; bracket: number; startedAt: number; endedAt: number; durationS: number;
  endReason: string; humans: number; players: ResultPlayer[];
}
export interface RoomConfig {
  id: string;
  matchId: string;
  bracket: BracketDef;
  seed: number;
  timeScale?: number;
  onFinish?: (r: MatchResult) => Map<string, MyRewards>;
  /** Simulators run rooms of bots only, so they switch the empty-room abort off. */
  abortWhenEmpty?: boolean;
}

interface Projectile {
  id: number; owner: number; weapon: WeaponDef; x: number; y: number; vx: number; vy: number; dmg: number; range: number;
  travelled: number; radius: number; pierceLeft: number; hit: Set<number>; rewind: number; age: number; speed: number;
}
interface Crate { id: number; x: number; y: number; hp: number; alive: boolean; respawnAt: number; lastHitBy: number }
interface GroundPowerup { id: number; kind: PowerupKind; x: number; y: number; expiresAt: number }
interface QueuedEvent { ev: GameEvent; x: number; y: number }

export class Unit implements BotUnit {
  x = 0; y = 0; vx = 0; vy = 0; aim = 0;
  hp = 100; maxHp = 100; shield = 0; shieldUntil = 0;
  gs = 0; ms = 0; kills = 0; deaths = 0; assists = 0; maxTier = 1; reachedAt = 0;
  alive = false; respawnAt = 0; protectedUntil = 0; spawnedAt = -100; lateJoined = false;
  lastDamagedAt = -100; lastHitBy = -1; lastHitAt = -100; lastActiveAt = 0;
  cooldown = 0; scoping = false; fireHeld = false;
  powerup: { kind: PowerupKind; until: number } | null = null;
  stats!: UnitStats;
  radius = 16; tier = 1; look = 600; weapon: WeaponDef = WEAPONS[0]; rangeMult = 1; protectedNow = false;
  queue: InputMsg[] = []; last: InputMsg | null = null; heldTicks = 0; ack = 0; lastSeq = 0; processedSeq = 0;
  link?: Link; connected = false; disconnectedAt = -1; leftAt = -1; ghosted = false;
  joinedAt = 0; rtt = 0; lastEmoteAt = -10; nextMineAt = 0; flags = 0;
  dmgLog: { slot: number; t: number; dmg: number }[] = [];
  killTimes = new Map<number, number[]>();
  killsOn: Record<number, number> = {};
  deathsTotal = 0;
  view = { units: new Set<number>(), pellets: new Set<number>(), seq: 0 };
  hist = new Float32Array(HISTORY_TICKS * 2);
  brain?: BotBrain;
  probe?: Partial<Record<StatKey, number>>;
  color: number;

  constructor(
    public slot: number,
    public accountId: string | null,
    public name: string,
    public bot: boolean,
    public level: number,
    public cr: number,
    public items: EffectiveItem[],
    public dropped: FitResult['dropped']
  ) {
    this.color = slot % 8;
    this.stats = computeStats(0, items);
    this.sync();
  }
  get tierNow() { return this.tier; }
  sync() {
    this.radius = this.stats.radius;
    this.tier = this.stats.tier;
    this.look = this.stats.look;
    this.weapon = this.stats.weapon;
    this.rangeMult = this.stats.rangeMult;
  }
}

const ARCHETYPES: Record<Archetype, Partial<Record<string, string>>> = {
  anvil: { weapon: 'hardened_rounds', hull: 'reactive_armor', engine: 'phoenix_core', sensor: 'wide_radar', utility: 'field_repair' },
  wasp: { weapon: 'rapid_loader', hull: 'heavy_plating', engine: 'afterburner', sensor: 'wide_radar', utility: 'scavenger_magnet' },
  hawk: { weapon: 'long_barrel', hull: 'reactive_armor', engine: 'afterburner', sensor: 'tele_optics', utility: 'scavenger_magnet' }
};
export function archetypeLoadout(a: Archetype) { return ARCHETYPES[a]; }

export class Room {
  readonly id: string;
  readonly matchId: string;
  readonly bracket: BracketDef;
  readonly world: World;
  readonly units: (Unit | undefined)[] = new Array(MAX_UNITS).fill(undefined);
  readonly timeScale: number;
  phase: Phase = 'forming';
  tick = 0;
  closed = false;
  private rng: () => number;
  private cfg: RoomConfig;
  private startedAtMs = Date.now();
  private phaseEndTick = 0;
  private playStartTick = 0;
  private baseTicks = 0;
  private overtimeStartTick = 0;
  private mercySince = -1;
  private emptySince = -1;
  private endReason = 'timer';
  private projectiles: Projectile[] = [];
  private nextProjId = 1;
  private pelletX = new Float32Array(PELLET_COUNT);
  private pelletY = new Float32Array(PELLET_COUNT);
  private pelletAlive = new Uint8Array(PELLET_COUNT);
  private pelletRespawn = new Float64Array(PELLET_COUNT);
  private pelletGrid = new Map<number, Set<number>>();
  private crates: Crate[] = [];
  private ground = new Map<number, GroundPowerup>();
  private nextGroundId = 1;
  private events: QueuedEvent[] = [];
  private padUsed = new Float64Array(SPAWN_PADS).fill(-100);
  private botsToRemove = 0;
  private rankBySlot = new Map<number, number>();
  private ranked: Unit[] = [];
  private beaconSlot = -1;
  private resultsSent = false;
  private lastResult: MatchResult | null = null;
  private rewards = new Map<string, MyRewards>();
  tickMsEma = 0;
  tickMsMax = 0;

  constructor(cfg: RoomConfig) {
    this.cfg = cfg;
    this.id = cfg.id;
    this.matchId = cfg.matchId;
    this.bracket = cfg.bracket;
    this.timeScale = cfg.timeScale ?? 1;
    this.world = generateWorld(cfg.seed);
    this.rng = mulberry32(cfg.seed ^ 0x9e3779b9);
    this.baseTicks = this.ticksFor(cfg.bracket.baseLenS);
    this.phaseEndTick = this.ticksFor(FORMING_MAX_S);
    for (let i = 0; i < PELLET_COUNT; i++) this.spawnPellet(i, true);
    this.crates = this.world.crates.map((c, i) => ({ id: i, x: c.x, y: c.y, hp: CRATE_HP, alive: true, respawnAt: 0, lastHitBy: -1 }));
  }

  // ---- time helpers ----------------------------------------------------------
  get time() { return this.tick * DT; }
  private ticksFor(seconds: number) { return Math.max(1, Math.round((seconds * TICK_HZ) / this.timeScale)); }
  /** Elapsed match seconds in design (unscaled) units. */
  private matchElapsedS() { return Math.max(0, (this.tick - this.playStartTick) * DT * this.timeScale); }
  private playedS(u: Unit) {
    const end = u.leftAt >= 0 ? u.leftAt : this.time;
    const start = Math.max(u.joinedAt, this.playStartTick * DT);
    return Math.max(0, (end - start) * this.timeScale);
  }

  // ---- membership --------------------------------------------------------------
  humans(): Unit[] { return this.units.filter((u): u is Unit => !!u && !u.bot); }
  connectedHumans(): Unit[] { return this.humans().filter((u) => u.connected); }
  bots(): Unit[] { return this.units.filter((u): u is Unit => !!u && u.bot); }
  count() { return this.units.filter(Boolean).length; }

  canJoin(isReconnect = false): boolean {
    if (this.closed) return false;
    if (isReconnect) return this.phase !== 'closed';
    if (this.humans().filter((u) => u.leftAt < 0).length >= TARGET_UNITS) return false;
    if (this.phase === 'forming' || this.phase === 'warmup') return true;
    if (this.phase === 'playing') return this.matchElapsedS() < this.bracket.baseLenS * LATE_JOIN_FRACTION;
    return false;
  }

  /** Attach a returning player to the unit they already own in this room. */
  findOwned(accountId: string): Unit | undefined {
    return this.units.find((u) => u && u.accountId === accountId && !u.bot && u.leftAt < 0) as Unit | undefined;
  }

  join(p: JoinParams): Unit | null {
    if (!p.bot && p.accountId) {
      const existing = this.findOwned(p.accountId);
      if (existing) return this.reattach(existing, p);
    }
    let slot = this.units.findIndex((u) => !u);
    if (slot < 0) return null;
    if (!p.bot && this.count() >= TARGET_UNITS) {
      // make room by dropping a bot
      const b = this.bots().find((x) => !x.alive) ?? this.bots()[0];
      if (b) { this.removeUnit(b); slot = this.units.findIndex((u) => !u); }
      if (slot < 0) return null;
    }
    const u = new Unit(slot, p.accountId, p.name, !!p.bot, p.level, p.cr, p.fit.effective, p.fit.dropped);
    u.joinedAt = this.time;
    u.lastActiveAt = this.time;
    if (p.bot) {
      u.brain = new BotBrain(p.bot.aimDeg, p.bot.reactMs, p.bot.archetype, mulberry32(this.cfg.seed + slot * 7919));
      u.connected = true;
    } else {
      u.link = p.link;
      u.connected = true;
      if (p.link) u.rtt = p.link.rtt;
    }
    this.units[slot] = u;
    if (this.phase === 'playing' || this.phase === 'overtime') {
      // late join (Section 2): median Tier minus 2, clamped 1..4, score starts at zero
      const tiers = this.units.filter((x): x is Unit => !!x && x !== u && x.alive).map((x) => x.tier).sort((a, b) => a - b);
      const median = tiers.length ? tiers[Math.floor(tiers.length / 2)] : 1;
      const tier = Math.max(1, Math.min(4, median - 2));
      u.gs = tierThreshold(tier);
      u.lateJoined = true;
      u.maxTier = tier;
      if (!p.bot) this.botsToRemove++;
    }
    this.refreshStats(u);
    u.hp = u.maxHp;
    this.spawn(u, true);
    if (!p.bot) {
      this.sendRosterAll();
      this.sendWelcome(u);
      if (this.phase === 'forming' && this.humans().length >= TARGET_UNITS) this.phaseEndTick = this.tick + 1;
    }
    return u;
  }

  private reattach(u: Unit, p: JoinParams): Unit {
    u.link = p.link;
    u.connected = true;
    u.disconnectedAt = -1;
    u.rtt = p.link?.rtt ?? 0;
    u.queue.length = 0;
    u.lastSeq = 0; u.processedSeq = 0; u.last = null; // a new connection restarts its input sequence
    u.view.units.clear();
    u.view.pellets.clear();
    if (u.ghosted) {
      // the unit left the map after the ghost time: come back one Tier down with protection
      u.ghosted = false;
      u.gs = deathGs(u.tier, u.gs, u.level <= 4);
      this.refreshStats(u);
      u.hp = u.maxHp;
      this.spawn(u, true);
    }
    this.sendWelcome(u);
    this.sendRosterAll();
    return u;
  }

  disconnect(u: Unit) {
    if (u.bot) return;
    u.connected = false;
    u.link = undefined;
    u.disconnectedAt = this.time;
    u.queue.length = 0;
    this.sendRosterAll();
  }

  /** Permanent leave: the player quit or the reconnect window ended. */
  leave(u: Unit) {
    if (u.leftAt >= 0) return;
    u.leftAt = this.time;
    u.connected = false;
    u.link = undefined;
    if (u.alive) { u.alive = false; this.event({ type: EV_KILL, killer: 255, victim: u.slot, pts: 0 }, u.x, u.y); }
    if (this.phase === 'forming' || this.phase === 'warmup') this.removeUnit(u, true);
    this.sendRosterAll();
  }

  private removeUnit(u: Unit, _keepRecord = false) {
    this.units[u.slot] = undefined;
    for (const o of this.units) o?.view.units.delete(u.slot);
  }

  receiveInput(u: Unit, m: InputMsg) {
    if (u.leftAt >= 0) return;
    // drop duplicates and ancient packets (16-bit sequence arithmetic)
    const diff = (m.seq - u.lastSeq + 65536) % 65536;
    if (u.lastSeq !== 0 && (diff === 0 || diff > 32768)) return;
    u.lastSeq = m.seq;
    u.ack = m.ack;
    u.queue.push(m);
    if (u.queue.length > 20) u.queue.splice(0, u.queue.length - 20);
  }
  receivePing(u: Unit, t: number) {
    u.link?.send(encodePong(t, Date.now()));
  }
  receiveEmote(u: Unit, id: number) {
    if (this.time - u.lastEmoteAt < 3 || id > 5) return;
    u.lastEmoteAt = this.time;
    this.event({ type: EV_EMOTE, slot: u.slot, emote: id }, u.x, u.y);
  }

  // ---- messaging ----------------------------------------------------------------
  private json(u: Unit, msg: ServerJson) { u.link?.send(JSON.stringify(msg)); }
  private broadcastJson(msg: ServerJson) { for (const u of this.connectedHumans()) this.json(u, msg); }
  roster(): RosterEntry[] {
    return this.units.filter((u): u is Unit => !!u).map((u) => ({ slot: u.slot, name: u.name, bot: u.bot, color: u.color }));
  }
  private sendRosterAll() { this.broadcastJson({ t: 'roster', roster: this.roster() }); }
  stateMsg(): StateMsg {
    const nowMs = Date.now();
    const toMs = (tick: number) => nowMs + (tick - this.tick) * (1000 / TICK_HZ);
    const matchEnd = this.playStartTick > 0 ? toMs(this.playStartTick + this.baseTicks) : 0;
    const ring = this.phase === 'overtime' ? this.ringRadius() : 0;
    return {
      t: 'state', phase: this.phase,
      phaseEndsAt: Number.isFinite(this.phaseEndTick) ? Math.round(toMs(this.phaseEndTick)) : 0,
      matchEndsAt: Math.round(matchEnd), serverNow: nowMs, bracket: this.bracket.id,
      humans: this.humans().filter((u) => u.leftAt < 0).length, bots: this.bots().length, ring
    };
  }
  private sendState() { this.broadcastJson(this.stateMsg()); }
  private sendWelcome(u: Unit) {
    const msg: WelcomeMsg = {
      t: 'welcome', slot: u.slot, roomId: this.id, matchId: this.matchId, bracket: this.bracket.id, seed: this.cfg.seed,
      ruleset: RULESET, level: u.level, roster: this.roster(), loadout: u.items,
      dropped: u.dropped.map((d) => ({ slot: d.slot, item: d.item, reason: d.reason })), state: this.stateMsg()
    };
    this.json(u, msg);
  }
  private event(ev: GameEvent, x: number, y: number) { this.events.push({ ev, x, y }); }

  // ---- stats and spawning -----------------------------------------------------------
  private refreshStats(u: Unit) {
    const p = u.powerup && u.powerup.until > this.time ? u.powerup.kind : null;
    const old = u.maxHp;
    u.stats = computeStats(u.gs, u.items, { overdrive: p === 'overdrive', radar: p === 'radar', nitro: p === 'nitro' }, u.probe);
    u.sync();
    if (u.stats.maxHp > old) u.hp += u.stats.maxHp - old;
    u.maxHp = u.stats.maxHp;
    if (u.hp > u.maxHp) u.hp = u.maxHp;
  }

  private choosePad(u: Unit): { x: number; y: number; clear: boolean } {
    const enemies = this.units.filter((o): o is Unit => !!o && o !== u && o.alive);
    let best = -1, bestD = -1;
    for (let i = 0; i < SPAWN_PADS; i++) {
      if (this.time - this.padUsed[i] < SPAWN_PAD_COOLDOWN_S) continue;
      const p = this.world.pads[i];
      let md = 1e9;
      for (const e of enemies) md = Math.min(md, Math.hypot(e.x - p.x, e.y - p.y));
      if (md > bestD) { bestD = md; best = i; }
    }
    if (best < 0) best = Math.floor(this.rng() * SPAWN_PADS);
    this.padUsed[best] = this.time;
    const p = this.world.pads[best];
    return { x: p.x, y: p.y, clear: bestD >= SPAWN_CLEARANCE || enemies.length === 0 };
  }

  private spawn(u: Unit, initial = false) {
    const pad = this.choosePad(u);
    u.x = pad.x; u.y = pad.y; u.vx = 0; u.vy = 0;
    u.aim = Math.atan2(MAP_SIZE / 2 - u.y, MAP_SIZE / 2 - u.x);
    u.alive = true;
    u.hp = u.maxHp;
    u.shield = 0;
    u.powerup = null;
    u.cooldown = 0.3;
    u.spawnedAt = this.time;
    const protect = (u.lateJoined && initial ? LATE_PROTECT_S : SPAWN_PROTECT_S) + (pad.clear ? 0 : 1) + (u.level <= 4 ? 2 : 0);
    u.protectedUntil = this.time + protect;
    u.lastActiveAt = this.time;
    u.view.units.clear();
    u.hist.fill(0);
    this.recordHistory(u);
  }

  private recordHistory(u: Unit) {
    const i = (this.tick % HISTORY_TICKS) * 2;
    u.hist[i] = u.x; u.hist[i + 1] = u.y;
  }
  private posAt(u: Unit, ticksAgo: number): { x: number; y: number } {
    if (ticksAgo <= 0 || ticksAgo >= HISTORY_TICKS) return u;
    const i = ((this.tick - ticksAgo + HISTORY_TICKS * 4) % HISTORY_TICKS) * 2;
    const x = u.hist[i], y = u.hist[i + 1];
    return x === 0 && y === 0 ? u : { x, y };
  }

  // ---- pellets -------------------------------------------------------------------------
  private cellKey(x: number, y: number) { return Math.floor(x / 128) * 64 + Math.floor(y / 128); }
  private spawnPellet(i: number, initial = false) {
    let x = 0, y = 0;
    for (let tries = 0; tries < 12; tries++) {
      x = 60 + this.rng() * (MAP_SIZE - 120);
      y = 60 + this.rng() * (MAP_SIZE - 120);
      if (this.world.walls.some((w) => x > w.x - 12 && x < w.x + w.w + 12 && y > w.y - 12 && y < w.y + w.h + 12)) continue;
      if (!initial && this.units.some((u) => u && u.alive && Math.hypot(u.x - x, u.y - y) < PELLET_MIN_UNIT_DIST)) continue;
      break;
    }
    this.pelletX[i] = x; this.pelletY[i] = y; this.pelletAlive[i] = 1;
    const k = this.cellKey(x, y);
    let s = this.pelletGrid.get(k);
    if (!s) { s = new Set(); this.pelletGrid.set(k, s); }
    s.add(i);
  }
  private removePellet(i: number) {
    this.pelletAlive[i] = 0;
    this.pelletGrid.get(this.cellKey(this.pelletX[i], this.pelletY[i]))?.delete(i);
    this.pelletRespawn[i] = this.time + PELLET_RESPAWN_S;
  }
  private pelletsIn(x0: number, y0: number, x1: number, y1: number, out: number[]) {
    const cx0 = Math.max(0, Math.floor(x0 / 128)), cx1 = Math.min(24, Math.floor(x1 / 128));
    const cy0 = Math.max(0, Math.floor(y0 / 128)), cy1 = Math.min(24, Math.floor(y1 / 128));
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
      const s = this.pelletGrid.get(cx * 64 + cy);
      if (!s) continue;
      for (const id of s) {
        const px = this.pelletX[id], py = this.pelletY[id];
        if (px >= x0 && px <= x1 && py >= y0 && py <= y1) out.push(id);
      }
    }
  }

  // ---- scoring ---------------------------------------------------------------------------
  private addScore(u: Unit, pts: number) {
    if (pts <= 0 || !this.scoringOn()) return;
    const before = u.tier;
    u.ms += pts;
    u.gs += pts;
    u.reachedAt = this.tick;
    u.lastActiveAt = this.time;
    const t = tierFor(u.gs);
    if (t > u.maxTier) u.maxTier = t;
    if (t !== before) {
      this.refreshStats(u);
      if (t > before) this.event({ type: EV_TIER, slot: u.slot, tier: t }, u.x, u.y);
    }
  }
  private scoringOn() { return this.phase === 'playing' || this.phase === 'overtime'; }
  private damageOn() { return this.phase === 'playing' || this.phase === 'overtime'; }

  // ---- damage ------------------------------------------------------------------------------
  private damage(target: Unit, raw: number, attacker: Unit | null, trueDamage = false): number {
    if (!target.alive || !this.damageOn() || this.time < target.protectedUntil) return 0;
    let d = trueDamage ? raw : damageAfterArmor(raw, target.stats.armor);
    if (target.shield > 0) { const a = Math.min(target.shield, d); target.shield -= a; d -= a; }
    if (d > 0) target.hp -= d;
    target.lastDamagedAt = this.time;
    target.lastActiveAt = this.time;
    if (attacker && attacker !== target) {
      target.lastHitBy = attacker.slot;
      target.lastHitAt = this.time;
      while (target.dmgLog.length && this.time - target.dmgLog[0].t > ASSIST_WINDOW_S) target.dmgLog.shift();
      target.dmgLog.push({ slot: attacker.slot, t: this.time, dmg: raw });
      attacker.lastActiveAt = this.time;
    }
    this.event({ type: EV_HIT, target: target.slot, dmg: Math.min(255, Math.round(raw)) }, target.x, target.y);
    return d;
  }
  private damageCrate(c: Crate, dmg: number, attacker: Unit | null) {
    if (!c.alive || !this.damageOn()) return;
    c.hp -= dmg;
    if (attacker) c.lastHitBy = attacker.slot;
    if (c.hp <= 0) {
      c.alive = false;
      c.respawnAt = this.time + CRATE_RESPAWN_S;
      const killer = c.lastHitBy >= 0 ? this.units[c.lastHitBy] : undefined;
      if (killer && killer.leftAt < 0) {
        this.addScore(killer, CRATE_POINTS);
        this.event({ type: EV_PICKUP, kind: PICK_CRATE, slot: killer.slot, ref: c.id }, c.x, c.y);
      }
      const kind = POWERUP_KINDS[Math.floor(this.rng() * POWERUP_KINDS.length)];
      const id = this.nextGroundId++ & 0xffff;
      this.ground.set(id, { id, kind, x: c.x, y: c.y, expiresAt: this.time + 30 });
    }
  }

  // ---- projectiles -----------------------------------------------------------------------
  private fire(u: Unit) {
    const w = u.weapon;
    const s = u.stats;
    u.cooldown += 1 / (w.rate * s.fireMult); // carry the remainder so the real rate matches the design at 20 Hz
    if (u.protectedUntil > this.time) u.protectedUntil = this.time; // firing ends spawn protection
    const rewind = u.bot ? 0 : Math.max(0, Math.min(4, Math.round(Math.min(LAG_COMP_MAX_MS, u.rtt / 2 + 100) / (1000 / TICK_HZ))));
    for (const pel of w.pellets) {
      if (this.projectiles.length >= PROJECTILE_CAP) return;
      const a = u.aim + pel.angle;
      const nx = -Math.sin(u.aim), ny = Math.cos(u.aim);
      const sx = u.x + Math.cos(u.aim) * (u.radius + 2) + nx * pel.lateral;
      const sy = u.y + Math.sin(u.aim) * (u.radius + 2) + ny * pel.lateral;
      const speed = w.speed * s.rangeMult;
      const p: Projectile = {
        id: this.nextProjId++ & 0xffff, owner: u.slot, weapon: w, x: sx, y: sy,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, dmg: w.damage * s.damageMult, range: w.range * s.rangeMult,
        travelled: 0, radius: w.radius, pierceLeft: w.pierce, hit: new Set(), rewind, age: 0, speed
      };
      this.projectiles.push(p);
      this.event({ type: EV_PROJ, id: p.id, owner: u.slot, weapon: w.id, x: sx, y: sy, angle: a, age: 0 }, sx, sy);
    }
  }

  private endProjectile(p: Projectile, x: number, y: number, kind: number) {
    this.event({ type: EV_PROJEND, id: p.id, x, y, kind }, x, y);
  }

  private explode(p: Projectile, x: number, y: number) {
    const w = p.weapon;
    const owner = this.units[p.owner];
    for (const t of this.units) {
      if (!t || !t.alive || t.slot === p.owner) continue;
      const d = Math.hypot(t.x - x, t.y - y);
      if (d > w.aoeRadius + t.radius) continue;
      const k = Math.min(1, Math.max(0, d / w.aoeRadius));
      this.damage(t, p.dmg * (1 + (w.aoeFalloff - 1) * k), owner ?? null);
    }
    for (const c of this.crates) {
      if (!c.alive) continue;
      if (Math.hypot(c.x - x, c.y - y) <= w.aoeRadius + CRATE_RADIUS) this.damageCrate(c, p.dmg * 0.75, owner ?? null);
    }
    this.endProjectile(p, x, y, END_EXPLODE);
  }

  private stepProjectiles() {
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      const owner = this.units[p.owner];
      const step = Math.min(p.speed * DT, p.range - p.travelled);
      const len = Math.hypot(p.vx, p.vy) || 1;
      const x0 = p.x, y0 = p.y;
      const x1 = x0 + (p.vx / len) * step, y1 = y0 + (p.vy / len) * step;
      const w = p.weapon;
      let alive = true;

      if (w.arcs) {
        // mortar shell: flies over walls, proximity fuse after the minimum range
        p.x = x1; p.y = y1; p.travelled += step; p.age++;
        const armed = p.travelled >= w.minRange;
        let fuse = false;
        if (armed) {
          for (const t of this.units) {
            if (!t || !t.alive || t.slot === p.owner || this.time < t.protectedUntil) continue;
            if (Math.hypot(t.x - p.x, t.y - p.y) <= MORTAR_FUSE_RADIUS + t.radius) { fuse = true; break; }
          }
        }
        if (fuse || p.travelled >= p.range - 1e-6) { this.explode(p, p.x, p.y); alive = false; }
        if (alive) keep.push(p);
        continue;
      }

      let remaining = 1; // fraction of this step still available (after piercing)
      let sx = x0, sy = y0;
      let stopped = false;
      for (let guard = 0; guard < 4 && !stopped; guard++) {
        const ex = sx + (x1 - sx) * remaining, ey = sy + (y1 - sy) * remaining;
        let bestT = Infinity;
        let bestKind: 'wall' | 'unit' | 'crate' | null = null;
        let bestUnit: Unit | null = null;
        let bestCrate: Crate | null = null;
        for (const wall of this.world.walls) {
          const t = segRect(sx, sy, ex, ey, wall);
          if (t >= 0 && t < bestT) { bestT = t; bestKind = 'wall'; }
        }
        for (const t of this.units) {
          if (!t || !t.alive || t.slot === p.owner || p.hit.has(t.slot) || this.time < t.protectedUntil) continue;
          const rewind = p.age < p.rewind ? p.rewind - p.age : 0;
          const pos = rewind > 0 ? this.posAt(t, rewind) : t;
          const tt = segCircle(sx, sy, ex, ey, pos.x, pos.y, t.radius + p.radius);
          if (tt >= 0 && tt < bestT) { bestT = tt; bestKind = 'unit'; bestUnit = t; }
        }
        for (const c of this.crates) {
          if (!c.alive) continue;
          const tt = segCircle(sx, sy, ex, ey, c.x, c.y, CRATE_RADIUS + p.radius);
          if (tt >= 0 && tt < bestT) { bestT = tt; bestKind = 'crate'; bestCrate = c; }
        }
        if (bestKind === null) {
          p.x = ex; p.y = ey;
          break;
        }
        const hx = sx + (ex - sx) * bestT, hy = sy + (ey - sy) * bestT;
        if (bestKind === 'wall') {
          this.endProjectile(p, hx, hy, END_WALL);
          alive = false; stopped = true;
        } else if (bestKind === 'crate' && bestCrate) {
          this.damageCrate(bestCrate, p.dmg, owner ?? null);
          this.endProjectile(p, hx, hy, END_CRATE);
          alive = false; stopped = true;
        } else if (bestKind === 'unit' && bestUnit) {
          this.damage(bestUnit, p.dmg, owner ?? null);
          p.hit.add(bestUnit.slot);
          if (p.pierceLeft > 0) {
            p.pierceLeft--;
            p.dmg *= w.pierceFactor;
            remaining *= 1 - bestT;
            sx = hx; sy = hy;
            p.x = hx; p.y = hy;
            continue;
          }
          this.endProjectile(p, hx, hy, END_UNIT);
          alive = false; stopped = true;
        }
      }
      if (alive) {
        p.travelled += step;
        p.age++;
        if (p.travelled >= p.range - 1e-6) { this.endProjectile(p, p.x, p.y, END_RANGE); alive = false; }
      }
      if (alive) keep.push(p);
    }
    this.projectiles = keep;
  }

  // ---- bots ----------------------------------------------------------------------------------
  private botWorld(): BotWorld {
    return {
      time: this.time, world: this.world,
      liveUnits: () => this.units.filter((u): u is Unit => !!u && u.alive),
      nearestPellet: (x, y, maxDist) => {
        const out: number[] = [];
        this.pelletsIn(x - maxDist, y - maxDist, x + maxDist, y + maxDist, out);
        let best = -1, bd = maxDist * maxDist;
        for (const id of out) {
          const d = (this.pelletX[id] - x) ** 2 + (this.pelletY[id] - y) ** 2;
          if (d < bd) { bd = d; best = id; }
        }
        return best >= 0 ? { x: this.pelletX[best], y: this.pelletY[best] } : null;
      },
      liveCrates: () => this.crates.filter((c) => c.alive)
    };
  }
  private thinkBots() {
    const bw = this.botWorld();
    for (const u of this.units) {
      if (!u || !u.bot || !u.alive || !u.brain) continue;
      if ((this.tick + u.slot) % 2 !== 0) continue; // think every 100 ms, staggered
      const out = u.brain.think(u, bw);
      u.queue.length = 0;
      u.queue.push({ seq: 0, mx: out.mx, my: out.my, aim: out.aim, buttons: out.fire ? BTN_FIRE : 0, ack: 0 });
    }
  }

  // ---- phases ---------------------------------------------------------------------------------
  private setPhase(p: Phase, ticks: number) {
    this.phase = p;
    this.phaseEndTick = Number.isFinite(ticks) ? this.tick + ticks : Infinity;
    this.sendState();
  }

  private fillBots() {
    const humans = this.humans().filter((u) => u.leftAt < 0);
    const rookieRoom = humans.length > 0 && humans.every((h) => h.level <= 4);
    const bracket = this.bracket;
    const want = rookieRoom ? Math.max(MIN_START_UNITS - humans.length, Math.round(TARGET_UNITS * ROOKIE_BOT_SHARE)) : MIN_START_UNITS - humans.length;
    const total = Math.min(TARGET_UNITS - humans.length, Math.max(0, want));
    const kinds: Archetype[] = ['anvil', 'wasp', 'hawk'];
    for (let i = 0; i < total; i++) {
      const kind = kinds[i % 3];
      const fit = this.botFit(kind);
      const aim = rookieRoom ? ROOKIE_BOT_AIM_DEG : bracket.botAimDeg;
      const react = rookieRoom ? ROOKIE_BOT_REACT_MS : bracket.botReactMs;
      const name = BOT_NAMES[(this.cfg.seed + i * 5) % BOT_NAMES.length] + (i >= BOT_NAMES.length ? String(i) : '');
      const level = bracket.maxLevel;
      this.join({ accountId: null, name, level, cr: 1000, fit, bot: { archetype: kind, aimDeg: aim, reactMs: react } });
    }
    this.sendRosterAll(); // clients need the bot names before the first scoreboard arrives
  }
  private botFit(kind: Archetype): FitResult {
    const lo = ARCHETYPES[kind];
    const inv: Record<string, number> = {};
    // largest Mk the 35% rule allows in this bracket
    let mk = 1;
    for (let m = 1; m <= 5; m++) {
      const pp = [2, 4, 7, 11, 16][m - 1];
      if (pp <= 0.35 * this.bracket.ppCap) mk = m;
    }
    for (const id of Object.values(lo)) if (id) inv[id] = mk;
    return fitLoadoutFor(this.bracket, lo as Record<string, string>, inv);
  }

  private respawnAllAtPads() {
    this.padUsed.fill(-100);
    for (const u of this.units) {
      if (!u) continue;
      this.refreshStats(u);
      u.gs = 0; u.ms = 0; u.kills = 0; u.deaths = 0; u.assists = 0; u.maxTier = 1;
      this.refreshStats(u);
      u.hp = u.maxHp;
      this.spawn(u, true);
    }
  }

  private ringRadius() {
    const t = Math.max(0, (this.tick - this.overtimeStartTick) * DT * this.timeScale);
    return OVERTIME_RING_START - (OVERTIME_RING_START - OVERTIME_RING_END) * Math.min(1, t / OVERTIME_S);
  }

  private updatePhase() {
    const humansLive = this.connectedHumans().length;
    if (this.cfg.abortWhenEmpty !== false && this.phase !== 'ending' && this.phase !== 'results' && this.phase !== 'closed') {
      if (humansLive === 0) {
        if (this.emptySince < 0) this.emptySince = this.tick;
        if (this.tick - this.emptySince >= this.ticksFor(ABORT_HUMANS_S)) {
          this.finish('abort');
          return;
        }
      } else this.emptySince = -1;
    }
    switch (this.phase) {
      case 'forming':
        if (this.tick >= this.phaseEndTick) {
          this.fillBots();
          this.respawnAllAtPads();
          this.setPhase('warmup', this.ticksFor(WARMUP_S));
        }
        break;
      case 'warmup':
        if (this.tick >= this.phaseEndTick) {
          this.playStartTick = this.tick;
          this.respawnAllAtPads();
          this.setPhase('playing', this.baseTicks);
        }
        break;
      case 'playing': {
        if (this.tick % TICK_HZ === 0) this.checkMercy();
        if (this.tick >= this.phaseEndTick) {
          const [a, b] = this.ranked;
          const gap = a && a.ms > 0 ? (a.ms - (b?.ms ?? 0)) / a.ms : 1;
          if (gap <= OVERTIME_TRIGGER_GAP && b) {
            this.overtimeStartTick = this.tick;
            this.setPhase('overtime', this.ticksFor(OVERTIME_S));
          } else this.finish('timer');
        }
        break;
      }
      case 'overtime':
        if (this.tick % 10 === 0) this.sendState();
        if (this.tick >= this.phaseEndTick) this.finish('overtime');
        break;
      case 'ending':
        if (this.tick >= this.phaseEndTick) this.setPhase('results', this.ticksFor(RESULTS_S));
        break;
      case 'results':
        if (this.tick >= this.phaseEndTick) this.close();
        break;
      default:
    }
  }

  private checkMercy() {
    if (this.matchElapsedS() < MIN_MATCH_S) { this.mercySince = -1; return; }
    const [a, b] = this.ranked;
    if (a && a.ms >= 100 && a.ms >= MERCY_RATIO * Math.max(b?.ms ?? 0, 1)) {
      if (this.mercySince < 0) this.mercySince = this.tick;
      if (this.tick - this.mercySince >= this.ticksFor(MERCY_HOLD_S)) this.finish('mercy');
    } else this.mercySince = -1;
  }

  /** For simulators and benchmarks: skip Forming and Warm-up, no bots added. Everyone starts fresh and unprotected. */
  startPlayingNow(opts: { lengthS?: number } = {}) {
    this.playStartTick = this.tick || 1;
    if (opts.lengthS) this.baseTicks = this.ticksFor(opts.lengthS);
    this.respawnAllAtPads();
    for (const u of this.units) if (u) u.protectedUntil = 0;
    this.setPhase('playing', this.baseTicks);
  }

  // ---- finishing ---------------------------------------------------------------------------------
  buildResult(reason: string): MatchResult {
    const all = this.units.filter((u): u is Unit => !!u);
    // include humans that already left in warmup (never counted) but not bots that were removed
    const sorted = [...all].sort((a, b) => b.ms - a.ms || a.deaths - b.deaths || b.kills - a.kills || a.reachedAt - b.reachedAt);
    const humansSorted = sorted.filter((u) => !u.bot);
    // anti-abuse: one killer taking more than 40% of a victim's deaths (Section 9)
    for (const v of humansSorted) {
      if (v.deathsTotal < FEED_MIN_DEATHS) continue;
      for (const k of humansSorted) {
        if (k === v) continue;
        if ((k.killsOn[v.slot] ?? 0) / v.deathsTotal > FEED_SHARE_MAX) { k.flags |= FLAG_FEED; v.flags |= FLAG_FEED; }
      }
    }
    const players: ResultPlayer[] = sorted.map((u, i) => ({
      slot: u.slot, accountId: u.accountId, name: u.name, bot: u.bot, rank: i + 1,
      rankHuman: u.bot ? null : humansSorted.indexOf(u) + 1, ms: Math.round(u.ms), kills: u.kills, deaths: u.deaths,
      assists: u.assists, maxTier: u.maxTier, playedS: Math.round(this.playedS(u)), level: u.level, cr: u.cr,
      loadout: u.items, flags: u.flags, killsOn: u.killsOn
    }));
    const dur = Math.round(Math.max(0, (this.tick - this.playStartTick) * DT * this.timeScale));
    return {
      matchId: this.matchId, roomId: this.id, bracket: this.bracket.id, startedAt: this.startedAtMs, endedAt: Date.now(),
      durationS: this.playStartTick > 0 ? dur : 0, endReason: reason, humans: humansSorted.length, players
    };
  }

  private finish(reason: string) {
    if (this.phase === 'ending' || this.phase === 'results' || this.phase === 'closed') return;
    this.endReason = reason;
    const started = this.playStartTick > 0;
    const result = started ? this.buildResult(reason) : this.buildResult('abort');
    this.lastResult = result;
    this.rewards = started && this.cfg.onFinish ? this.cfg.onFinish(result) : new Map();
    this.setPhase('ending', this.ticksFor(ENDING_S));
    // freeze: nobody can be hurt or score after this tick
    this.sendResults();
  }
  private sendResults() {
    if (this.resultsSent || !this.lastResult) return;
    this.resultsSent = true;
    const rows: ResultRow[] = this.lastResult.players.map((p) => ({
      slot: p.slot, name: p.name, bot: p.bot, rank: p.rank, ms: p.ms, kills: p.kills, deaths: p.deaths, assists: p.assists, maxTier: p.maxTier
    }));
    for (const u of this.connectedHumans()) {
      const mine = u.accountId ? this.rewards.get(u.accountId) : undefined;
      const msg: ResultsMsg = { t: 'results', rows, mine, endReason: this.endReason, durationS: this.lastResult.durationS };
      this.json(u, msg);
    }
  }

  private close() {
    if (this.closed) return;
    this.closed = true;
    this.phase = 'closed';
    for (const u of this.connectedHumans()) u.link?.close('room closed');
  }
  forceClose(reason = 'shutdown') {
    if (this.closed) return;
    this.closed = true;
    for (const u of this.connectedHumans()) u.link?.close(reason);
  }

  // ---- the tick ------------------------------------------------------------------------------------
  step() {
    const t0 = performance.now();
    this.tick++;
    const time = this.time;
    const live = this.units.filter((u): u is Unit => !!u);

    // rank table and beacon (once per tick, cheap for <= 32 units)
    this.ranked = [...live].sort((a, b) => b.ms - a.ms || a.deaths - b.deaths || b.kills - a.kills || a.reachedAt - b.reachedAt);
    this.rankBySlot.clear();
    this.ranked.forEach((u, i) => this.rankBySlot.set(u.slot, i + 1));
    const lead = this.ranked[0];
    this.beaconSlot = lead && lead.alive && lead.ms >= BEACON_MIN_MS && this.matchElapsedS() >= BEACON_AFTER_S && this.scoringOn() ? lead.slot : -1;

    for (const u of live) u.protectedNow = time < u.protectedUntil;
    if (this.phase === 'playing' || this.phase === 'overtime' || this.phase === 'warmup' || this.phase === 'forming') this.thinkBots();

    // 1 + 2: apply inputs and move
    const frozen = this.phase === 'ending' || this.phase === 'results';
    for (const u of live) {
      if (!u.alive || frozen) continue;
      let steps = 0;
      let applied = false;
      while (u.queue.length && steps < 2) {
        const m = u.queue.shift()!;
        this.applyInput(u, m);
        u.last = m; u.processedSeq = m.seq; u.heldTicks = 0; applied = true; steps++;
      }
      if (!applied) {
        if (u.last && u.heldTicks < 3 && (u.connected || u.heldTicks < 3)) {
          this.applyInput(u, u.last);
          u.heldTicks++;
        } else {
          u.vx = 0; u.vy = 0; u.fireHeld = false; u.scoping = false;
        }
      }
    }
    this.separateUnits(live);
    for (const u of live) if (u.alive) this.recordHistory(u);

    // hazards: mines, overtime ring
    if (this.damageOn()) {
      for (const u of live) {
        if (!u.alive) continue;
        for (const m of this.world.mines) {
          if (Math.hypot(u.x - m.x, u.y - m.y) <= m.r) {
            if (time >= u.nextMineAt) { this.damage(u, MINE_DAMAGE, null, true); u.nextMineAt = time + MINE_INTERVAL_S; }
            break;
          }
          u.nextMineAt = Math.min(u.nextMineAt, time);
        }
        if (this.phase === 'overtime') {
          const ring = this.ringRadius();
          if (Math.hypot(u.x - 1600, u.y - 1600) > ring) this.damage(u, OVERTIME_RING_DPS * DT, null, true);
        }
      }
    }

    // 3: fire
    if (this.damageOn()) {
      for (const u of live) {
        u.cooldown = Math.max(u.cooldown - DT, -DT);
        if (u.alive && u.fireHeld && u.cooldown <= 0) this.fire(u);
      }
    } else for (const u of live) u.cooldown = Math.max(0, u.cooldown - DT);

    // 4: projectiles
    this.stepProjectiles();

    // 5: pickups
    if (this.scoringOn()) this.pickups(live);

    // 6: deaths
    this.resolveDeaths(live);

    // 7: upkeep
    this.upkeep(live);
    this.updatePhase();
    this.dropIdleAndGhosts(live);

    // 8: snapshots
    this.sendSnapshots(live);
    if (this.tick % 10 === 0) this.sendScoreboards();
    this.events.length = 0;

    const ms = performance.now() - t0;
    this.tickMsEma = this.tickMsEma ? this.tickMsEma * 0.95 + ms * 0.05 : ms;
    if (ms > this.tickMsMax) this.tickMsMax = ms;
  }

  private applyInput(u: Unit, m: InputMsg) {
    const w = u.weapon;
    u.aim = rotateToward(u.aim, m.aim, AIM_TURN_RATE * w.turnMult * DT);
    u.fireHeld = (m.buttons & BTN_FIRE) !== 0;
    u.scoping = (m.buttons & BTN_SCOPE) !== 0;
    const speed = u.stats.speed * (u.scoping ? 0.75 : 1);
    const v = stepPosition(u, m.mx, m.my, speed, u.radius, DT, this.world.walls);
    u.vx = v.x; u.vy = v.y;
    if (Math.abs(m.mx) + Math.abs(m.my) > 10) u.lastActiveAt = this.time;
  }

  private separateUnits(live: Unit[]) {
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j];
        if (!b.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const min = (a.radius + b.radius) * 0.9;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) / 2;
        a.x -= (dx / d) * push; a.y -= (dy / d) * push;
        b.x += (dx / d) * push; b.y += (dy / d) * push;
      }
    }
  }

  private pickups(live: Unit[]) {
    const out: number[] = [];
    for (const u of live) {
      if (!u.alive) continue;
      const r = u.radius + u.stats.magnet;
      out.length = 0;
      this.pelletsIn(u.x - r, u.y - r, u.x + r, u.y + r, out);
      for (const id of out) {
        if (Math.hypot(this.pelletX[id] - u.x, this.pelletY[id] - u.y) > r + PELLET_RADIUS) continue;
        this.removePellet(id);
        this.addScore(u, pelletValue(u.tier, u.stats.feedMult));
        this.event({ type: EV_PICKUP, kind: PICK_PELLET, slot: u.slot, ref: id }, u.x, u.y);
      }
      if (this.time >= u.protectedUntil) {
        for (const g of this.ground.values()) {
          if (Math.hypot(g.x - u.x, g.y - u.y) > u.radius + POWERUP_PICKUP_RADIUS) continue;
          this.ground.delete(g.id);
          this.givePowerup(u, g.kind);
          this.event({ type: EV_PICKUP, kind: PICK_POWERUP, slot: u.slot, ref: g.id }, u.x, u.y);
        }
      }
    }
  }
  private givePowerup(u: Unit, kind: PowerupKind) {
    const def = POWERUPS[kind];
    u.powerup = { kind, until: this.time + def.duration };
    if (kind === 'aegis') { u.shield = def.shield ?? 0; u.shieldUntil = this.time + def.duration; }
    this.refreshStats(u);
  }

  private resolveDeaths(live: Unit[]) {
    for (const v of live) {
      if (!v.alive || v.hp > 0) continue;
      v.alive = false;
      v.deaths++;
      v.deathsTotal++;
      const time = this.time;
      const killer = v.lastHitBy >= 0 && time - v.lastHitAt <= ASSIST_WINDOW_S ? this.units[v.lastHitBy] : undefined;
      const spawnKill = time - v.spawnedAt <= SPAWN_KILL_WINDOW_S;
      let pts = 0;
      if (killer && killer !== v && killer.leftAt < 0 && !spawnKill) {
        const times = (killer.killTimes.get(v.slot) ?? []).filter((t) => time - t <= REPEAT_KILL_WINDOW_S);
        pts = killBounty(v.gs, v.tier, killer.tier, times.length, v.bot);
        times.push(time);
        killer.killTimes.set(v.slot, times);
        killer.kills++;
        killer.killsOn[v.slot] = (killer.killsOn[v.slot] ?? 0) + 1;
        this.addScore(killer, pts);
        // assists: 25% of the victim's max HP in the last 5 s by someone other than the killer
        const dmgBy = new Map<number, number>();
        for (const d of v.dmgLog) if (time - d.t <= ASSIST_WINDOW_S && d.slot !== killer.slot) dmgBy.set(d.slot, (dmgBy.get(d.slot) ?? 0) + d.dmg);
        for (const [slot, dmg] of dmgBy) {
          const a = this.units[slot];
          if (a && dmg >= ASSIST_DAMAGE_FRACTION * v.maxHp && a !== v) { a.assists++; this.addScore(a, assistBounty(v.gs, v.bot)); }
        }
      }
      this.event({ type: EV_KILL, killer: killer ? killer.slot : 255, victim: v.slot, pts: Math.round(pts) }, v.x, v.y);
      v.dmgLog.length = 0;
      const wait = respawnSeconds(v.tier, v.stats.rebornMult);
      v.respawnAt = time + wait;
      if (!spawnKill) v.gs = deathGs(v.tier, v.gs, v.level <= 4 && !v.bot);
      v.powerup = null; v.shield = 0;
      this.refreshStats(v);
      v.fireHeld = false; v.vx = 0; v.vy = 0;
    }
  }

  private upkeep(live: Unit[]) {
    const time = this.time;
    for (let i = 0; i < PELLET_COUNT; i++) if (!this.pelletAlive[i] && time >= this.pelletRespawn[i] && this.scoringOn()) this.spawnPellet(i);
    for (const c of this.crates) if (!c.alive && time >= c.respawnAt) { c.alive = true; c.hp = CRATE_HP; c.lastHitBy = -1; }
    for (const [id, g] of this.ground) if (time >= g.expiresAt) this.ground.delete(id);
    for (const u of live) {
      if (!u.alive) {
        if (u.leftAt < 0 && !u.ghosted && time >= u.respawnAt && (this.phase === 'playing' || this.phase === 'overtime') && (u.connected || u.bot)) {
          this.refreshStats(u);
          u.hp = u.maxHp;
          this.spawn(u);
        }
        continue;
      }
      if (u.powerup && time >= u.powerup.until) { u.powerup = null; u.shield = 0; this.refreshStats(u); }
      if (u.shield > 0 && time >= u.shieldUntil) u.shield = 0;
      if (this.damageOn() && time - u.lastDamagedAt >= 5 && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.stats.repair * DT);
      if (u.hp > u.maxHp) u.hp = u.maxHp;
    }
    // bots yield their slots as humans arrive (Section 6): one per second, only out of sight
    if (this.botsToRemove > 0 && this.tick % TICK_HZ === 0) {
      const humans = this.units.filter((u): u is Unit => !!u && !u.bot && u.alive);
      const victim = this.bots().find((b) => !b.alive || !humans.some((h) => Math.hypot(h.x - b.x, h.y - b.y) <= h.look + 200));
      if (victim) { this.removeUnit(victim); this.botsToRemove--; this.sendRosterAll(); }
    }
  }

  private dropIdleAndGhosts(live: Unit[]) {
    const time = this.time;
    for (const u of live) {
      if (u.bot || u.leftAt >= 0) continue;
      if (!u.connected) {
        if (u.alive && time - u.disconnectedAt >= GHOST_S) { u.alive = false; u.ghosted = true; }
        if (time - u.disconnectedAt >= RECONNECT_S) this.leave(u);
        continue;
      }
      if (this.phase === 'playing' && u.alive && time - u.lastActiveAt >= IDLE_KICK_S) {
        u.flags |= FLAG_IDLE;
        u.link?.send(JSON.stringify({ t: 'kick', reason: 'idle' } satisfies ServerJson));
        u.link?.close('idle');
        this.disconnect(u);
        this.leave(u);
      }
    }
  }

  // ---- snapshots (interest management by Look, Section 10) ---------------------------------------------
  private centers(u: Unit): { x: number; y: number; r: number }[] {
    const c = [{ x: u.x, y: u.y, r: u.look }];
    if (u.scoping && u.alive) c.push({ x: u.x + Math.cos(u.aim) * u.stats.scope, y: u.y + Math.sin(u.aim) * u.stats.scope, r: u.look });
    return c;
  }
  private sendSnapshots(live: Unit[]) {
    const crateList = this.crates.filter((c) => c.alive);
    const pel: number[] = [];
    for (const u of live) {
      if (u.bot || !u.connected || !u.link) continue;
      const cs = this.centers(u);
      const inInterest = (x: number, y: number, pad = 0) => cs.some((c) => Math.hypot(x - c.x, y - c.y) <= c.r + pad);

      const units: Snapshot['units'] = [];
      const current = new Set<number>();
      const cand = live.filter((o) => o !== u && o.alive && (inInterest(o.x, o.y, o.radius) || o.slot === this.beaconSlot));
      cand.sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y));
      for (const o of cand.slice(0, 64)) {
        current.add(o.slot);
        const p = o.powerup && o.powerup.until > this.time ? POWERUP_KINDS.indexOf(o.powerup.kind) + 1 : 0;
        units.push({
          slot: o.slot, x: o.x, y: o.y, angle: o.aim, hpPct: Math.max(0, Math.min(255, Math.round((o.hp / o.maxHp) * 200))),
          tier: o.tier, flags: (o.protectedNow ? UF_PROTECTED : 0) | (o.scoping ? UF_SCOPING : 0) | (o.shield > 0 ? UF_SHIELD : 0) | (o.slot === this.beaconSlot ? UF_BEACON : 0),
          radius: o.radius, vx: o.vx, vy: o.vy, weapon: o.weapon.id, powerup: p
        });
      }
      const removedUnits: number[] = [];
      for (const s of u.view.units) if (!current.has(s)) removedUnits.push(s);
      u.view.units = current;

      // scrap inside the camera rectangle
      const W = CAMERA_FRAMING * u.look;
      const H = (W * 9) / 16;
      const cx = cs[cs.length - 1].x, cy = cs[cs.length - 1].y;
      pel.length = 0;
      this.pelletsIn(cx - W / 2 - 40, cy - H / 2 - 40, cx + W / 2 + 40, cy + H / 2 + 40, pel);
      const nowSet = new Set(pel);
      const pelletAdds: Snapshot['pelletAdds'] = [];
      for (const id of pel) if (!u.view.pellets.has(id)) pelletAdds.push({ id, x: this.pelletX[id], y: this.pelletY[id] });
      const pelletRemoves: number[] = [];
      for (const id of u.view.pellets) if (!nowSet.has(id)) pelletRemoves.push(id);
      u.view.pellets = nowSet;

      const crates = crateList.filter((c) => inInterest(c.x, c.y, 40)).map((c) => ({ id: c.id, x: c.x, y: c.y, hpPct: Math.round((c.hp / CRATE_HP) * 255) }));
      const powerups = [...this.ground.values()].filter((g) => inInterest(g.x, g.y, 30)).map((g) => ({ id: g.id, kind: POWERUP_KINDS.indexOf(g.kind) + 1, x: g.x, y: g.y }));
      const events: GameEvent[] = [];
      for (const q of this.events) {
        const ev = q.ev;
        const mine = (ev.type === EV_KILL && (ev.killer === u.slot || ev.victim === u.slot)) || (ev.type === EV_PICKUP && ev.slot === u.slot);
        if (mine || inInterest(q.x, q.y, 120)) events.push(ev);
      }
      const flags = (u.alive ? OF_ALIVE : 0) | (u.protectedNow ? OF_PROTECTED : 0) | (u.scoping ? OF_SCOPING : 0) | (u.shield > 0 ? OF_SHIELD : 0) | (u.slot === this.beaconSlot ? OF_BEACON : 0);
      const pu = u.powerup && u.powerup.until > this.time ? u.powerup : null;
      const snap: Snapshot = {
        seq: ++u.view.seq & 0xffff, tick: this.tick, lastInput: u.processedSeq,
        own: {
          x: u.x, y: u.y, hp: Math.max(0, u.hp), maxHp: u.maxHp, shield: u.shield, gs: u.gs, ms: u.ms, tier: u.tier, flags,
          respawnMs: u.alive ? 0 : Math.max(0, (u.respawnAt - this.time) * 1000), kills: u.kills, deaths: u.deaths, assists: u.assists,
          powerup: pu ? POWERUP_KINDS.indexOf(pu.kind) + 1 : 0, powerupLeft: pu ? pu.until - this.time : 0, rank: this.rankBySlot.get(u.slot) ?? 0
        },
        units, removedUnits, pelletAdds, pelletRemoves, crates, powerups, events
      };
      u.link.send(encodeSnapshot(snap));
    }
  }
  private sendScoreboards() {
    if (this.ranked.length === 0) return;
    const top: ScoreRow[] = this.ranked.slice(0, 10).map((u) => ({ slot: u.slot, tier: u.tier, ms: u.ms, kills: u.kills }));
    for (const u of this.connectedHumans()) {
      const rows = [...top];
      const rank = this.rankBySlot.get(u.slot) ?? 0;
      if (rank > 10) rows.push({ slot: u.slot, tier: u.tier, ms: u.ms, kills: u.kills });
      u.link?.send(encodeScoreboard(rank, rows));
    }
  }
}

function fitLoadoutFor(bracket: BracketDef, lo: Record<string, string>, inv: Inventory): FitResult {
  return fitLoadout(bracket.maxLevel, bracket, lo as LoadoutIds, inv);
}
