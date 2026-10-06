# 2D War Arena

A browser-based, server-authoritative, real-time 2D war game. Many players share one arena, start as a small unit, grow as they score, and spend earned credits on upgrades that trade one strength for another. Matches last 6 to 13 minutes by bracket (overtime adds up to 2).

This is the implementation of the "2D War Arena Design" canvas. Section numbers below (S3, S10 and so on) point back to that document.

## Run it

Needs Node 22 and pnpm 10.

```bash
pnpm install
pnpm dev            # server on :8080, web client on :5173 (open http://localhost:5173)
```

Production style, one process serving the built client:

```bash
pnpm build && pnpm start        # http://localhost:8080
```

Useful switches (environment variables):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 8080 | HTTP and WebSocket port |
| `TIME_SCALE` | 1 | Divides phase timers. `6` makes a 6-minute match last 1 minute, for testing |
| `DATA_FILE` | `data/db.json` | The JSON store. `:memory:` keeps nothing |
| `SECRET` | generated | Token signing secret. Set it in production |
| `LEADERBOARD_OPEN` | off | `1` lets guests and thin boards show up, for demos |
| `NODE_ENV` | development | `production` stops the email login link being returned in the API response |

### Controls

WASD move, mouse aim, hold left button to fire, hold right button or Shift to scope, `F` toggles auto-fire, `Tab` shows the scoreboard, hold `Q` then press `1` to `6` for emotes, `Esc` opens the menu. On touch screens the left half is a move stick and the right half is an aim stick that fires past 30%.

## What is in the repo

```
packages/shared   every number and formula from the design, the binary protocol, the world and movement
apps/server       rooms, bots, matchmaking, REST API, WebSocket gateway, store, simulators
apps/web          PixiJS client: rendering, netcode, HUD, menus
e2e/play.mjs      Chromium end-to-end check
```

How the pieces map to the design:

- **S3, S4, S5 (rules):** `packages/shared/src/constants.ts` and `formulas.ts`. Tier thresholds, weapons W1 to W5, the 11 stats and caps, the Mk ladder, budgets, XP, credits, bounties, death and respawn rules.
- **S2, S3 (match):** `apps/server/src/room.ts`. The tick runs in the S10 order (inputs, movement, fire, projectiles, pickups, deaths, upkeep, snapshots) at 20 Hz. Phases, late join, overtime ring, mercy end, disconnect ghost and reconnect, spawn protection, scoring, crates and power-ups.
- **S6 (matchmaking):** `matchmaker.ts`. Brackets, CR window that widens 50 every 10 s to 400, play-down offer, one-time room tickets. Bots are in `bots.ts`.
- **S7 (economy):** `economy.ts`. Buy, upgrade, salvage at 70%, presets, name change, and match results into XP, credits, Ranking Points and Career Rating. A retried result pays once because the ledger key is unique.
- **S9 (boards):** `store.ts`. Daily best 8, weekly best 30, all-time Career Rating, tie-break by who got there first.
- **S10, S11 (netcode):** binary snapshots with per-client interest management (Look circle, Scope circle, beacon), 100 ms interpolation, prediction and reconciliation for your own unit, lag compensation up to 200 ms. See `packages/shared/src/protocol.ts`.
- **S12 (UI):** `apps/web/src/screens` and `apps/web/src/game`.
- **S14 (security):** server authority (clients send only a move direction, aim and two buttons), rate limits, one-time room tickets, origin check, 13+ age gate, report button, account delete and export.

## Test it

```bash
pnpm test                                       # 53 unit and integration tests
pnpm typecheck
pnpm --filter @war/server exec tsx scripts/bench.ts 10 40     # tick budget, 10 full rooms
NODE_ENV=production TIME_SCALE=6 PORT=8081 pnpm start &       # then:
BASE=http://localhost:8081 pnpm --filter @war/server exec tsx scripts/bots.ts 48 60   # 48 real clients
BASE=http://localhost:8081 node e2e/play.mjs                  # needs Chromium, see the file header
```

Balance tools (S8):

```bash
pnpm --filter @war/server exec tsx scripts/sim.ts 100 2 1       # equal-skill duels, bracket 2, Tier 1
pnpm --filter @war/server exec tsx scripts/matches.ts 60 2      # full 24-bot matches by build
pnpm --filter @war/server exec tsx scripts/probe.ts damage 10   # what one stat is worth
```

## Measured results

Tick budget (`bench.ts`, every room full of 24 humans moving and shooting, snapshots encoded): 0.63 ms average per room and 2.05 ms at p99, against targets of 2.5 and 6. Ten full rooms use 13% of one core, so the design's 10 rooms per vCPU is conservative. Payload is 2.15 KB/s per player before TLS and TCP overhead, against the design's 2.2.

Browser end-to-end (`e2e/play.mjs`): guest login, shop, leaderboard, queue, a played match, results and rewards all pass.

## Balance status (read this before trusting the numbers)

The design says balance must be proved by simulation. Doing that changed the numbers:

- With the design's stat weights, the Hawk build won 52% of full bot matches and Anvil 5%, against an expected 25% each.
- A fire-rate bug was found this way: cooldowns rounded up to whole 20 Hz ticks, so a +10% fire-rate item did nothing. Fixed, with a regression test.
- `STAT_WEIGHT` in `packages/shared/src/constants.ts` was recalibrated from `probe.ts` measurements. Range, damage and speed are worth more per percent than the design assumed; hull, armor, repair and respawn time are worth less. Item sizes follow the weights (an item's bonus is 8 weighted-power points divided by the stat weight), so they differ from the design canvas tables. Net power per item is still 1.75 at Mk III.
- Result: closer, but the design's 46% to 54% win-share band is **not met**. In 60 full bot matches the builds finished at 97% to 103% of the average score, with average ranks from 11.0 (Wasp) to 13.9 (Anvil) against a fair 12.5, and Anvil still wins too few matches. Full tables, a rejected second pass and the noise limits are in `BALANCE.md`.

Caveat: these are bot results. The bots rank by score only, never use Scope, and flee at low health, so they undervalue defence and awareness. Re-run the probes after real playtests and expect to move the weights again.

## Where this differs from the design

- **Storage:** a JSON file store instead of PostgreSQL and Redis. `apps/server/db/schema.sql` is the real schema from S11 and `Store` in `store.ts` is the swap point. Leaderboards are computed from stored matches rather than kept in Redis sorted sets.
- **Processes:** one server process holds all rooms and the API, instead of separate game nodes and an API service.
- **Menus:** plain DOM instead of Preact.
- **Login:** guest play and email login work, but email delivery is not built. In development the API returns the sign-in link. Google sign-in is not built. A guest can claim their progress by verifying an email.
- **Abort rule:** a room aborts when no human is connected for 30 s. The design says fewer than 2 humans, which would abort every bot-filled solo room.
- **Mortar:** shells have a proximity fuse, because the input message carries no aim distance.
- **Tab scoreboard:** shows the top 10 plus you, because that is all the server sends.
- **Matchmaking:** Elite and Warlord tickets wait for company or 45 s before a room forms; lower brackets form a room immediately.
- **Untested:** `Dockerfile`, `docker-compose.yml` and `Caddyfile` follow the design's single-VPS layout but could not be run here (no Docker). Real GPU rendering speed, human playtesting and real email delivery are also untested.

## Deploying

`docker-compose.yml` runs the app behind Caddy for automatic HTTPS. Set `DOMAIN` and `SECRET`. Back up the `data` volume.
