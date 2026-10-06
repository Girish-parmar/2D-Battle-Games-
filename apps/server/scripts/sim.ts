// Duel simulator for the balance plan in Section 8: equal-skill 1v1 fights between build templates.
//   pnpm --filter @war/server exec tsx scripts/sim.ts [duelsPerSide=150] [bracket=2] [tier=1]
// Both sides use the same bot AI and skill. Only the loadout (and its preferred range) differs.
import { BRACKETS, fitLoadout, loadoutPp, segRect, tierThreshold, type Inventory, type LoadoutIds } from '@war/shared';
import { Room, archetypeLoadout, type Unit } from '../src/room.js';
import type { Archetype } from '../src/bots.js';

const DUELS = Number(process.argv[2] ?? 150);
const BR = BRACKETS[Number(process.argv[3] ?? 2) - 1];
const TIER = Number(process.argv[4] ?? 1);
const level = BR.maxLevel;


type Build = { name: string; ai: Archetype; inv: Inventory; lo: LoadoutIds };
// The three reference builds from Section 8, at the Mk levels listed there (30, 32 and 30 PP, all within the bracket 2 cap of 32).
const builds: Build[] = [
  { name: 'Anvil', ai: 'anvil', lo: archetypeLoadout('anvil') as LoadoutIds, inv: { hardened_rounds: 3, reactive_armor: 3, phoenix_core: 3, wide_radar: 1, field_repair: 3 } },
  { name: 'Wasp', ai: 'wasp', lo: archetypeLoadout('wasp') as LoadoutIds, inv: { rapid_loader: 3, heavy_plating: 2, afterburner: 3, wide_radar: 3, scavenger_magnet: 3 } },
  { name: 'Hawk', ai: 'hawk', lo: archetypeLoadout('hawk') as LoadoutIds, inv: { long_barrel: 3, reactive_armor: 1, afterburner: 3, tele_optics: 3, scavenger_magnet: 3 } },
  { name: 'Empty', ai: 'anvil', lo: {}, inv: {} }
];

function duel(a: Build, b: Build, seed: number, swap: boolean): number {
  const room = new Room({ id: 'd', matchId: 'd', bracket: BR, seed, timeScale: 1, abortWhenEmpty: false });
  const [first, second] = swap ? [b, a] : [a, b];
  const units: Unit[] = [first, second].map((bd, i) => room.join({
    accountId: null, name: bd.name + i, level, cr: 1000, fit: fitLoadout(level, BR, bd.lo, bd.inv),
    bot: { archetype: bd.ai, aimDeg: BR.botAimDeg, reactMs: BR.botReactMs }
  })!);
  room.startPlayingNow({ lengthS: 3600 });
  // face off at the centre, 500 wu apart, with a clear line between them
  let placed = false;
  for (let k = 0; k < 40 && !placed; k++) {
    const th = (seed * 7 + k) * 0.7;
    const ax = 1600 + Math.cos(th) * 250, ay = 1600 + Math.sin(th) * 250, bx = 1600 - Math.cos(th) * 250, by = 1600 - Math.sin(th) * 250;
    if (room.world.walls.some((w) => segRect(ax, ay, bx, by, { x: w.x - 30, y: w.y - 30, w: w.w + 60, h: w.h + 60 }) >= 0)) continue;
    units[0].x = ax; units[0].y = ay; units[1].x = bx; units[1].y = by;
    units[0].aim = th + Math.PI; units[1].aim = th;
    placed = true;
  }
  const refresh = (room as unknown as { refreshStats(u: Unit): void }).refreshStats.bind(room);
  for (const u of units) { u.gs = tierThreshold(TIER); u.maxHp = 0; refresh(u); u.hp = u.maxHp; u.protectedUntil = 0; }
  for (let t = 0; t < 20 * 60; t++) {
    room.step();
    if (!units[0].alive || !units[1].alive) {
      const winner = units[0].alive ? 0 : 1;
      return (swap ? 1 - winner : winner) === 0 ? 1 : 0; // 1 means build a won
    }
  }
  const h0 = units[0].hp / units[0].maxHp, h1 = units[1].hp / units[1].maxHp;
  const w = h0 === h1 ? -1 : h0 > h1 ? 0 : 1;
  return w < 0 ? 0.5 : (swap ? 1 - w : w) === 0 ? 1 : 0;
}

console.log(`Duel simulation: bracket ${BR.id} (${BR.name}, cap ${BR.ppCap} PP), Tier ${TIER}, ${DUELS * 2} duels per pair, bot aim ${BR.botAimDeg} deg, reaction ${BR.botReactMs} ms\n`);
const wins: Record<string, Record<string, number>> = {};
for (const a of builds) wins[a.name] = {};
let seed = 5000;
for (let i = 0; i < builds.length; i++) for (let j = i + 1; j < builds.length; j++) {
  let aw = 0, n = 0;
  for (let d = 0; d < DUELS; d++) for (const swap of [false, true]) { aw += duel(builds[i], builds[j], seed++, swap); n++; }
  wins[builds[i].name][builds[j].name] = aw / n;
  wins[builds[j].name][builds[i].name] = 1 - aw / n;
}
const pad = (s: string, n = 9) => s.padEnd(n);
for (const b of builds) console.log(`  ${b.name}: ${loadoutPp(b.lo, b.inv)} PP`);
console.log(pad('win rate') + builds.map((b) => pad(b.name)).join(''));
for (const a of builds) console.log(pad(a.name) + builds.map((b) => pad(a === b ? '-' : (wins[a.name][b.name] * 100).toFixed(0) + '%')).join(''));
console.log('\nmixed-lobby share (average over the three non-empty builds):');
for (const a of builds.slice(0, 3)) {
  const others = builds.slice(0, 3).filter((b) => b !== a);
  console.log(`  ${pad(a.name)} ${(others.reduce((s, b) => s + wins[a.name][b.name], 0) / others.length * 100).toFixed(1)}%   vs Empty ${(wins[a.name].Empty * 100).toFixed(0)}%`);
}
console.log('\ntargets: each build 46% to 54% in a mixed lobby; favoured matchups 55% to 58%; full loadout vs empty 60% or less');
