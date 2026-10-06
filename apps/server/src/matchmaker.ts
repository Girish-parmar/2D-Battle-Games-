import { randomInt, randomUUID } from 'node:crypto';
import { BRACKETS, PLAY_DOWN_OFFER_S, queueWindow, type BracketDef } from '@war/shared';
import { sign, verify } from './auth.js';
import { applyMatchResult } from './economy.js';
import { Room } from './room.js';
import type { Store } from './store.js';

export interface Ticket {
  id: string;
  accountId: string;
  level: number;
  bracket: number; // the player's own bracket
  target: number; // the bracket they will play in (one lower after accepting play-down)
  cr: number;
  queuedAt: number;
  seat?: { roomId: string; bracket: number };
  seatedAt?: number;
  offerDown: boolean;
  downBracket?: number;
}

export type QueueStatus =
  | { state: 'waiting'; waitS: number; window: number; queued: number; offerDown: boolean; downBracket?: number }
  | { state: 'ready'; roomId: string; roomTicket: string; bracket: number; playDown: boolean }
  | { state: 'gone' };

const HOLD_BRACKET = 4; // Elite and Warlord rooms wait for company before forming

export class Matchmaker {
  readonly rooms = new Map<string, Room>();
  private tickets = new Map<string, Ticket>();
  private byAccount = new Map<string, string>();
  private jti = new Map<string, number>();

  constructor(private store: Store, private secret: string, private timeScale = 1) {}

  // ---- queue ---------------------------------------------------------------------------
  /** A player who still owns a unit in a live room is sent straight back to it. */
  private reconnectTarget(accountId: string): Room | undefined {
    for (const r of this.rooms.values()) if (!r.closed && r.findOwned(accountId)) return r;
    return undefined;
  }

  join(accountId: string): Ticket | { error: string } {
    const prof = this.store.profile(accountId);
    if (!prof) return { error: 'no such account' };
    const ban = this.store.isBanned(accountId);
    if (ban) return { error: `account suspended until ${new Date(ban.until).toISOString().slice(0, 10)}` };
    const existing = this.byAccount.get(accountId);
    if (existing && this.tickets.has(existing)) return this.tickets.get(existing)!;
    const bracket = BRACKETS.find((b) => prof.level >= b.minLevel && prof.level <= b.maxLevel)!;
    const t: Ticket = { id: randomUUID(), accountId, level: prof.level, bracket: bracket.id, target: bracket.id, cr: prof.cr, queuedAt: Date.now(), offerDown: false };
    const back = this.reconnectTarget(accountId);
    if (back) { t.seat = { roomId: back.id, bracket: back.bracket.id }; t.seatedAt = Date.now(); t.target = back.bracket.id; }
    this.tickets.set(t.id, t);
    this.byAccount.set(accountId, t.id);
    return t;
  }

  private issueRoomTicket(accountId: string, roomId: string): string {
    return sign({ typ: 'room', sub: accountId, room: roomId, jti: randomUUID() }, this.secret, 60);
  }

  status(id: string, accountId: string): QueueStatus {
    const t = this.tickets.get(id);
    if (!t || t.accountId !== accountId) return { state: 'gone' };
    if (t.seat) {
      const room = this.rooms.get(t.seat.roomId);
      if (!room || room.closed) { this.drop(t); return { state: 'gone' }; }
      return { state: 'ready', roomId: t.seat.roomId, roomTicket: this.issueRoomTicket(accountId, t.seat.roomId), bracket: t.seat.bracket, playDown: t.seat.bracket < t.bracket };
    }
    const waitS = (Date.now() - t.queuedAt) / 1000;
    return { state: 'waiting', waitS, window: queueWindow(waitS), queued: this.compatible(t).length + 1, offerDown: t.offerDown, downBracket: t.downBracket };
  }

  cancel(id: string, accountId: string) {
    const t = this.tickets.get(id);
    if (t && t.accountId === accountId) this.drop(t);
  }
  acceptDown(id: string, accountId: string): boolean {
    const t = this.tickets.get(id);
    if (!t || t.accountId !== accountId || !t.offerDown || !t.downBracket) return false;
    t.target = t.downBracket;
    t.offerDown = false;
    return true;
  }
  private drop(t: Ticket) {
    this.tickets.delete(t.id);
    if (this.byAccount.get(t.accountId) === t.id) this.byAccount.delete(t.accountId);
  }

  private compatible(t: Ticket): Ticket[] {
    const w = queueWindow((Date.now() - t.queuedAt) / 1000);
    return [...this.tickets.values()].filter((o) => o !== t && !o.seat && o.target === t.target && Math.abs(o.cr - t.cr) <= w);
  }

  private medianCr(room: Room, fallback: number): number {
    const crs = room.humans().filter((u) => u.leftAt < 0).map((u) => u.cr).sort((a, b) => a - b);
    return crs.length ? crs[Math.floor(crs.length / 2)] : fallback;
  }

  createRoom(bracket: BracketDef): Room {
    const id = randomUUID().slice(0, 8);
    const room = new Room({
      id, matchId: randomUUID(), bracket, seed: randomInt(1, 2 ** 31 - 1), timeScale: this.timeScale,
      onFinish: (r) => applyMatchResult(this.store, r)
    });
    this.rooms.set(id, room);
    return room;
  }

  /** Runs once a second (Section 6). */
  tick() {
    const now = Date.now();
    const waiting = [...this.tickets.values()].filter((t) => !t.seat).sort((a, b) => a.queuedAt - b.queuedAt);
    for (const t of waiting) {
      const waitS = (now - t.queuedAt) / 1000;
      const window = queueWindow(waitS);
      let best: Room | null = null;
      let bd = Infinity;
      for (const r of this.rooms.values()) {
        if (r.closed || r.bracket.id !== t.target || !r.canJoin()) continue;
        const d = Math.abs(this.medianCr(r, t.cr) - t.cr);
        if (d <= window && d < bd) { bd = d; best = r; }
      }
      if (best) { this.seat(t, best); continue; }
      const bracket = BRACKETS[t.target - 1];
      if (bracket.id >= HOLD_BRACKET && t.target === t.bracket && waitS < PLAY_DOWN_OFFER_S && this.compatible(t).length < 2) continue;
      if (bracket.id >= HOLD_BRACKET && t.target === t.bracket && waitS >= PLAY_DOWN_OFFER_S && !t.offerDown && t.bracket > 1) {
        const lower = [...this.rooms.values()].find((r) => !r.closed && r.bracket.id === t.bracket - 1 && r.canJoin() && r.humans().length >= 1);
        if (lower) { t.offerDown = true; t.downBracket = lower.bracket.id; }
      }
      if (t.offerDown && waitS < PLAY_DOWN_OFFER_S + 15) continue; // give the player 15 s to answer the offer
      this.seat(t, this.createRoom(bracket));
    }
    for (const [id, t] of this.tickets) if (t.seatedAt && now - t.seatedAt > 120_000) { this.tickets.delete(id); if (this.byAccount.get(t.accountId) === id) this.byAccount.delete(t.accountId); }
    for (const [j, exp] of this.jti) if (exp < now) this.jti.delete(j);
  }

  private seat(t: Ticket, room: Room) {
    t.seat = { roomId: room.id, bracket: room.bracket.id };
    t.seatedAt = Date.now();
  }

  /** Verifies a room ticket once. Returns the account and room, or null. */
  consumeRoomTicket(token: string): { accountId: string; room: Room } | null {
    const p = verify<{ typ: string; sub: string; room: string; jti: string }>(token, this.secret);
    if (!p || p.typ !== 'room' || this.jti.has(p.jti)) return null;
    this.jti.set(p.jti, Date.now() + 90_000);
    const room = this.rooms.get(p.room);
    return room && !room.closed ? { accountId: p.sub, room } : null;
  }

  /** Step every room once. A room that throws is closed so it cannot take the others down. */
  stepRooms(log: (m: string) => void) {
    for (const [id, room] of this.rooms) {
      try { room.step(); } catch (e) {
        log(`room ${id} crashed: ${(e as Error).stack}`);
        room.forceClose('server error');
      }
      if (room.closed) this.rooms.delete(id);
    }
  }

  stats() {
    let players = 0, bots = 0;
    let tickMs = 0, tickMax = 0;
    for (const r of this.rooms.values()) {
      players += r.humans().filter((u) => u.connected).length;
      bots += r.bots().length;
      tickMs = Math.max(tickMs, r.tickMsEma);
      tickMax = Math.max(tickMax, r.tickMsMax);
    }
    return { rooms: this.rooms.size, players, bots, queued: [...this.tickets.values()].filter((t) => !t.seat).length, tickMsEma: +tickMs.toFixed(3), tickMsMax: +tickMax.toFixed(3) };
  }
}
