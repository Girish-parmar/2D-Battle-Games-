import { describe, expect, it } from 'vitest';
import {
  EV_HIT, EV_KILL, EV_PICKUP, EV_PROJ, EV_PROJEND, EV_TIER, MAP_SIZE, decodeInput, decodeScoreboard, decodeSnapshot, encodeInput, encodeScoreboard,
  encodeSnapshot, generateWorld, mulberry32, pushOutOfWalls, segCircle, segRect, stepPosition, type Snapshot
} from '../src/index.js';

describe('input codec', () => {
  it('is 10 bytes and round trips', () => {
    const b = encodeInput({ seq: 65535, mx: -127, my: 127, aim: 3.0, buttons: 3, ack: 1234 });
    expect(b.length).toBe(10);
    const m = decodeInput(b);
    expect(m.seq).toBe(65535);
    expect(m.mx).toBe(-127);
    expect(m.my).toBe(127);
    expect(m.aim).toBeCloseTo(3.0, 3);
    expect(m.buttons).toBe(3);
    expect(m.ack).toBe(1234);
  });
});

describe('snapshot codec', () => {
  const snap: Snapshot = {
    seq: 77, tick: 123456, lastInput: 900,
    own: { x: 1600.5, y: 20.25, hp: 142.4, maxHp: 156.3, shield: 12, gs: 520.4, ms: 640.2, tier: 4, flags: 5, respawnMs: 3500, kills: 3, deaths: 1, assists: 2, powerup: 1, powerupLeft: 6.3, rank: 11 },
    units: [{ slot: 3, x: 800.1, y: 2200.9, angle: 1.5, hpPct: 200, tier: 6, flags: 9, radius: 29.4, vx: 150, vy: -90, weapon: 2, powerup: 3 }],
    removedUnits: [5, 9],
    pelletAdds: [{ id: 449, x: 10, y: 3190 }],
    pelletRemoves: [1, 2, 3],
    crates: [{ id: 7, x: 1500, y: 1700, hpPct: 128 }],
    powerups: [{ id: 300, kind: 2, x: 1612, y: 1633 }],
    events: [
      { type: EV_PROJ, id: 4000, owner: 3, weapon: 1, x: 100, y: 200, angle: 2.2, age: 40 },
      { type: EV_HIT, target: 3, dmg: 12 },
      { type: EV_PROJEND, id: 4000, x: 500, y: 600, kind: 2 },
      { type: EV_KILL, killer: 3, victim: 4, pts: 275 },
      { type: EV_PICKUP, kind: 0, slot: 3, ref: 12 },
      { type: EV_TIER, slot: 3, tier: 7 }
    ]
  };
  it('round trips within quantisation error', () => {
    const d = decodeSnapshot(encodeSnapshot(snap));
    expect(d.seq).toBe(77);
    expect(d.tick).toBe(123456);
    expect(d.lastInput).toBe(900);
    expect(d.own.x).toBeCloseTo(1600.5, 1);
    expect(d.own.hp).toBeCloseTo(142.4, 1);
    expect(d.own.tier).toBe(4);
    expect(d.own.powerupLeft).toBeCloseTo(6.3, 1);
    expect(d.units[0].slot).toBe(3);
    expect(d.units[0].x).toBeCloseTo(800.1, 1);
    expect(d.units[0].tier).toBe(6);
    expect(d.units[0].flags).toBe(9);
    expect(d.units[0].weapon).toBe(2);
    expect(d.units[0].powerup).toBe(3);
    expect(d.removedUnits).toEqual([5, 9]);
    expect(d.pelletAdds[0].id).toBe(449);
    expect(d.pelletRemoves).toEqual([1, 2, 3]);
    expect(d.crates[0].id).toBe(7);
    expect(d.powerups[0].kind).toBe(2);
    expect(d.events.length).toBe(6);
    expect(d.events[3]).toEqual({ type: EV_KILL, killer: 3, victim: 4, pts: 275 });
  });
  it('a typical snapshot is near the design budget of 92 bytes plus events', () => {
    const typical: Snapshot = {
      ...snap, pelletAdds: [], pelletRemoves: [], crates: [], powerups: [], events: [],
      units: Array.from({ length: 6 }, (_, i) => ({ ...snap.units[0], slot: i }))
    };
    const n = encodeSnapshot(typical).length;
    expect(n).toBeLessThan(140);
  });
  it('scoreboard rows are 8 bytes', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ slot: i, tier: 5, ms: 1000 + i, kills: i }));
    const b = encodeScoreboard(11, rows);
    expect(b.length).toBe(4 + 80);
    const d = decodeScoreboard(b);
    expect(d.myRank).toBe(11);
    expect(d.rows[9]).toEqual({ slot: 9, tier: 5, ms: 1009, kills: 9 });
  });
});

describe('world and movement', () => {
  it('the world is deterministic from the seed', () => {
    const a = generateWorld(42);
    const b = generateWorld(42);
    expect(a).toEqual(b);
    expect(a.walls.length).toBe(40);
    expect(a.pads.length).toBe(16);
    expect(a.crates.length).toBe(10);
    expect(generateWorld(43).walls[0]).not.toEqual(a.walls[0]);
  });
  it('rng is stable', () => {
    const r = mulberry32(1);
    expect(r()).toBeCloseTo(0.6270739405881613, 10);
  });
  it('units cannot leave the map or enter walls', () => {
    const w = generateWorld(7);
    const p = { x: 5, y: 5 };
    for (let i = 0; i < 100; i++) stepPosition(p, -127, -127, 240, 16, 0.05, w.walls);
    expect(p.x).toBeGreaterThanOrEqual(16);
    expect(p.y).toBeGreaterThanOrEqual(16);
    const wall = w.walls[0];
    const q = { x: wall.x + wall.w / 2, y: wall.y + wall.h / 2 };
    pushOutOfWalls(q, 20, w.walls);
    const inside = q.x > wall.x && q.x < wall.x + wall.w && q.y > wall.y && q.y < wall.y + wall.h;
    expect(inside).toBe(false);
  });
  it('diagonal speed is normalised', () => {
    const p = { x: 1600, y: 1600 };
    const v = stepPosition(p, 127, 127, 240, 16, 0.05, []);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(240, 3);
    expect(p.x).toBeLessThanOrEqual(MAP_SIZE);
  });
  it('swept collision does not tunnel through a small unit', () => {
    // a 700 wu/s bullet moves 35 wu per tick; a unit of radius 16 is 32 wu wide
    expect(segCircle(0, 0, 35, 0, 40, 0, 16 + 4)).toBeGreaterThanOrEqual(0);
    expect(segCircle(0, 0, 100, 0, 50, 30, 16)).toBe(-1);
    expect(segRect(0, 0, 100, 0, { x: 40, y: -5, w: 10, h: 10 })).toBeCloseTo(0.4, 5);
    expect(segRect(0, 20, 100, 20, { x: 40, y: -5, w: 10, h: 10 })).toBe(-1);
  });
});
