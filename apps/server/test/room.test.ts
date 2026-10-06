import { describe, expect, it } from 'vitest';
import {
  BTN_FIRE, BRACKETS, EV_PROJ, MAP_SIZE, S_SCOREBOARD, S_SNAPSHOT, decodeScoreboard, decodeSnapshot, fitLoadout, tierFor,
  type MyRewards, type ServerJson, type Snapshot
} from '@war/shared';
import { Room, type Link, type MatchResult } from '../src/room.js';

class FakeLink implements Link {
  rtt = 40;
  json: ServerJson[] = [];
  snaps: Snapshot[] = [];
  boards = 0;
  closed = false;
  send(data: Uint8Array | string) {
    if (typeof data === 'string') this.json.push(JSON.parse(data));
    else if (data[0] === S_SNAPSHOT) this.snaps.push(decodeSnapshot(data));
    else if (data[0] === S_SCOREBOARD) { decodeScoreboard(data); this.boards++; }
  }
  close() { this.closed = true; }
}

function makeRoom(timeScale: number, bracketIdx = 1, onFinish?: (r: MatchResult) => Map<string, MyRewards>) {
  const bracket = BRACKETS[bracketIdx];
  const room = new Room({ id: 'r1', matchId: 'm1', bracket, seed: 12345, timeScale, onFinish });
  const link = new FakeLink();
  const me = room.join({
    accountId: 'acc1', name: 'Tester', level: bracket.minLevel, cr: 1000, link,
    fit: fitLoadout(bracket.minLevel, bracket, {}, {})
  })!;
  return { room, link, me, bracket };
}

describe('room lifecycle', () => {
  it('runs forming, warmup, playing and results with bots, and stays sane', () => {
    let finished: MatchResult | null = null;
    const { room, link, me } = makeRoom(24, 1, (r) => { finished = r; return new Map(); });
    const seen: string[] = [];
    let lastMs = new Map<number, number>();
    let seq = 0;
    for (let i = 0; i < 3000 && !room.closed; i++) {
      if (seen[seen.length - 1] !== room.phase) seen.push(room.phase);
      // the human wanders and fires so projectiles, hits and pickups get exercised
      room.receiveInput(me, { seq: ++seq & 0xffff, mx: Math.round(Math.cos(i / 20) * 127), my: Math.round(Math.sin(i / 25) * 127), aim: i / 15, buttons: BTN_FIRE, ack: 0 });
      room.step();
      for (const u of room.units) {
        if (!u) continue;
        expect(Number.isFinite(u.x) && Number.isFinite(u.y)).toBe(true);
        expect(u.x).toBeGreaterThanOrEqual(0);
        expect(u.x).toBeLessThanOrEqual(MAP_SIZE);
        expect(u.y).toBeGreaterThanOrEqual(0);
        expect(u.y).toBeLessThanOrEqual(MAP_SIZE);
        expect(u.ms).toBeGreaterThanOrEqual(lastMs.get(u.slot) ?? 0);
        expect(tierFor(u.gs)).toBe(u.tier);
        expect(u.gs).toBeLessThanOrEqual(u.ms + 1e-6);
        lastMs.set(u.slot, u.ms);
      }
    }
    expect(seen).toEqual(['forming', 'warmup', 'playing', 'ending', 'results']);
    expect(room.closed).toBe(true);
    expect(finished).not.toBeNull();
    const res = finished as unknown as MatchResult;
    expect(res.players.length).toBeGreaterThanOrEqual(12);
    expect(res.players.some((p) => p.accountId === 'acc1')).toBe(true);
    for (let i = 1; i < res.players.length; i++) expect(res.players[i - 1].ms).toBeGreaterThanOrEqual(res.players[i].ms);
    expect(link.snaps.length).toBeGreaterThan(50);
    expect(link.boards).toBeGreaterThan(5);
    expect(link.json.some((m) => m.t === 'welcome')).toBe(true);
    expect(link.json.some((m) => m.t === 'results')).toBe(true);
  });

  it('bots fill the room to at least 12 players at the start', () => {
    const { room } = makeRoom(24);
    for (let i = 0; i < 200 && room.phase === 'forming'; i++) room.step();
    expect(room.phase).toBe('warmup');
    expect(room.count()).toBe(12);
    expect(room.bots().length).toBe(11);
  });

  it('no damage and no scoring happen during warm-up', () => {
    const { room } = makeRoom(2);
    for (let i = 0; i < 20 * 25; i++) {
      room.step();
      if (room.phase === 'warmup') for (const u of room.units) if (u) { expect(u.ms).toBe(0); expect(u.hp).toBeCloseTo(u.maxHp, 5); }
      if (room.phase === 'playing') break;
    }
    expect(room.phase).toBe('playing');
  });

  it('a lone human who leaves aborts the room', () => {
    const { room, me } = makeRoom(24);
    for (let i = 0; i < 60; i++) room.step();
    room.disconnect(me);
    for (let i = 0; i < 3000 && room.phase !== 'ending' && !room.closed; i++) room.step();
    expect(['ending', 'results', 'closed']).toContain(room.phase);
  });

  it('a late joiner enters at the median Tier minus 2, with zero score', () => {
    const { room } = makeRoom(24, 2);
    for (let i = 0; i < 20 * 3 && room.phase !== 'playing'; i++) room.step();
    expect(room.phase).toBe('playing');
    for (let i = 0; i < 40; i++) room.step();
    const link2 = new FakeLink();
    const bracket = BRACKETS[2];
    expect(room.canJoin()).toBe(true);
    const u = room.join({ accountId: 'acc2', name: 'Late', level: 20, cr: 1000, link: link2, fit: fitLoadout(20, bracket, {}, {}) })!;
    expect(u.ms).toBe(0);
    expect(u.tier).toBeLessThanOrEqual(4);
    expect(u.protectedUntil).toBeGreaterThan(room.time);
  });

  it('fires at the design rate: 3.0 shots per second for the Rifle Cannon, and +10% fire rate shows up', () => {
    const shots = (probe?: number) => {
      const { room, link, me } = makeRoom(24, 1);
      if (probe) { me.probe = { fireRate: probe }; (room as unknown as { refreshStats(u: typeof me): void }).refreshStats(me); }
      room.startPlayingNow({ lengthS: 3600 });
      me.x = 1600; me.y = 1600;
      let seq = 0;
      for (let i = 0; i < 20 * 30; i++) {
        room.receiveInput(me, { seq: ++seq & 0xffff, mx: 0, my: 0, aim: 0, buttons: BTN_FIRE, ack: 0 });
        room.step();
      }
      return link.snaps.flatMap((s) => s.events).filter((e) => e.type === EV_PROJ && e.owner === me.slot).length;
    };
    const base = shots();
    expect(base).toBeGreaterThan(90 * 0.95);
    expect(base).toBeLessThan(90 * 1.05);
    // the old 20 Hz rounding made this +10% invisible
    expect(shots(10)).toBeGreaterThan(base * 1.07);
  });

  it('the late-join window closes at 40 percent of the base length', () => {
    const { room, bracket } = makeRoom(24, 1);
    let guard = 0;
    while (room.phase !== 'playing' && guard++ < 2000) room.step();
    expect(room.canJoin()).toBe(true);
    const closeAfterTicks = Math.ceil((bracket.baseLenS * 0.4 * 20) / 24) + 5;
    for (let i = 0; i < closeAfterTicks; i++) room.step();
    expect(room.canJoin()).toBe(false);
  });
});
