// Measures what one stat is worth in a full match: 12 of 24 equal-skill bots get a raw bonus to ONE stat, 12 do not.
//   pnpm --filter @war/server exec tsx scripts/probe.ts <stat> <amount> [matches=40] [bracket=2]
// Prints how many places higher the boosted group finishes on average. Compare stats by "places per unit".
import { BRACKETS, fitLoadout, type StatKey } from '@war/shared';
import { Room, type MatchResult, type Unit } from '../src/room.js';

const stat = process.argv[2] as StatKey;
const amount = Number(process.argv[3]);
const MATCHES = Number(process.argv[4] ?? 40);
const BR = BRACKETS[Number(process.argv[5] ?? 2) - 1];
let probeRank = 0, ctrlRank = 0, probeMs = 0, ctrlMs = 0, n = 0;
for (let m = 0; m < MATCHES; m++) {
  let result: MatchResult | null = null;
  const room = new Room({ id: 'p', matchId: 'p' + m, bracket: BR, seed: 3000 + m, timeScale: 1, abortWhenEmpty: false, onFinish: (r) => { result = r; return new Map(); } });
  const refresh = (room as unknown as { refreshStats(u: Unit): void }).refreshStats.bind(room);
  for (let i = 0; i < 24; i++) {
    const u = room.join({ accountId: null, name: `${(i + m) % 2 ? 'P' : 'C'}-${i}`, level: BR.maxLevel, cr: 1000, fit: fitLoadout(BR.maxLevel, BR, {}, {}), bot: { archetype: 'anvil', aimDeg: BR.botAimDeg, reactMs: BR.botReactMs } })!;
    if (u.name.startsWith('P')) { u.probe = { [stat]: amount }; refresh(u); u.hp = u.maxHp; }
  }
  room.startPlayingNow();
  for (let t = 0; t < 20 * (BR.baseLenS + 200) && room.phase !== 'ending' && !room.closed; t++) room.step();
  if (!result) continue;
  for (const p of (result as MatchResult).players) {
    if (p.name.startsWith('P')) { probeRank += p.rank; probeMs += p.ms; } else { ctrlRank += p.rank; ctrlMs += p.ms; }
    n++;
  }
}
const half = n / 2;
const dRank = ctrlRank / half - probeRank / half;
console.log(JSON.stringify({ stat, amount, matches: MATCHES, probeRank: +(probeRank / half).toFixed(2), ctrlRank: +(ctrlRank / half).toFixed(2), placesGained: +dRank.toFixed(3), placesPerUnit: +(dRank / amount).toFixed(4), scoreGainPct: +(((probeMs / half) / (ctrlMs / half) - 1) * 100).toFixed(1) }));
