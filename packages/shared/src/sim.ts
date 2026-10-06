import {
  CRATES_FOUNDRY, CRATE_COUNT, FOUNDRY_SIZE, MAP_CENTER, MAP_SIZE, MINEFIELD_RADIUS, SPAWN_PADS, WALL_COUNT
} from './constants.js';

// ---- Deterministic RNG (client and server build the same world from a seed) --
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rect { x: number; y: number; w: number; h: number }
export interface Pt { x: number; y: number }
export interface World {
  seed: number;
  walls: Rect[];
  pads: Pt[];
  mines: { x: number; y: number; r: number }[];
  crates: Pt[];
  foundry: Rect;
}

export function distPointRect(px: number, py: number, r: Rect): number {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.hypot(dx, dy);
}
function rectsOverlap(a: Rect, b: Rect, pad: number): boolean {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
}

export function generateWorld(seed: number): World {
  const rng = mulberry32(seed);
  const pads: Pt[] = [];
  for (let i = 0; i < SPAWN_PADS; i++) {
    const a = (i / SPAWN_PADS) * Math.PI * 2;
    pads.push({ x: MAP_CENTER + Math.cos(a) * 1400, y: MAP_CENTER + Math.sin(a) * 1400 });
  }
  const foundry: Rect = { x: MAP_CENTER - FOUNDRY_SIZE / 2, y: MAP_CENTER - FOUNDRY_SIZE / 2, w: FOUNDRY_SIZE, h: FOUNDRY_SIZE };
  const crates: Pt[] = [];
  for (let i = 0; i < CRATES_FOUNDRY; i++) {
    crates.push({ x: foundry.x + 100 + rng() * (foundry.w - 200), y: foundry.y + 100 + rng() * (foundry.h - 200) });
  }
  for (let i = 0; i < CRATE_COUNT - CRATES_FOUNDRY; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    crates.push({ x: MAP_CENTER + Math.cos(a) * 1000, y: MAP_CENTER + Math.sin(a) * 1000 });
  }
  const mines = [
    { x: 800, y: 800, r: MINEFIELD_RADIUS },
    { x: 2400, y: 800, r: MINEFIELD_RADIUS },
    { x: 800, y: 2400, r: MINEFIELD_RADIUS },
    { x: 2400, y: 2400, r: MINEFIELD_RADIUS }
  ];
  const walls: Rect[] = [];
  let guard = 0;
  while (walls.length < WALL_COUNT && guard++ < 5000) {
    const horizontal = rng() < 0.5;
    const len = 80 + rng() * 160;
    const w = horizontal ? len : 28;
    const h = horizontal ? 28 : len;
    const r: Rect = { x: 200 + rng() * (MAP_SIZE - 400 - w), y: 200 + rng() * (MAP_SIZE - 400 - h), w, h };
    if (pads.some((p) => distPointRect(p.x, p.y, r) < 170)) continue;
    if (crates.some((c) => distPointRect(c.x, c.y, r) < 100)) continue;
    if (walls.some((o) => rectsOverlap(r, o, 60))) continue;
    walls.push(r);
  }
  return { seed, walls, pads, mines, crates, foundry };
}

// ---- Movement (shared by server and client prediction) -----------------------
export function pushOutOfWalls(p: Pt, radius: number, walls: Rect[]): void {
  for (let iter = 0; iter < 2; iter++) {
    for (const w of walls) {
      const cx = Math.max(w.x, Math.min(p.x, w.x + w.w));
      const cy = Math.max(w.y, Math.min(p.y, w.y + w.h));
      let dx = p.x - cx;
      let dy = p.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        p.x = cx + (dx / d) * radius;
        p.y = cy + (dy / d) * radius;
      } else {
        // centre is inside the wall: leave by the shortest axis
        const l = p.x - w.x, r = w.x + w.w - p.x, t = p.y - w.y, b = w.y + w.h - p.y;
        const m = Math.min(l, r, t, b);
        if (m === l) p.x = w.x - radius;
        else if (m === r) p.x = w.x + w.w + radius;
        else if (m === t) p.y = w.y - radius;
        else p.y = w.y + w.h + radius;
      }
    }
  }
}

/** One input step. mx,my are -127..127. Returns the actual velocity in wu/s. */
export function stepPosition(p: Pt, mx: number, my: number, speed: number, radius: number, dt: number, walls: Rect[]): Pt {
  let dx = mx / 127;
  let dy = my / 127;
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }
  const ox = p.x, oy = p.y;
  p.x += dx * speed * dt;
  p.y += dy * speed * dt;
  p.x = Math.max(radius, Math.min(MAP_SIZE - radius, p.x));
  p.y = Math.max(radius, Math.min(MAP_SIZE - radius, p.y));
  pushOutOfWalls(p, radius, walls);
  p.x = Math.max(radius, Math.min(MAP_SIZE - radius, p.x));
  p.y = Math.max(radius, Math.min(MAP_SIZE - radius, p.y));
  return { x: (p.x - ox) / dt, y: (p.y - oy) / dt };
}

export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function rotateToward(cur: number, target: number, maxDelta: number): number {
  const d = angleDiff(cur, target);
  if (Math.abs(d) <= maxDelta) return target;
  return cur + Math.sign(d) * maxDelta;
}

// ---- Swept collision helpers -------------------------------------------------
/** Segment (x0,y0)-(x1,y1) against a circle. Returns entry t in [0,1] or -1. */
export function segCircle(x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, r: number): number {
  const dx = x1 - x0, dy = y1 - y0;
  const fx = x0 - cx, fy = y0 - cy;
  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0; // starts inside
  if (a < 1e-9) return -1;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t = (-b - s) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}
/** Segment against an axis-aligned rect (slab method). Returns entry t in [0,1] or -1. */
export function segRect(x0: number, y0: number, x1: number, y1: number, r: Rect): number {
  let tmin = 0, tmax = 1;
  const d = [x1 - x0, y1 - y0];
  const o = [x0, y0];
  const lo = [r.x, r.y];
  const hi = [r.x + r.w, r.y + r.h];
  for (let i = 0; i < 2; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return -1;
    } else {
      let t1 = (lo[i] - o[i]) / d[i];
      let t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}
