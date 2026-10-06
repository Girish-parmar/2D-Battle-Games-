# Balance report

The design (S8) says builds must be proved fair by simulation, not by argument. This file records what the simulators showed, what was changed, and what is still unproven.

## How it was measured

`apps/server/scripts/matches.ts` plays whole matches headless: 24 bots of equal skill in one bracket-2 room (Soldier, 8 minutes), six bots on each of four builds. The run is seeded, so the same weights give the same table every time.

| Build | Loadout | PP |
|---|---|---|
| Anvil | tank (hull and armor items) | 30 |
| Wasp | fast, short range (speed and fire-rate items) | 32 |
| Hawk | long range, high damage | 30 |
| Empty | no items | 0 |

`apps/server/scripts/sim.ts` runs equal-skill duels. `apps/server/scripts/probe.ts <stat> <pct>` gives one stat a free percentage bonus and reports how many places that gains over the field. That is how the weights were calibrated.

Target from the design: every build within 46% to 54% of the win share, and average ranks close together. With four builds of six bots each, a fair split is 25% of wins per build and an average rank of 12.5.

## Results (60 full matches each)

| Calibration | Build | Avg score | Avg rank | Wins | Score vs field |
|---|---|---|---|---|---|
| **Design weights (baseline)** | Anvil | n/a | 14.9 | 3 | n/a |
| | Wasp | n/a | 12.9 | 9 | n/a |
| | Hawk | n/a | 10.9 | 31 | n/a |
| | Empty | n/a | 11.4 | 17 | n/a |
| **Pass 1 (kept)** | Anvil | 613 | 13.9 | 6 | 97% |
| | Wasp | 652 | 11.0 | 15 | 103% |
| | Hawk | 622 | 13.2 | 20 | 98% |
| | Empty | 640 | 12.0 | 19 | 101% |
| **Pass 2 (rejected)** | Anvil | 619 | 14.2 | 8 | 96% |
| | Wasp | 673 | 10.5 | 26 | 104% |
| | Hawk | 634 | 13.4 | 12 | 98% |
| | Empty | 650 | 12.0 | 14 | 101% |

Baseline scores were not recorded in the same format. Its wins and average ranks are from the first full run.

## What changed

1. **Baseline.** With the design's weights, Hawk won 52% of matches and Anvil 5%. The weights were off, not the idea.
2. **A real bug.** While probing fire rate, a +10% fire-rate item did nothing. Cooldowns were rounded up to whole 20 Hz ticks, so a weapon at 3 shots per second could not go faster in small steps. The cooldown now carries its remainder between shots. A regression test (`apps/server/test/room.test.ts`) checks 3.0 shots per second within 5% and that +10% is visible.
3. **Pass 1 (kept).** Probes measured what each percent of a stat is worth in places gained:

   | Stat (+10%) | Places gained |
   |---|---|
   | damage | 4.4 |
   | range | 3.6 to 3.7 |
   | speed | 1.2 to 2.1 |
   | fire rate | 1.9 |
   | feed | 1.3 to 2.4 (noisy) |
   | hull | 0.6 to 0.7 |
   | armor (+1.0) | 0.5 to 0.6 |
   | respawn time (reborn) | 0.5 |
   | repair (+50%) | 0.4 |
   | scope | 0 (bots never scope) |
   | look | negative (bots do not use sight range well) |

   Weights moved toward those values: hull 0.7, armor 4.5, speed 0.52, fire rate 0.7, range 0.8, feed 0.45, reborn 0.2. Because an item's size is 8 weighted-power points divided by its stat weight, items for cheap stats grew and items for strong stats shrank. Every item at Mk III is still worth 1.75 net power.
4. **Pass 2 (rejected).** Lowering repair to 0.06 and reborn to 0.16 made the field spread wider, not narrower: Wasp took 26 of 60 wins (43%) and the gap between best and worst average rank grew from 2.9 to 3.7. Pass 1 was closer on every column, so the weights went back. The change is also within the noise of a 60-match run (the standard deviation of a build's win count is about 3.4 even for a perfectly fair game), so the lesson is only that more tuning on bot data would be chasing noise.

## Where it stands

The target is **not met**. After pass 1:

- Wasp has the best average rank (11.0) and Anvil the worst (13.9), against a fair 12.5. By score, the spread is 97% to 103% of the field average, which is close.
- Win share is 10% (Anvil), 25% (Wasp), 33% (Hawk), 32% (Empty), against a fair 25%. Anvil still under-performs. The design's 46% to 54% band was not reached on wins.
- Empty (no items) is not behind the item builds, so buying items does not lose you power. It is also not clearly behind them (101% of the field average against 97% to 103%), which suggests items add little net power in this bot environment.

## Caveats you should weigh before trusting any of this

- **Bots are not people.** They rank by score only, never use Scope, flee at low health, and have a fixed aim error. They undervalue defence (armor, hull, repair) and awareness (look, scope), so Anvil's weak result may be a bot artifact. A human who plays around cover and uses Scope would value those stats more.
- **Sixty matches is small.** One build's win count has a standard deviation of about 3.4 on a fair 15. Differences smaller than about 7 wins are not meaningful. Average rank is a steadier signal than wins.
- **The run is deterministic.** It repeats exactly, so it measures one random draw, not a distribution. Two different weight sets that differ by little can give very different win counts for that reason.
- **One bracket and one tier.** Bracket 2 only. Higher brackets and higher Tiers (bigger units, better weapons) were not simulated.

## What to do next

1. Run real playtests with the leaderboard turned on (`LEADERBOARD_OPEN=1`) and compare per-build win and score shares from the `matches` table.
2. Rerun `probe.ts` for every stat after the playtest, then move `STAT_WEIGHT` in `packages/shared/src/constants.ts`. Item sizes follow automatically, and the shared tests derive their expectations from the same table.
3. Teach the bots to scope and to value cover before trusting any defence or awareness number.
