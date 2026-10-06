// Tick-budget benchmark (Section 15, "single room soak" and "node density").
//   pnpm --filter @war/server exec tsx scripts/bench.ts [rooms=10] [seconds=60]
// Every room is full of 24 humans that move and shoot, so snapshot encoding is included. That is the worst case.
import { BRACKETS, BTN_FIRE, fitLoadout } from '@war/shared';
import { Room } from '../src/room.js';
import { CountingLink, percentile } from './fake.js';

const ROOMS = Number(process.argv[2] ?? 10);
const SECONDS = Number(process.argv[3] ?? 60);
const bracket = BRACKETS[2];
const rooms: { room: Room; units: ReturnType<Room['join']>[]; links: CountingLink[] }[] = [];
for (let r = 0; r < ROOMS; r++) {
  const room = new Room({ id: `b${r}`, matchId: `m${r}`, bracket, seed: 1000 + r, timeScale: 1 });
  const links: CountingLink[] = [];
  const units = [];
  for (let i = 0; i < 24; i++) {
    const link = new CountingLink();
    links.push(link);
    units.push(room.join({ accountId: `p${r}-${i}`, name: `P${i}`, level: 20, cr: 1000, link, fit: fitLoadout(20, bracket, {}, {}) }));
  }
  room.startPlayingNow({ lengthS: 3600 });
  rooms.push({ room, units, links });
}

const perRoom: number[] = [];
const perTick: number[] = [];
let seq = 0;
const heap0 = process.memoryUsage().heapUsed;
const ticks = SECONDS * 20;
for (let t = 0; t < ticks; t++) {
  seq = (seq % 65535) + 1;
  let total = 0;
  for (const { room, units } of rooms) {
    units.forEach((u, i) => {
      if (!u) return;
      room.receiveInput(u, { seq, mx: Math.round(Math.cos(t / 30 + i) * 127), my: Math.round(Math.sin(t / 41 + i * 2) * 127), aim: t / 17 + i, buttons: BTN_FIRE, ack: 0 });
    });
    const t0 = performance.now();
    room.step();
    const dt = performance.now() - t0;
    perRoom.push(dt);
    total += dt;
  }
  perTick.push(total);
}
perRoom.sort((a, b) => a - b);
perTick.sort((a, b) => a - b);
const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const bytes = rooms.reduce((s, r) => s + r.links.reduce((x, l) => x + l.bytes, 0), 0);
const players = ROOMS * 24;
const kbps = bytes / players / SECONDS / 1024;
const heap = (process.memoryUsage().heapUsed - heap0) / 1024 / 1024;
console.log(`${ROOMS} rooms x 24 humans, ${SECONDS} s of play (${ticks} ticks)`);
console.log(`per room tick   avg ${avg(perRoom).toFixed(2)} ms   p99 ${percentile(perRoom, 99).toFixed(2)} ms   max ${perRoom[perRoom.length - 1].toFixed(2)} ms   (targets: avg 2.5, p99 6)`);
console.log(`whole process   avg ${avg(perTick).toFixed(2)} ms   p99 ${percentile(perTick, 99).toFixed(2)} ms of a 50 ms slot = ${((avg(perTick) / 50) * 100).toFixed(0)}% of one core (target 70% or less)`);
console.log(`payload per player down: ${kbps.toFixed(2)} KB/s before TLS/TCP overhead (design: 2.2 KB/s payload, 3.5 KB/s on the wire)`);
console.log(`heap growth ${heap.toFixed(1)} MB`);
const ok = avg(perRoom) <= 2.5 && percentile(perRoom, 99) <= 6 && avg(perTick) / 50 <= 0.7;
console.log(ok ? 'PASS' : 'OVER BUDGET');
process.exit(ok ? 0 : 1);
