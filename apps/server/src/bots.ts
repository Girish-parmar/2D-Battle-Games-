import { MAP_SIZE, SPEED_BASE, type WeaponDef, type World } from '@war/shared';

export interface BotUnit {
  slot: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  tier: number;
  aim: number;
  alive: boolean;
  protectedNow: boolean;
  look: number;
  weapon: WeaponDef;
  rangeMult: number;
}
export interface BotWorld {
  time: number;
  world: World;
  liveUnits(): BotUnit[];
  nearestPellet(x: number, y: number, maxDist: number): { x: number; y: number } | null;
  liveCrates(): { x: number; y: number }[];
}
export interface BotInput {
  mx: number;
  my: number;
  aim: number;
  fire: boolean;
}
export type Archetype = 'anvil' | 'wasp' | 'hawk';

export const BOT_NAMES = [
  'Vex', 'Tek', 'Ori', 'Juno', 'Rook', 'Mara', 'Kade', 'Nyx', 'Bolt', 'Sable', 'Rune', 'Pike', 'Dax', 'Lyra', 'Brix', 'Onyx',
  'Fenn', 'Cato', 'Zed', 'Ash', 'Quill', 'Mox', 'Echo', 'Ruck', 'Tarn', 'Vale', 'Jax', 'Kira', 'Blitz', 'Ember', 'Slate', 'Wren'
];

export class BotBrain {
  private firstSeen = new Map<number, number>();
  private waypoint: { x: number; y: number } | null = null;
  private waypointUntil = 0;
  private aimErr = 0;
  private aimErrUntil = 0;
  private strafe = 1;
  private strafeUntil = 0;
  private lastX = 0;
  private lastY = 0;
  private lastCheck = 0;
  private stuckUntil = 0;

  constructor(
    private aimDeg: number,
    private reactMs: number,
    private archetype: Archetype,
    private rng: () => number
  ) {}

  private gauss(): number {
    const u = Math.max(1e-9, this.rng());
    const v = this.rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  think(me: BotUnit, w: BotWorld): BotInput {
    const t = w.time;
    // aim error is re-rolled every 300 ms
    if (t >= this.aimErrUntil) {
      this.aimErr = this.gauss() * ((this.aimDeg * Math.PI) / 180);
      this.aimErrUntil = t + 0.3;
    }
    if (t >= this.strafeUntil) {
      this.strafe = this.rng() < 0.5 ? -1 : 1;
      this.strafeUntil = t + 0.8 + this.rng() * 1.5;
    }
    // stuck detection: tried to move but barely moved in the last second
    if (t - this.lastCheck >= 1) {
      const moved = Math.hypot(me.x - this.lastX, me.y - this.lastY);
      if (moved < 12 && this.lastCheck > 0) {
        this.waypoint = null;
        this.stuckUntil = t + 0.8;
        this.strafe = -this.strafe;
      }
      this.lastX = me.x;
      this.lastY = me.y;
      this.lastCheck = t;
    }

    const others = w.liveUnits().filter((u) => u.slot !== me.slot && u.alive && !u.protectedNow);
    const seen = new Set<number>();
    let nearest: BotUnit | null = null;
    let nd = Infinity;
    for (const u of others) {
      const d = Math.hypot(u.x - me.x, u.y - me.y);
      if (d > me.look) continue;
      seen.add(u.slot);
      if (!this.firstSeen.has(u.slot)) this.firstSeen.set(u.slot, t);
      if (d < nd) { nd = d; nearest = u; }
    }
    for (const s of [...this.firstSeen.keys()]) if (!seen.has(s)) this.firstSeen.delete(s);

    const range = me.weapon.range * me.rangeMult;
    let dirX = 0, dirY = 0;
    let aim = me.aim;
    let fire = false;

    const reacted = nearest ? (t - (this.firstSeen.get(nearest.slot) ?? t)) * 1000 >= this.reactMs : false;
    const hpFrac = me.hp / Math.max(1, me.maxHp);

    if (nearest && reacted) {
      const dx = nearest.x - me.x, dy = nearest.y - me.y;
      const d = Math.max(1, nd);
      const lead = me.weapon.arcs ? d / me.weapon.speed : d / (me.weapon.speed * me.rangeMult);
      const tx = nearest.x + nearest.vx * lead, ty = nearest.y + nearest.vy * lead;
      aim = Math.atan2(ty - me.y, tx - me.x) + this.aimErr;
      const ux = dx / d, uy = dy / d;
      const flee = nearest.tier >= me.tier + 2 && d < 650 || hpFrac < 0.3;
      const pref = range * (this.archetype === 'hawk' ? 0.85 : this.archetype === 'wasp' ? 0.45 : 0.6);
      if (flee) {
        dirX = -ux + -uy * this.strafe * 0.4;
        dirY = -uy + ux * this.strafe * 0.4;
      } else if (d > pref * 1.15) {
        dirX = ux; dirY = uy;
      } else if (d < pref * 0.7) {
        dirX = -ux * 0.6 - uy * this.strafe * 0.6;
        dirY = -uy * 0.6 + ux * this.strafe * 0.6;
      } else {
        dirX = -uy * this.strafe;
        dirY = ux * this.strafe;
      }
      const aligned = Math.abs(Math.atan2(Math.sin(aim - me.aim), Math.cos(aim - me.aim))) < 0.22;
      const minRange = me.weapon.minRange;
      fire = d <= range * 0.95 && d >= minRange && aligned;
    } else {
      // farm scrap, hunt crates once armed, otherwise wander
      const pellet = w.nearestPellet(me.x, me.y, 700);
      let goal: { x: number; y: number } | null = pellet;
      if (!goal && me.tier >= 3) {
        let bd = Infinity;
        for (const c of w.liveCrates()) {
          const d = Math.hypot(c.x - me.x, c.y - me.y);
          if (d < bd) { bd = d; goal = c; }
        }
        if (goal && bd < 380) {
          aim = Math.atan2(goal.y - me.y, goal.x - me.x);
          const aligned = Math.abs(Math.atan2(Math.sin(aim - me.aim), Math.cos(aim - me.aim))) < 0.25;
          fire = aligned && bd > me.weapon.minRange;
          if (bd < 140) goal = null;
        }
      }
      if (!goal) {
        if (!this.waypoint || t >= this.waypointUntil || Math.hypot(this.waypoint.x - me.x, this.waypoint.y - me.y) < 120) {
          this.waypoint = { x: 250 + this.rng() * (MAP_SIZE - 500), y: 250 + this.rng() * (MAP_SIZE - 500) };
          this.waypointUntil = t + 6 + this.rng() * 6;
        }
        goal = this.waypoint;
      }
      const dx = goal.x - me.x, dy = goal.y - me.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      dirX = dx / d; dirY = dy / d;
      if (!fire) aim = Math.atan2(dy, dx);
    }

    // stay out of minefields
    for (const m of w.world.mines) {
      const dx = me.x - m.x, dy = me.y - m.y;
      const d = Math.hypot(dx, dy);
      if (d < m.r + 90) {
        const k = (m.r + 90 - d) / 90;
        dirX += (dx / Math.max(d, 1)) * 2.2 * Math.min(1, k + 0.3);
        dirY += (dy / Math.max(d, 1)) * 2.2 * Math.min(1, k + 0.3);
      }
    }
    // keep off the map edge
    const edge = 160;
    if (me.x < edge) dirX += 1; else if (me.x > MAP_SIZE - edge) dirX -= 1;
    if (me.y < edge) dirY += 1; else if (me.y > MAP_SIZE - edge) dirY -= 1;
    // nudge sideways when stuck on a wall
    if (t < this.stuckUntil) {
      const px = -dirY, py = dirX;
      dirX += px * this.strafe * 1.2;
      dirY += py * this.strafe * 1.2;
    }
    const len = Math.hypot(dirX, dirY);
    if (len > 1e-6) { dirX /= len; dirY /= len; }
    void SPEED_BASE;
    return { mx: Math.round(dirX * 127), my: Math.round(dirY * 127), aim, fire };
  }
}
