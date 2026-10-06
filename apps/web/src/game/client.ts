import {
  AIM_TURN_RATE, DT, TICK_MS, WEAPONS, decodePong, decodeScoreboard, decodeSnapshot, encodeEmote, encodeInput, encodePing, S_PONG, S_SCOREBOARD,
  S_SNAPSHOT, rotateToward, type ResultsMsg, type ServerJson
} from '@war/shared';
import { h } from '../ui.js';
import { Hud } from './hud.js';
import { InputController } from './input.js';
import { Renderer } from './render.js';
import { play, unlockAudio } from './sfx.js';
import { ClientWorld, type ProjTrack } from './state.js';

export interface GameOpts {
  ticket: string;
  onResults(msg: ResultsMsg, matchId: string): void;
  onExit(reason: 'left' | 'disconnected' | 'error' | 'kicked', message?: string): void;
}

/** Owns the socket, the input loop, the renderer and the HUD for one match. */
export class GameClient {
  readonly cw: ClientWorld;
  private ws: WebSocket | null = null;
  private renderer = new Renderer();
  private hud!: Hud;
  private input!: InputController;
  private stage = h('div', { id: 'stage' });
  private acc = 0;
  private pingTimer = 0;
  private closed = false;
  private gotResults = false;
  private scoping = false;
  private lastOwnFire = 0;
  private localSeq = 0;
  private tempId = -1;
  private fps = 60;

  constructor(private opts: GameOpts) {
    this.cw = new ClientWorld({
      sound: (kind, x, y) => {
        const own = this.cw.own;
        const d = own && (x || y) ? Math.hypot(x - own.x, y - own.y) : 0;
        play(kind, d);
      },
      banner: (t, s) => this.hud?.showBanner(t, s),
      hurt: () => this.hud?.hurt()
    });
  }

  async start() {
    document.body.append(this.stage);
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    await this.renderer.init(this.stage);
    this.hud = new Hud(document.body, {
      onLeave: () => this.leave(),
      onResume: () => this.hud.toggleMenu(false),
      onLowHealth: () => play('low', 0)
    });
    this.input = new InputController(this.stage, {
      emote: (i) => { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encodeEmote(i)); },
      menu: () => { this.hud.toggleMenu(); },
      autoFireChanged: () => {}
    });
    this.connect();
    this.renderer.app.ticker.add((t) => this.frame(t.deltaMS));
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'hello', ticket: this.opts.ticket, version: 1 }));
      this.pingTimer = window.setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(encodePing(Math.floor(performance.now()) >>> 0)); }, 1000);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') return this.json(JSON.parse(ev.data) as ServerJson);
      const b = new Uint8Array(ev.data as ArrayBuffer);
      switch (b[0]) {
        case S_SNAPSHOT: this.cw.snapshot(decodeSnapshot(b), performance.now()); break;
        case S_SCOREBOARD: this.cw.board = decodeScoreboard(b); break;
        case S_PONG: {
          const p = decodePong(b);
          const rtt = (performance.now() >>> 0) - p.clientT;
          if (rtt >= 0 && rtt < 5000) this.cw.rtt = this.cw.rtt ? this.cw.rtt * 0.7 + rtt * 0.3 : rtt;
          break;
        }
        default:
      }
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.closed) return;
      this.closed = true;
      this.opts.onExit(this.gotResults ? 'left' : 'disconnected');
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  private json(m: ServerJson) {
    switch (m.t) {
      case 'welcome': this.cw.welcome(m); this.renderer.buildMap(this.cw.world); break;
      case 'state': this.cw.setState(m); break;
      case 'roster': this.cw.setRoster(m.roster); break;
      case 'results': this.gotResults = true; this.opts.onResults(m, this.cw.matchId); break;
      case 'kick': this.closed = true; this.opts.onExit('kicked', m.reason); break;
      case 'error': this.closed = true; this.opts.onExit('error', m.message); break;
    }
  }

  leave() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'leave' }));
    this.closed = true;
    this.opts.onExit('left');
  }

  // ---- the frame ----------------------------------------------------------------------------
  private frame(deltaMs: number) {
    const now = performance.now();
    const dt = Math.min(0.1, deltaMs / 1000);
    this.fps += (1000 / Math.max(1, deltaMs) - this.fps) * 0.05;
    const cw = this.cw;
    const ready = !!cw.world && !!cw.own;
    this.acc = Math.min(this.acc + deltaMs, 250);
    while (this.acc >= TICK_MS) { this.acc -= TICK_MS; if (ready) this.stepInput(now); }
    cw.decayError(dt);
    cw.prune(now);
    this.renderer.frame(cw, now, dt, this.acc / TICK_MS, this.scoping, !!cw.world);
    if (ready) this.hud.update(cw, now, this.fps, { tab: this.input.tabHeld, emote: this.input.emoteHeld, autoFire: this.input.autoFire, scoping: this.scoping });
  }

  private canAct() {
    const cw = this.cw;
    const ph = cw.state?.phase;
    return !!cw.own && (cw.own.flags & 1) !== 0 && ph !== 'ending' && ph !== 'results' && ph !== 'closed' && !this.hud.menuOpen;
  }

  private stepInput(now: number) {
    const cw = this.cw;
    if (!this.canAct()) { this.scoping = false; return; }
    const pose = cw.ownPose(1);
    const r = this.renderer;
    const center = { x: r.w / 2 + (pose.x - r.cam.x) * r.scale, y: r.h / 2 + (pose.y - r.cam.y) * r.scale };
    const s = this.input.sample(center);
    const aim = s.hasAim ? s.aim : cw.pred.aim;
    cw.pred.aim = aim;
    const st = cw.ownStats;
    let fire = s.fire;
    if (!fire && this.input.autoFire) fire = this.autoFireTarget(aim, pose);
    this.scoping = s.scope && st.scope > 0;
    const buttons = (fire ? 1 : 0) | (this.scoping ? 2 : 0);
    this.localSeq = (this.localSeq % 65535) + 1;
    const msg = { seq: this.localSeq, mx: s.mx, my: s.my, aim, buttons, ack: cw.lastSnapSeq };
    cw.predict(msg);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encodeInput(msg));
    const ph = cw.state?.phase;
    if (fire && (ph === 'playing' || ph === 'overtime')) this.localFire(now, aim);
    void AIM_TURN_RATE; void DT; void rotateToward;
  }

  /** Auto-fire: shoots when an enemy is in range and within 12 degrees of the aim. It never aims for you. */
  private autoFireTarget(aim: number, pose: { x: number; y: number }): boolean {
    const cw = this.cw;
    const range = cw.ownStats.weapon.range * cw.ownStats.rangeMult * 0.95;
    const rt = cw.renderServerTime(performance.now());
    for (const tr of cw.units.values()) {
      if (tr.last.flags & 1) continue; // spawn-protected
      const p = cw.unitPose(tr, rt);
      const d = Math.hypot(p.x - pose.x, p.y - pose.y);
      if (d > range) continue;
      const diff = Math.abs(Math.atan2(Math.sin(Math.atan2(p.y - pose.y, p.x - pose.x) - aim), Math.cos(Math.atan2(p.y - pose.y, p.x - pose.x) - aim)));
      if (diff < 0.21) return true;
    }
    return false;
  }

  /** The shot is drawn at once. The server's projectile event adopts it so the shot never shows twice. */
  private localFire(now: number, aim: number) {
    const cw = this.cw;
    const st = cw.ownStats;
    if (now < this.lastOwnFire) return;
    const w = st.weapon;
    this.lastOwnFire = now + 1000 / (w.rate * st.fireMult);
    const pose = cw.ownPose(1);
    play('shoot', 0);
    for (const pel of w.pellets) {
      const a = aim + pel.angle;
      const nx = -Math.sin(aim), ny = Math.cos(aim);
      const t: ProjTrack = {
        id: this.tempId--, owner: cw.slot, weapon: w.id,
        x0: pose.x + Math.cos(aim) * (st.radius + 2) + nx * pel.lateral, y0: pose.y + Math.sin(aim) * (st.radius + 2) + ny * pel.lateral,
        dx: Math.cos(a), dy: Math.sin(a), t0: now, clock: 'local', speed: w.speed * st.rangeMult, range: w.range * st.rangeMult, ageOffset: 0, matched: false
      };
      cw.projectiles.set(t.id, t);
      cw.ownPending.push(t);
    }
    void WEAPONS;
  }

  stop() {
    this.closed = true;
    clearInterval(this.pingTimer);
    try { this.ws?.close(); } catch { /* already closed */ }
    this.input?.destroy();
    this.hud?.destroy();
    this.renderer.destroy();
    this.stage.remove();
  }
}
