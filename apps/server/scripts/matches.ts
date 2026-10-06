// Full-match balance simulation (Section 8): 24 bots of equal skill, six of each reference build, one whole match.
//   pnpm --filter @war/server exec tsx scripts/matches.ts [matches=12] [bracket=2]
// Reports score, rank and win share per build. Each build should land in 46% to 54% of the expected share.
import { BRACKETS, fitLoadout, loadoutPp, type Inventory, type LoadoutIds } from '@war/shared';
import { Room, archetypeLoadout, type MatchResult } from '../src/room.js';
import type { Archetype } from '../src/bots.js';

const MATCHES = Number(process.argv[2] ?? 12);
const BR = BRACKETS[Number(process.argv[3] ?? 2) - 1];
type Build = { name: string; ai: Archetype; lo: LoadoutIds; inv: Inventory };
const builds: Build[] = [
  { name: 'Anvil', ai: 'anvil', lo: archetypeLoadout('anvil') as LoadoutIds, inv: { hardened_rounds: 3, reactive_armor: 3, phoenix_core: 3, wide_radar: 1, field_repair: 3 } },
  { name: 'Wasp', ai: 'wasp', lo: archetypeLoadout('wasp') as LoadoutIds, inv: { rapid_loader: 3, heavy_plating: 2, afterburner: 3, wide_radar: 3, scavenger_magnet: 3 } },
  { name: 'Hawk', ai: 'hawk', lo: archetypeLoadout('hawk') as LoadoutIds, inv: { long_barrel: 3, reactive_armor: 1, afterburner: 3, tele_optics: 3, scavenger_magnet: 3 } },
  { name: 'Empty', ai: 'anvil', lo: {}, inv: {} }
];
const stats = new Map<string, { n: number; ms: number; rank: number; kills: number; deaths: number; wins: number; top3: number; tier: number }>();
for (const b of builds) stats.set(b.name, { n: 0, ms: 0, rank: 0, kills: 0, deaths: 0, wins: 0, top3: 0, tier: 0 });

const t0 = performance.now();
for (let m = 0; m < MATCHES; m++) {
  let result: MatchResult | null = null;
  const room = new Room({ id: 'm', matchId: 'm' + m, bracket: BR, seed: 900 + m, timeScale: 1, abortWhenEmpty: false, onFinish: (r) => { result = r; return new Map(); } });
  // the build order is rotated each match so no build always gets the same spawn pads
  for (let i = 0; i < 24; i++) {
    const b = builds[(i + m) % builds.length];
    room.join({ accountId: null, name: `${b.name}-${i}`, level: BR.maxLevel, cr: 1000, fit: fitLoadout(BR.maxLevel, BR, b.lo, b.inv), bot: { archetype: b.ai, aimDeg: BR.botAimDeg, reactMs: BR.botReactMs } });
  }
  room.startPlayingNow();
  for (let t = 0; t < 20 * (BR.baseLenS + 200) && room.phase !== 'ending' && !room.closed; t++) room.step();
  if (!result) { console.log(`match ${m}: no result`); continue; }
  for (const p of (result as MatchResult).players) {
    const s = stats.get(p.name.split('-')[0])!;
    s.n++; s.ms += p.ms; s.rank += p.rank; s.kills += p.kills; s.deaths += p.deaths; s.tier += p.maxTier;
    if (p.rank === 1) s.wins++;
    if (p.rank <= 3) s.top3++;
  }
}
console.log(`${MATCHES} full matches in bracket ${BR.id} (${BR.name}, ${BR.baseLenS / 60} min each), 24 equal-skill bots, 6 per build, in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
for (const b of builds) console.log(`  ${b.name}: ${loadoutPp(b.lo, b.inv)} PP`);
const pad = (s: string | number, n = 10) => String(s).padEnd(n);
console.log('\n' + pad('build') + pad('avg score') + pad('avg rank') + pad('top-3 %') + pad('wins') + pad('K/D') + pad('avg max tier') + 'score vs average');
const mean = [...stats.values()].reduce((s, v) => s + v.ms / Math.max(1, v.n), 0) / stats.size;
for (const b of builds) {
  const s = stats.get(b.name)!;
  const sc = s.ms / s.n;
  console.log(pad(b.name) + pad(sc.toFixed(0)) + pad((s.rank / s.n).toFixed(1)) + pad(((s.top3 / s.n) * 100).toFixed(0)) + pad(s.wins) + pad((s.kills / Math.max(1, s.deaths)).toFixed(2)) + pad((s.tier / s.n).toFixed(1)) + ((sc / mean) * 100).toFixed(0) + '%');
}
console.log('\ntarget: every build within 46% to 54% of the win share (top-3 share near 12.5% each for 4 builds x 6 bots), average ranks close together');
