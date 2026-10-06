import {
  DT, EV_EMOTE, EV_HIT, EV_KILL, EV_PICKUP, EV_PROJ, EV_PROJEND, EV_TIER, EMOTES, END_EXPLODE, END_RANGE, INTERP_MS, OF_ALIVE, OF_BEACON,
  PICK_CRATE, PICK_PELLET, PICK_POWERUP, TICK_MS, UF_BEACON, WEAPONS, computeStats, generateWorld, stepPosition, weaponForTier,
  type EffectiveItem, type GameEvent, type InputMsg, type RosterEntry, type ScoreRow, type SnapCrate, type SnapOwn, type SnapPowerup,
  type SnapUnit, type Snapshot, type StateMsg, type UnitStats, type WelcomeMsg, type World, type PowerupKind
} from '@war/shared';

export interface UnitSample { t: number; x: number; y: number; angle: number; vx: number; vy: number }
export interface UnitTrack { slot: number; samples: UnitSample[]; last: SnapUnit; flashUntil: number }
export interface ProjTrack {
  id: number; owner: number; weapon: number; x0: number; y0: number; dx: number; dy: number; t0: number; clock: 'server' | 'local';
  speed: number; range: number; ageOffset: number; matched: boolean;
}
export interface Fx { kind: 'muzzle' | 'spark' | 'boom' | 'tier' | 'kill' | 'pickup'; x: number; y: number; t0: number; life: number; r: number; color: number }
export interface Floater { x: number; y: number; t0: number; text: string; color: number }
export interface Pose { x: number; y: number; angle: number }

export const POWERUP_ORDER: PowerupKind[] = ['overdrive', 'aegis', 'radar', 'nitro'];
const isAfter = (a: number, b: number) => { const d = (a - b + 65536) % 65536; return d !== 0 && d < 32768; };

export type SoundKind = 'shoot' | 'hit' | 'hurt' | 'pickup' | 'tier' | 'kill' | 'death' | 'boom' | 'crate' | 'low';
export interface Hooks {
  sound(kind: SoundKind, x: number, y: number): void;
  banner(title: string, sub?: string): void;
  hurt(): void;
}

export class ClientWorld {
  slot = -1;
  world!: World;
  roster = new Map<number, RosterEntry>();
  loadout: EffectiveItem[] = [];
  bracket = 1;
  matchId = '';
  state: StateMsg | null = null;
  stateAt = 0; // local epoch ms when the state message arrived
  own: SnapOwn | null = null;
  ownStats: UnitStats;
  wasAlive = false;
  // prediction
  pred = { x: 0, y: 0, aim: 0 };
  prev = { x: 0, y: 0 };
  err = { x: 0, y: 0 };
  pending: InputMsg[] = [];
  seq = 0;
  lastSnapSeq = 0;
  // remote state
  units = new Map<number, UnitTrack>();
  pellets = new Map<number, { x: number; y: number }>();
  crates: SnapCrate[] = [];
  powerups: SnapPowerup[] = [];
  projectiles = new Map<number, ProjTrack>();
  ownPending: ProjTrack[] = [];
  fx: Fx[] = [];
  floaters: Floater[] = [];
  emotes = new Map<number, { text: string; until: number }>();
  feed: { text: string; t: number; mine: boolean }[] = [];
  board: { myRank: number; rows: ScoreRow[] } | null = null;
  beaconSlot = -1;
  rtt = 0;
  // clock
  private offsets: number[] = [];
  offset = 0;
  haveClock = false;
  serverTickMs = 0;
  nextFireAt = 0;
  tickedOnce = false;
  killsSeen = 0;

  constructor(private hooks: Hooks) {
    this.ownStats = computeStats(0, []);
  }

  // ---- messages ------------------------------------------------------------------------
  welcome(m: WelcomeMsg) {
    this.slot = m.slot;
    this.world = generateWorld(m.seed);
    this.roster = new Map(m.roster.map((r) => [r.slot, r]));
    this.loadout = m.loadout;
    this.bracket = m.bracket;
    this.matchId = m.matchId;
    this.units.clear(); this.pellets.clear(); this.projectiles.clear(); this.ownPending = [];
    this.pending = []; this.seq = 0; this.own = null; this.wasAlive = false;
    this.setState(m.state);
    this.ownStats = computeStats(0, this.loadout);
  }
  setState(s: StateMsg) { this.state = s; this.stateAt = Date.now(); }
  setRoster(r: RosterEntry[]) { this.roster = new Map(r.map((x) => [x.slot, x])); }
  nameOf(slot: number) {
    const r = this.roster.get(slot);
    return r ? (r.bot ? `[BOT] ${r.name}` : r.name) : `#${slot}`;
  }

  /** Milliseconds left in the current phase, using the server's clock. */
  phaseLeftMs(): number {
    const s = this.state;
    if (!s || !s.phaseEndsAt) return 0;
    const serverNow = s.serverNow + (Date.now() - this.stateAt);
    return s.phaseEndsAt - serverNow;
  }

  // ---- snapshots -----------------------------------------------------------------------
  snapshot(s: Snapshot, perfNow: number) {
    const tickMs = s.tick * TICK_MS;
    this.serverTickMs = tickMs;
    // Server clock estimate: the largest (tick time minus arrival time) is the least delayed packet.
    this.offsets.push(tickMs - perfNow);
    if (this.offsets.length > 40) this.offsets.shift();
    const best = Math.max(...this.offsets);
    this.offset = this.haveClock ? this.offset + (best - this.offset) * 0.1 : best;
    this.haveClock = true;
    this.lastSnapSeq = s.seq;

    const prevOwn = this.own;
    this.own = s.own;
    const alive = (s.own.flags & OF_ALIVE) !== 0;
    const buffs = this.buffsOf(s.own.powerup);
    const prevTier = this.ownStats.tier;
    this.ownStats = computeStats(s.own.gs, this.loadout, buffs);
    void prevTier;
    this.reconcile(s, alive, prevOwn);
    this.wasAlive = alive;

    for (const u of s.units) {
      let tr = this.units.get(u.slot);
      if (!tr) { tr = { slot: u.slot, samples: [], last: u, flashUntil: 0 }; this.units.set(u.slot, tr); }
      tr.last = u;
      tr.samples.push({ t: tickMs, x: u.x, y: u.y, angle: u.angle, vx: u.vx, vy: u.vy });
      if (tr.samples.length > 14) tr.samples.shift();
    }
    for (const r of s.removedUnits) this.units.delete(r);
    for (const p of s.pelletAdds) this.pellets.set(p.id, { x: p.x, y: p.y });
    for (const id of s.pelletRemoves) this.pellets.delete(id);
    this.crates = s.crates;
    this.powerups = s.powerups;
    this.beaconSlot = (s.own.flags & OF_BEACON) ? this.slot : (s.units.find((u) => (u.flags & UF_BEACON) !== 0)?.slot ?? -1);
    for (const e of s.events) this.event(e, tickMs, perfNow);
  }

  private buffsOf(code: number) {
    const k = code > 0 ? POWERUP_ORDER[code - 1] : null;
    return { overdrive: k === 'overdrive', radar: k === 'radar', nitro: k === 'nitro' };
  }

  private reconcile(s: Snapshot, alive: boolean, prevOwn: SnapOwn | null) {
    if (!alive || !prevOwn || !this.wasAlive) {
      // dead, first snapshot, or just respawned: follow the server exactly
      this.pred.x = s.own.x; this.pred.y = s.own.y;
      this.prev.x = s.own.x; this.prev.y = s.own.y;
      this.err.x = 0; this.err.y = 0;
      this.pending = [];
      return;
    }
    while (this.pending.length && !isAfter(this.pending[0].seq, s.lastInput)) this.pending.shift();
    const before = { x: this.pred.x + this.err.x, y: this.pred.y + this.err.y };
    const p = { x: s.own.x, y: s.own.y };
    const speedFor = (m: InputMsg) => this.ownStats.speed * ((m.buttons & 2) ? 0.75 : 1);
    for (const m of this.pending) stepPosition(p, m.mx, m.my, speedFor(m), this.ownStats.radius, DT, this.world.walls);
    this.pred.x = p.x; this.pred.y = p.y;
    const ex = before.x - p.x, ey = before.y - p.y;
    if (Math.hypot(ex, ey) > 100) { this.err.x = 0; this.err.y = 0; this.prev.x = p.x; this.prev.y = p.y; }
    else { this.err.x = ex; this.err.y = ey; }
  }

  /** Called every 50 ms by the client: applies the input locally and queues it for sending. */
  predict(m: InputMsg): void {
    this.prev.x = this.pred.x; this.prev.y = this.pred.y;
    const st = this.ownStats;
    const p = { x: this.pred.x, y: this.pred.y };
    stepPosition(p, m.mx, m.my, st.speed * ((m.buttons & 2) ? 0.75 : 1), st.radius, DT, this.world.walls);
    this.pred.x = p.x; this.pred.y = p.y;
    this.pending.push(m);
    if (this.pending.length > 40) this.pending.shift();
  }

  decayError(dt: number) {
    const k = Math.exp(-dt / 0.1);
    this.err.x *= k; this.err.y *= k;
  }

  // ---- rendering helpers -------------------------------------------------------------------
  renderServerTime(perfNow: number) { return perfNow + this.offset - INTERP_MS; }

  ownPose(alpha: number): Pose {
    const x = this.prev.x + (this.pred.x - this.prev.x) * alpha + this.err.x;
    const y = this.prev.y + (this.pred.y - this.prev.y) * alpha + this.err.y;
    return { x, y, angle: this.pred.aim };
  }

  unitPose(tr: UnitTrack, rt: number): Pose {
    const s = tr.samples;
    if (s.length === 0) return { x: tr.last.x, y: tr.last.y, angle: tr.last.angle };
    if (rt <= s[0].t) return { x: s[0].x, y: s[0].y, angle: s[0].angle };
    for (let i = s.length - 1; i > 0; i--) {
      if (s[i - 1].t <= rt && rt <= s[i].t) {
        const k = (rt - s[i - 1].t) / Math.max(1, s[i].t - s[i - 1].t);
        const da = Math.atan2(Math.sin(s[i].angle - s[i - 1].angle), Math.cos(s[i].angle - s[i - 1].angle));
        return { x: s[i - 1].x + (s[i].x - s[i - 1].x) * k, y: s[i - 1].y + (s[i].y - s[i - 1].y) * k, angle: s[i - 1].angle + da * k };
      }
    }
    const l = s[s.length - 1];
    const ex = Math.min(INTERP_MS, rt - l.t) / 1000; // extrapolate for at most 100 ms, then hold
    return { x: l.x + l.vx * ex, y: l.y + l.vy * ex, angle: l.angle };
  }

  projPos(p: ProjTrack, perfNow: number): { x: number; y: number; age: number } {
    const ageMs = p.clock === 'local' ? perfNow - p.t0 + p.ageOffset : this.renderServerTime(perfNow) - p.t0 + p.ageOffset;
    const d = Math.min(p.range, (p.speed * Math.max(0, ageMs)) / 1000);
    return { x: p.x0 + p.dx * d, y: p.y0 + p.dy * d, age: ageMs };
  }

  private posOfSlot(slot: number): { x: number; y: number } | null {
    if (slot === this.slot && this.own) return { x: this.own.x, y: this.own.y };
    const t = this.units.get(slot);
    return t ? { x: t.last.x, y: t.last.y } : null;
  }

  // ---- events ---------------------------------------------------------------------------------
  private event(e: GameEvent, tickMs: number, perfNow: number) {
    const me = this.slot;
    switch (e.type) {
      case EV_PROJ: {
        const w = WEAPONS[e.weapon] ?? WEAPONS[0];
        const rm = e.owner === me ? this.ownStats.rangeMult : 1;
        this.fx.push({ kind: 'muzzle', x: e.x, y: e.y, t0: perfNow, life: 90, r: 14, color: 0xfff2c0 });
        if (e.owner === me) {
          const i = this.ownPending.findIndex((p) => p.weapon === e.weapon);
          if (i >= 0) {
            const lp = this.ownPending.splice(i, 1)[0];
            this.projectiles.delete(lp.id); // re-key the cosmetic shot with the server's id
            lp.id = e.id; lp.matched = true;
            this.projectiles.set(e.id, lp);
            break;
          }
          this.hooks.sound('shoot', e.x, e.y);
        } else this.hooks.sound('shoot', e.x, e.y);
        this.projectiles.set(e.id, {
          id: e.id, owner: e.owner, weapon: e.weapon, x0: e.x, y0: e.y, dx: Math.cos(e.angle), dy: Math.sin(e.angle), t0: tickMs, clock: 'server',
          speed: w.speed * rm, range: w.range * rm, ageOffset: e.age, matched: true
        });
        break;
      }
      case EV_PROJEND: {
        this.projectiles.delete(e.id);
        if (e.kind === END_EXPLODE) { this.fx.push({ kind: 'boom', x: e.x, y: e.y, t0: perfNow, life: 380, r: 70, color: 0xffb066 }); this.hooks.sound('boom', e.x, e.y); }
        else if (e.kind !== END_RANGE) this.fx.push({ kind: 'spark', x: e.x, y: e.y, t0: perfNow, life: 160, r: 10, color: e.kind === 2 ? 0xff8a80 : 0xcfd8dc });
        break;
      }
      case EV_HIT: {
        const tr = this.units.get(e.target);
        if (tr) tr.flashUntil = perfNow + 90;
        const pos = this.posOfSlot(e.target);
        if (pos) this.floaters.push({ x: pos.x, y: pos.y - 24, t0: perfNow, text: String(e.dmg), color: e.target === me ? 0xff8a80 : 0xffffff });
        if (e.target === me) { this.hooks.hurt(); this.hooks.sound('hurt', pos?.x ?? 0, pos?.y ?? 0); }
        else this.hooks.sound('hit', pos?.x ?? 0, pos?.y ?? 0);
        break;
      }
      case EV_KILL: {
        const vp = this.posOfSlot(e.victim);
        if (vp) this.fx.push({ kind: 'kill', x: vp.x, y: vp.y, t0: perfNow, life: 500, r: 60, color: 0xff6e40 });
        const killer = e.killer === 255 ? null : this.nameOf(e.killer);
        const text = killer ? `${killer} eliminated ${this.nameOf(e.victim)}${e.pts ? ` (+${e.pts})` : ''}` : `${this.nameOf(e.victim)} was eliminated`;
        this.feed.push({ text, t: perfNow, mine: e.killer === me || e.victim === me });
        if (this.feed.length > 5) this.feed.shift();
        if (e.killer === me && e.pts) { this.hooks.banner(`+${e.pts}`, `${this.nameOf(e.victim)} eliminated`); this.hooks.sound('kill', vp?.x ?? 0, vp?.y ?? 0); }
        if (e.victim === me) this.hooks.sound('death', vp?.x ?? 0, vp?.y ?? 0);
        break;
      }
      case EV_PICKUP: {
        if (e.slot !== me) break;
        if (e.kind === PICK_PELLET) this.hooks.sound('pickup', 0, 0);
        else if (e.kind === PICK_CRATE) { this.hooks.sound('crate', 0, 0); this.hooks.banner('+25', 'Crate destroyed'); }
        else if (e.kind === PICK_POWERUP) this.hooks.sound('crate', 0, 0);
        break;
      }
      case EV_TIER: {
        const p = this.posOfSlot(e.slot);
        if (p) this.fx.push({ kind: 'tier', x: p.x, y: p.y, t0: perfNow, life: 600, r: 80, color: 0x4fc3c8 });
        if (e.slot === me) {
          const w = weaponForTier(e.tier);
          this.hooks.banner(`Tier ${e.tier}`, `${w.name}${w.unlockTier === e.tier || (e.tier % 2 === 1) ? ' ready' : ''}`);
          this.hooks.sound('tier', 0, 0);
        }
        break;
      }
      case EV_EMOTE: this.emotes.set(e.slot, { text: EMOTES[e.emote] ?? '?', until: perfNow + 2200 }); break;
    }
  }

  prune(perfNow: number) {
    this.fx = this.fx.filter((f) => perfNow - f.t0 < f.life);
    this.floaters = this.floaters.filter((f) => perfNow - f.t0 < 800);
    this.feed = this.feed.filter((f) => perfNow - f.t < 7000);
    for (const [id, p] of this.projectiles) if (this.projPos(p, perfNow).age > (p.range / p.speed) * 1000 + 300) this.projectiles.delete(id);
    this.ownPending = this.ownPending.filter((p) => perfNow - p.t0 < 1200);
    for (const [s, e] of this.emotes) if (e.until < perfNow) this.emotes.delete(s);
  }
}
