import { MAP_SIZE } from './constants.js';
import type { EffectiveItem } from './formulas.js';

// ---- Message types ------------------------------------------------------------
export const C_INPUT = 1;
export const C_EMOTE = 2;
export const C_PING = 3;
export const S_SNAPSHOT = 16;
export const S_SCOREBOARD = 17;
export const S_PONG = 18;

export const BTN_FIRE = 1;
export const BTN_SCOPE = 2;

export const UF_PROTECTED = 1;
export const UF_SCOPING = 2;
export const UF_SHIELD = 4;
export const UF_BEACON = 8;

export const OF_ALIVE = 1;
export const OF_PROTECTED = 2;
export const OF_SCOPING = 4;
export const OF_SHIELD = 8;
export const OF_BEACON = 16;

export const EV_PROJ = 1;
export const EV_HIT = 2;
export const EV_PROJEND = 3;
export const EV_KILL = 4;
export const EV_PICKUP = 5;
export const EV_TIER = 6;
export const EV_EMOTE = 7;

export const END_RANGE = 0;
export const END_WALL = 1;
export const END_UNIT = 2;
export const END_EXPLODE = 3;
export const END_CRATE = 4;

export const PICK_PELLET = 0;
export const PICK_CRATE = 1;
export const PICK_POWERUP = 2;

export const EMOTES = ['gg', 'wow', 'help', 'thanks', 'oops', 'hi'] as const;

// ---- Rare JSON messages --------------------------------------------------------
export type Phase = 'forming' | 'warmup' | 'playing' | 'overtime' | 'ending' | 'results' | 'closed';
export interface RosterEntry { slot: number; name: string; bot: boolean; color: number }
export interface StateMsg {
  t: 'state';
  phase: Phase;
  phaseEndsAt: number; // server epoch ms, 0 when open ended
  matchEndsAt: number; // server epoch ms of the base timer
  serverNow: number;
  bracket: number;
  humans: number;
  bots: number;
  ring: number; // overtime ring radius, 0 when inactive
}
export interface WelcomeMsg {
  t: 'welcome';
  slot: number;
  roomId: string;
  matchId: string;
  bracket: number;
  seed: number;
  ruleset: number;
  level: number;
  roster: RosterEntry[];
  loadout: EffectiveItem[];
  dropped: { slot: string; item: string; reason: string }[];
  state: StateMsg;
}
export interface RosterMsg { t: 'roster'; roster: RosterEntry[] }
export interface ResultRow {
  slot: number; name: string; bot: boolean; rank: number; ms: number; kills: number; deaths: number; assists: number; maxTier: number;
}
export interface MyRewards {
  xp: number; credits: number; rp: number; crDelta: number; level: number; levelUp: boolean; xpToNext: number; xpInLevel: number; counted: boolean; note?: string;
}
export interface ResultsMsg { t: 'results'; rows: ResultRow[]; mine?: MyRewards; endReason: string; durationS: number }
export interface KickMsg { t: 'kick'; reason: string }
export interface ErrorMsg { t: 'error'; message: string }
export type ServerJson = WelcomeMsg | StateMsg | RosterMsg | ResultsMsg | KickMsg | ErrorMsg;
export interface HelloMsg { t: 'hello'; ticket: string; version: number }
export interface LeaveMsg { t: 'leave' }
export type ClientJson = HelloMsg | LeaveMsg;

// ---- Binary writer / reader ----------------------------------------------------
export class Writer {
  buf: Uint8Array;
  dv: DataView;
  pos = 0;
  constructor(size = 512) {
    this.buf = new Uint8Array(size);
    this.dv = new DataView(this.buf.buffer);
  }
  private ensure(n: number) {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const nb = new Uint8Array(size);
    nb.set(this.buf);
    this.buf = nb;
    this.dv = new DataView(nb.buffer);
  }
  u8(v: number) { this.ensure(1); this.dv.setUint8(this.pos, v & 255); this.pos += 1; }
  i8(v: number) { this.ensure(1); this.dv.setInt8(this.pos, Math.max(-128, Math.min(127, Math.round(v)))); this.pos += 1; }
  u16(v: number) { this.ensure(2); this.dv.setUint16(this.pos, Math.max(0, Math.min(65535, Math.round(v))), true); this.pos += 2; }
  u24(v: number) { this.ensure(3); const x = v & 0xffffff; this.dv.setUint8(this.pos, x & 255); this.dv.setUint8(this.pos + 1, (x >> 8) & 255); this.dv.setUint8(this.pos + 2, (x >> 16) & 255); this.pos += 3; }
  u32(v: number) { this.ensure(4); this.dv.setUint32(this.pos, Math.max(0, Math.min(4294967295, Math.round(v))) >>> 0, true); this.pos += 4; }
  bytes(): Uint8Array { return this.buf.subarray(0, this.pos); }
}
export class Reader {
  dv: DataView;
  pos = 0;
  constructor(public buf: Uint8Array) {
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  u8() { const v = this.dv.getUint8(this.pos); this.pos += 1; return v; }
  i8() { const v = this.dv.getInt8(this.pos); this.pos += 1; return v; }
  u16() { const v = this.dv.getUint16(this.pos, true); this.pos += 2; return v; }
  u24() { const v = this.dv.getUint8(this.pos) | (this.dv.getUint8(this.pos + 1) << 8) | (this.dv.getUint8(this.pos + 2) << 16); this.pos += 3; return v; }
  u32() { const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
  get left() { return this.buf.byteLength - this.pos; }
}

// Positions are 16-bit over 0..3200 wu (0.049 wu resolution).
const QP = 65535 / MAP_SIZE;
export const qpos = (v: number) => Math.round(Math.max(0, Math.min(MAP_SIZE, v)) * QP);
export const dqpos = (q: number) => q / QP;
const TAU = Math.PI * 2;
export const qangle8 = (a: number) => Math.round((((a % TAU) + TAU) % TAU) / TAU * 256) & 255;
export const dqangle8 = (q: number) => (q / 256) * TAU;
export const qangle16 = (a: number) => Math.round((((a % TAU) + TAU) % TAU) / TAU * 65536) & 65535;
export const dqangle16 = (q: number) => (q / 65536) * TAU;

// ---- INPUT (10 bytes) ----------------------------------------------------------
export interface InputMsg { seq: number; mx: number; my: number; aim: number; buttons: number; ack: number }
export function encodeInput(m: InputMsg): Uint8Array {
  const w = new Writer(10);
  w.u8(C_INPUT); w.u16(m.seq); w.i8(m.mx); w.i8(m.my); w.u16(qangle16(m.aim)); w.u8(m.buttons); w.u16(m.ack);
  return w.bytes();
}
export function decodeInput(buf: Uint8Array): InputMsg {
  const r = new Reader(buf);
  r.u8();
  const seq = r.u16(); const mx = r.i8(); const my = r.i8(); const aim = dqangle16(r.u16()); const buttons = r.u8(); const ack = r.u16();
  return { seq, mx, my, aim, buttons, ack };
}
export function encodePing(t: number): Uint8Array {
  const w = new Writer(5); w.u8(C_PING); w.u32(t); return w.bytes();
}
export function encodeEmote(id: number): Uint8Array {
  const w = new Writer(2); w.u8(C_EMOTE); w.u8(id); return w.bytes();
}
export function encodePong(clientT: number, serverMs: number): Uint8Array {
  const w = new Writer(9); w.u8(S_PONG); w.u32(clientT); w.u32(serverMs % 4294967295); return w.bytes();
}

// ---- SNAPSHOT --------------------------------------------------------------------
export interface SnapUnit {
  slot: number; x: number; y: number; angle: number; hpPct: number; tier: number; flags: number;
  radius: number; vx: number; vy: number; weapon: number; powerup: number;
}
export interface SnapOwn {
  x: number; y: number; hp: number; maxHp: number; shield: number; gs: number; ms: number; tier: number; flags: number;
  respawnMs: number; kills: number; deaths: number; assists: number; powerup: number; powerupLeft: number; rank: number;
}
export interface SnapCrate { id: number; x: number; y: number; hpPct: number }
export interface SnapPowerup { id: number; kind: number; x: number; y: number }
export type GameEvent =
  | { type: typeof EV_PROJ; id: number; owner: number; weapon: number; x: number; y: number; angle: number; age: number }
  | { type: typeof EV_HIT; target: number; dmg: number }
  | { type: typeof EV_PROJEND; id: number; x: number; y: number; kind: number }
  | { type: typeof EV_KILL; killer: number; victim: number; pts: number }
  | { type: typeof EV_PICKUP; kind: number; slot: number; ref: number }
  | { type: typeof EV_TIER; slot: number; tier: number }
  | { type: typeof EV_EMOTE; slot: number; emote: number };
export interface Snapshot {
  seq: number; tick: number; lastInput: number;
  own: SnapOwn;
  units: SnapUnit[];
  removedUnits: number[];
  pelletAdds: { id: number; x: number; y: number }[];
  pelletRemoves: number[];
  crates: SnapCrate[];
  powerups: SnapPowerup[];
  events: GameEvent[];
}

const SPEED_Q = 3; // wu/s per velocity step
export function encodeSnapshot(s: Snapshot): Uint8Array {
  const w = new Writer(1024);
  w.u8(S_SNAPSHOT); w.u16(s.seq); w.u24(s.tick); w.u16(s.lastInput);
  const o = s.own;
  w.u16(qpos(o.x)); w.u16(qpos(o.y)); w.u16(o.hp * 10); w.u16(o.maxHp * 10); w.u16(o.shield * 10);
  w.u32(o.gs * 10); w.u32(o.ms * 10); w.u8(o.tier); w.u8(o.flags); w.u16(o.respawnMs / 10);
  w.u16(o.kills); w.u16(o.deaths); w.u16(o.assists); w.u8(o.powerup); w.u8(o.powerupLeft * 10); w.u8(o.rank);
  w.u8(s.units.length);
  for (const u of s.units) {
    w.u8(u.slot); w.u16(qpos(u.x)); w.u16(qpos(u.y)); w.u8(qangle8(u.angle)); w.u8(u.hpPct);
    w.u8((u.tier & 15) | ((u.flags & 15) << 4)); w.u8(Math.round(u.radius * 6));
    w.i8(u.vx / SPEED_Q); w.i8(u.vy / SPEED_Q); w.u8((u.weapon & 7) | ((u.powerup & 7) << 3));
  }
  w.u8(s.removedUnits.length);
  for (const r of s.removedUnits) w.u8(r);
  w.u16(s.pelletAdds.length);
  for (const p of s.pelletAdds) { w.u16(p.id); w.u16(qpos(p.x)); w.u16(qpos(p.y)); }
  w.u16(s.pelletRemoves.length);
  for (const id of s.pelletRemoves) w.u16(id);
  w.u8(s.crates.length);
  for (const c of s.crates) { w.u8(c.id); w.u16(qpos(c.x)); w.u16(qpos(c.y)); w.u8(c.hpPct); }
  w.u8(s.powerups.length);
  for (const p of s.powerups) { w.u16(p.id); w.u8(p.kind); w.u16(qpos(p.x)); w.u16(qpos(p.y)); }
  w.u16(s.events.length);
  for (const e of s.events) {
    w.u8(e.type);
    switch (e.type) {
      case EV_PROJ: w.u16(e.id); w.u8(e.owner); w.u8(e.weapon); w.u16(qpos(e.x)); w.u16(qpos(e.y)); w.u16(qangle16(e.angle)); w.u8(Math.min(255, e.age / 10)); break;
      case EV_HIT: w.u8(e.target); w.u8(e.dmg); break;
      case EV_PROJEND: w.u16(e.id); w.u16(qpos(e.x)); w.u16(qpos(e.y)); w.u8(e.kind); break;
      case EV_KILL: w.u8(e.killer); w.u8(e.victim); w.u16(e.pts); break;
      case EV_PICKUP: w.u8(e.kind); w.u8(e.slot); w.u16(e.ref); break;
      case EV_TIER: w.u8(e.slot); w.u8(e.tier); break;
      case EV_EMOTE: w.u8(e.slot); w.u8(e.emote); break;
    }
  }
  return w.bytes();
}
export function decodeSnapshot(buf: Uint8Array): Snapshot {
  const r = new Reader(buf);
  r.u8();
  const seq = r.u16(); const tick = r.u24(); const lastInput = r.u16();
  const own: SnapOwn = {
    x: dqpos(r.u16()), y: dqpos(r.u16()), hp: r.u16() / 10, maxHp: r.u16() / 10, shield: r.u16() / 10,
    gs: r.u32() / 10, ms: r.u32() / 10, tier: r.u8(), flags: r.u8(), respawnMs: r.u16() * 10,
    kills: r.u16(), deaths: r.u16(), assists: r.u16(), powerup: r.u8(), powerupLeft: r.u8() / 10, rank: r.u8()
  };
  const units: SnapUnit[] = [];
  for (let n = r.u8(); n > 0; n--) {
    const slot = r.u8(); const x = dqpos(r.u16()); const y = dqpos(r.u16()); const angle = dqangle8(r.u8()); const hpPct = r.u8();
    const tf = r.u8(); const radius = r.u8() / 6; const vx = r.i8() * SPEED_Q; const vy = r.i8() * SPEED_Q; const wp = r.u8();
    units.push({ slot, x, y, angle, hpPct, tier: tf & 15, flags: tf >> 4, radius, vx, vy, weapon: wp & 7, powerup: wp >> 3 });
  }
  const removedUnits: number[] = [];
  for (let n = r.u8(); n > 0; n--) removedUnits.push(r.u8());
  const pelletAdds: Snapshot['pelletAdds'] = [];
  for (let n = r.u16(); n > 0; n--) pelletAdds.push({ id: r.u16(), x: dqpos(r.u16()), y: dqpos(r.u16()) });
  const pelletRemoves: number[] = [];
  for (let n = r.u16(); n > 0; n--) pelletRemoves.push(r.u16());
  const crates: SnapCrate[] = [];
  for (let n = r.u8(); n > 0; n--) crates.push({ id: r.u8(), x: dqpos(r.u16()), y: dqpos(r.u16()), hpPct: r.u8() });
  const powerups: SnapPowerup[] = [];
  for (let n = r.u8(); n > 0; n--) powerups.push({ id: r.u16(), kind: r.u8(), x: dqpos(r.u16()), y: dqpos(r.u16()) });
  const events: GameEvent[] = [];
  for (let n = r.u16(); n > 0; n--) {
    const type = r.u8();
    switch (type) {
      case EV_PROJ: events.push({ type, id: r.u16(), owner: r.u8(), weapon: r.u8(), x: dqpos(r.u16()), y: dqpos(r.u16()), angle: dqangle16(r.u16()), age: r.u8() * 10 }); break;
      case EV_HIT: events.push({ type, target: r.u8(), dmg: r.u8() }); break;
      case EV_PROJEND: events.push({ type, id: r.u16(), x: dqpos(r.u16()), y: dqpos(r.u16()), kind: r.u8() }); break;
      case EV_KILL: events.push({ type, killer: r.u8(), victim: r.u8(), pts: r.u16() }); break;
      case EV_PICKUP: events.push({ type, kind: r.u8(), slot: r.u8(), ref: r.u16() }); break;
      case EV_TIER: events.push({ type, slot: r.u8(), tier: r.u8() }); break;
      case EV_EMOTE: events.push({ type, slot: r.u8(), emote: r.u8() }); break;
      default: throw new Error('bad event ' + type);
    }
  }
  return { seq, tick, lastInput, own, units, removedUnits, pelletAdds, pelletRemoves, crates, powerups, events };
}

// ---- SCOREBOARD (8 bytes per row) -------------------------------------------------
export interface ScoreRow { slot: number; tier: number; ms: number; kills: number }
export function encodeScoreboard(myRank: number, rows: ScoreRow[]): Uint8Array {
  const w = new Writer(4 + rows.length * 8);
  w.u8(S_SCOREBOARD); w.u16(myRank); w.u8(rows.length);
  for (const r of rows) { w.u8(r.slot); w.u8(r.tier); w.u32(r.ms); w.u16(r.kills); }
  return w.bytes();
}
export function decodeScoreboard(buf: Uint8Array): { myRank: number; rows: ScoreRow[] } {
  const r = new Reader(buf);
  r.u8();
  const myRank = r.u16();
  const rows: ScoreRow[] = [];
  for (let n = r.u8(); n > 0; n--) rows.push({ slot: r.u8(), tier: r.u8(), ms: r.u32(), kills: r.u16() });
  return { myRank, rows };
}
export function decodePong(buf: Uint8Array): { clientT: number; serverMs: number } {
  const r = new Reader(buf);
  r.u8();
  return { clientT: r.u32(), serverMs: r.u32() };
}
