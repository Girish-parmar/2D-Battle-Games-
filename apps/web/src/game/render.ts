import { Application, Container, Graphics, Sprite, Text, TextStyle, TilingSprite, type Texture } from 'pixi.js';
import {
  CAMERA_FRAMING, CRATE_RADIUS, MAP_CENTER, MAP_SIZE, UF_PROTECTED, UF_SCOPING, UF_SHIELD, WEAPONS, type World
} from '@war/shared';
import { PALETTE } from '../art.js';
import type { ClientWorld } from './state.js';
import { loadArt, type Art } from './textures.js';

export { PALETTE };
const nameStyle = new TextStyle({ fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 13, fontWeight: '600', fill: 0xffffff, stroke: { color: 0x000000, width: 3 } });
const smallStyle = new TextStyle({ fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 12, fontWeight: '600', fill: 0xffffff, stroke: { color: 0x000000, width: 3 } });

class TextPool {
  private items: Text[] = [];
  private used = 0;
  constructor(private layer: Container, private style: TextStyle) {}
  begin() { this.used = 0; }
  get(text: string, x: number, y: number, tint = 0xffffff, alpha = 1, scale = 1): Text {
    let t = this.items[this.used];
    if (!t) { t = new Text({ text, style: this.style }); t.anchor.set(0.5, 1); t.resolution = 2; this.layer.addChild(t); this.items.push(t); }
    this.used++;
    if (t.text !== text) t.text = text;
    t.visible = true; t.x = x; t.y = y; t.tint = tint; t.alpha = alpha; t.scale.set(scale);
    return t;
  }
  end() { for (let i = this.used; i < this.items.length; i++) this.items[i].visible = false; }
}

/** Reuses sprites between frames so drawing allocates nothing once the scene has warmed up. */
class SpritePool {
  private items: Sprite[] = [];
  private used = 0;
  constructor(readonly layer: Container) {}
  begin() { this.used = 0; }
  get(tex: Texture): Sprite {
    let s = this.items[this.used];
    if (!s) { s = new Sprite(tex); this.layer.addChild(s); this.items.push(s); }
    this.used++;
    s.texture = tex; s.visible = true; s.anchor.set(0.5); s.scale.set(1); s.rotation = 0; s.tint = 0xffffff; s.alpha = 1; s.blendMode = 'normal';
    return s;
  }
  end() { for (let i = this.used; i < this.items.length; i++) this.items[i].visible = false; }
}

/** Tanks are drawn this much bigger than their hit circle. */
const UNIT_ART_SCALE = 1.45;

function seeded(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Renderer {
  app!: Application;
  private art!: Art;
  private world = new Container();
  // back to front: terrain, overtime ring, ground items, tank shadows, hulls, colour patterns, guns, overlays, shots, effects, labels
  private bg = new Container();
  private under = new Graphics();
  private itemsLayer = new Container();
  private itemsG = new Graphics();
  private shadowLayer = new Container();
  private hullLayer = new Container();
  private patterns = new Graphics();
  private gunLayer = new Container();
  private over = new Graphics();
  private projG = new Graphics();
  private projLayer = new Container();
  private fxLayer = new Container();
  private labels = new Container();
  private itemPool!: SpritePool;
  private shadowPool!: SpritePool;
  private hullPool!: SpritePool;
  private gunPool!: SpritePool;
  private projPool!: SpritePool;
  private fxPool!: SpritePool;
  private screen = new Graphics();
  private mask = new Graphics();
  private names!: TextPool;
  private small!: TextPool;
  private beaconText!: Text;
  scale = 1;
  cam = { x: MAP_CENTER, y: MAP_CENTER };
  private scopeAmt = 0;
  private t = 0;
  w = 0;
  h = 0;

  async init(host: HTMLElement) {
    this.app = new Application();
    await this.app.init({ resizeTo: window, background: 0x07100c, antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true });
    host.append(this.app.canvas);
    this.art = await loadArt();
    this.world.addChild(this.bg, this.under, this.itemsLayer, this.itemsG, this.shadowLayer, this.hullLayer, this.patterns, this.gunLayer,
      this.over, this.projG, this.projLayer, this.fxLayer, this.labels);
    this.itemPool = new SpritePool(this.itemsLayer); this.shadowPool = new SpritePool(this.shadowLayer); this.hullPool = new SpritePool(this.hullLayer);
    this.gunPool = new SpritePool(this.gunLayer); this.projPool = new SpritePool(this.projLayer); this.fxPool = new SpritePool(this.fxLayer);
    this.app.stage.addChild(this.world, this.mask, this.screen);
    this.world.mask = this.mask;
    this.names = new TextPool(this.labels, nameStyle);
    this.small = new TextPool(this.labels, smallStyle);
    this.beaconText = new Text({ text: 'LEADER', style: smallStyle });
    this.beaconText.anchor.set(0.5);
    this.beaconText.visible = false;
    this.app.stage.addChild(this.beaconText);
    this.resize();
    window.addEventListener('resize', this.resize);
  }
  private resize = () => {
    this.w = this.app.screen.width; this.h = this.app.screen.height;
    const vw = Math.min(this.w, (this.h * 16) / 9), vh = (vw * 9) / 16;
    this.mask.clear().rect((this.w - vw) / 2, (this.h - vh) / 2, vw, vh).fill(0xffffff);
  };
  /** The 16:9 rectangle the player is allowed to see, in screen pixels. */
  view() {
    const vw = Math.min(this.w, (this.h * 16) / 9), vh = (vw * 9) / 16;
    return { x: (this.w - vw) / 2, y: (this.h - vh) / 2, w: vw, h: vh };
  }

  buildMap(world: World) {
    const a = this.art;
    for (const c of this.bg.removeChildren()) c.destroy();
    // outside the arena: the same ground, darkened, so the edge of the map never shows a black void
    const OUT = 4000;
    const outside = new TilingSprite({ texture: a.ground, width: MAP_SIZE + OUT * 2, height: MAP_SIZE + OUT * 2 });
    outside.position.set(-OUT, -OUT); outside.tint = 0x9aaaa2;
    this.bg.addChild(outside);
    this.bg.addChild(new TilingSprite({ texture: a.ground, width: MAP_SIZE, height: MAP_SIZE }));
    const grid = new Graphics();
    for (let v = 0; v <= MAP_SIZE; v += 160) {
      grid.moveTo(v, 0).lineTo(v, MAP_SIZE).stroke({ width: 2, color: 0x2a4034, alpha: 0.35 });
      grid.moveTo(0, v).lineTo(MAP_SIZE, v).stroke({ width: 2, color: 0x2a4034, alpha: 0.35 });
    }
    this.bg.addChild(grid);

    // scenery scattered from the world seed: the same arena looks the same for everyone
    const f = world.foundry;
    const rnd = seeded(world.seed ^ 0x5eed);
    const blocked = (x: number, y: number, m: number) =>
      world.walls.some((w) => x > w.x - m && x < w.x + w.w + m && y > w.y - m && y < w.y + w.h + m) ||
      (x > f.x - m && x < f.x + f.w + m && y > f.y - m && y < f.y + f.h + m) ||
      world.pads.some((p) => Math.hypot(p.x - x, p.y - y) < 110) ||
      world.mines.some((mn) => Math.hypot(mn.x - x, mn.y - y) < mn.r + m);
    for (let placed = 0, tries = 0; placed < 120 && tries < 600; tries++) {
      const x = 80 + rnd() * (MAP_SIZE - 160), y = 80 + rnd() * (MAP_SIZE - 160), pick = rnd();
      if (blocked(x, y, 50)) continue;
      const s = new Sprite(pick < 0.3 ? a.craters : pick < 0.55 ? a.rock : a.tuft);
      s.anchor.set(0.5); s.position.set(x, y);
      const size = pick < 0.3 ? 90 + rnd() * 100 : pick < 0.55 ? 30 + rnd() * 34 : 44 + rnd() * 40;
      s.scale.set(size / (pick < 0.3 ? 160 : 96));
      s.rotation = pick < 0.55 ? rnd() * 6.28 : (rnd() - 0.5) * 0.5;
      s.alpha = 0.75 + rnd() * 0.25;
      this.bg.addChild(s);
      placed++;
    }

    const zones = new Graphics();
    for (const m of world.mines) zones.circle(m.x, m.y, m.r).fill({ color: 0x7a2f1a, alpha: 0.22 }).stroke({ width: 5, color: 0xc2551b, alpha: 0.7 });
    this.bg.addChild(zones);
    for (const m of world.mines) {
      for (let i = 0; i < 14; i++) {
        const ang = i * 2.4, d = 40 + ((i * 53) % (m.r - 60));
        const s = new Sprite(a.mine);
        s.anchor.set(0.5); s.position.set(m.x + Math.cos(ang) * d, m.y + Math.sin(ang) * d); s.scale.set(30 / 64); s.rotation = i; s.alpha = 0.9;
        this.bg.addChild(s);
      }
    }

    const grate = new TilingSprite({ texture: a.grate, width: f.w, height: f.h });
    grate.position.set(f.x, f.y); grate.tileScale.set(0.75); grate.alpha = 0.95;
    this.bg.addChild(grate);
    const edge = 14;
    for (const [x, y, w, h] of [[f.x - edge, f.y - edge, f.w + edge * 2, edge], [f.x - edge, f.y + f.h, f.w + edge * 2, edge], [f.x - edge, f.y, edge, f.h], [f.x + f.w, f.y, edge, f.h]]) {
      const hz = new TilingSprite({ texture: a.hazard, width: w, height: h });
      hz.position.set(x, y); hz.tileScale.set(0.4); hz.alpha = 0.9;
      this.bg.addChild(hz);
    }

    for (const p of world.pads) {
      const s = new Sprite(a.pad);
      s.anchor.set(0.5); s.position.set(p.x, p.y); s.width = s.height = 112;
      this.bg.addChild(s);
    }

    const walls = new Graphics();
    for (const w of world.walls) walls.rect(w.x + 7, w.y + 9, w.w, w.h).fill({ color: 0x000000, alpha: 0.35 });
    this.bg.addChild(walls);
    for (const w of world.walls) {
      const t = new TilingSprite({ texture: a.wall, width: w.w, height: w.h });
      t.position.set(w.x, w.y); t.tileScale.set(0.6);
      this.bg.addChild(t);
    }
    const edges = new Graphics();
    for (const w of world.walls) edges.rect(w.x, w.y, w.w, w.h).stroke({ width: 3, color: 0xa9bcb1 }).rect(w.x + 3, w.y + 3, w.w - 6, w.h - 6).stroke({ width: 1.5, color: 0x2c3832, alpha: 0.7 });
    edges.rect(0, 0, MAP_SIZE, MAP_SIZE).stroke({ width: 10, color: 0x4fc3c8, alpha: 0.9 });
    this.bg.addChild(edges);
  }

  private ring(g: Graphics, x: number, y: number, r: number, pat: number, color: number) {
    const dark = 0x10201a;
    switch (pat) {
      case 1: for (let i = 0; i < 12; i++) { const a = i * 0.5236; g.moveTo(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7).arc(x, y, r * 0.7, a, a + 0.32).stroke({ width: Math.max(2, r * 0.1), color: dark }); } break;
      case 2: for (let i = 0; i < 10; i++) { const a = i * 0.6283; g.circle(x + Math.cos(a) * r * 0.72, y + Math.sin(a) * r * 0.72, Math.max(1.6, r * 0.07)).fill(dark); } break;
      case 3: g.circle(x, y, r * 0.78).stroke({ width: 2, color: dark }).circle(x, y, r * 0.55).stroke({ width: 2, color: dark }); break;
      case 4: for (let i = 0; i < 4; i++) { const a = i * 1.5708 + 0.785; g.circle(x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78, Math.max(2, r * 0.12)).fill(dark); } break;
      case 5: for (let i = 0; i < 3; i++) { const a = i * 2.0944; g.moveTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9).lineTo(x + Math.cos(a + 0.35) * r * 0.5, y + Math.sin(a + 0.35) * r * 0.5).lineTo(x + Math.cos(a - 0.35) * r * 0.5, y + Math.sin(a - 0.35) * r * 0.5).fill(dark); } break;
      case 6: g.moveTo(x - r * 0.6, y).lineTo(x + r * 0.6, y).stroke({ width: Math.max(2, r * 0.1), color: dark }).moveTo(x, y - r * 0.6).lineTo(x, y + r * 0.6).stroke({ width: Math.max(2, r * 0.1), color: dark }); break;
      case 7: g.circle(x, y, r * 0.86).stroke({ width: Math.max(3, r * 0.2), color: dark, alpha: 0.9 }); break;
      default:
    }
    void color;
  }

  private unit(x: number, y: number, angle: number, r: number, slot: number, weapon: number, flags: number, hpFrac: number, flash: boolean, own: boolean, alive = true) {
    const a = this.art;
    const k = (r / 51) * UNIT_ART_SCALE; // the hull picture has a body radius of about 51 pixels; drawn larger than the hit circle so tanks read at a glance
    const ov = this.over;
    if (flags & UF_PROTECTED) ov.circle(x, y, r * UNIT_ART_SCALE + 7 + Math.sin(this.t * 6) * 1.5).fill({ color: 0xffffff, alpha: 0.18 }).stroke({ width: 2, color: 0xffffff, alpha: 0.7 });
    if (flags & UF_SHIELD) ov.circle(x, y, r * UNIT_ART_SCALE + 5).stroke({ width: 3, color: 0x4fc3c8, alpha: 0.9 });
    const sh = this.shadowPool.get(a.glow);
    sh.position.set(x + 3, y + 6); sh.width = sh.height = r * 3.1 * UNIT_ART_SCALE; sh.tint = 0x000000; sh.alpha = 0.5;
    const hull = this.hullPool.get(a.hulls[weapon <= 1 ? 0 : weapon <= 3 ? 1 : 2]);
    hull.position.set(x, y); hull.rotation = angle; hull.scale.set(k); hull.tint = flash ? 0xffffff : PALETTE[slot % 8];
    this.ring(this.patterns, x, y, r * UNIT_ART_SCALE, slot % 8, PALETTE[slot % 8]);
    const gun = this.gunPool.get(a.guns[weapon] ?? a.guns[0]);
    gun.position.set(x, y); gun.rotation = angle; gun.scale.set(k);
    if (own) ov.circle(x, y, r * UNIT_ART_SCALE + 1).stroke({ width: 3, color: 0xffffff, alpha: 0.95 });
    if (flags & UF_SCOPING) ov.moveTo(x + Math.cos(angle) * r * 1.6, y + Math.sin(angle) * r * 1.6).lineTo(x + Math.cos(angle) * 360, y + Math.sin(angle) * 360).stroke({ width: 1.5, color: 0xffffff, alpha: 0.22 });
    if (hpFrac < 0.999 && alive) {
      const w = r * 2 * UNIT_ART_SCALE, hy = y - r * UNIT_ART_SCALE - 10;
      ov.rect(x - w / 2, hy, w, 5).fill({ color: 0x000000, alpha: 0.6 });
      ov.rect(x - w / 2, hy, w * Math.max(0, hpFrac), 5).fill(hpFrac > 0.5 ? 0x7bd389 : hpFrac > 0.25 ? 0xffb74d : 0xf28b82);
    }
  }

  frame(cw: ClientWorld, perfNow: number, dt: number, alpha: number, scoping: boolean, hasWorld: boolean) {
    this.t = perfNow / 1000;
    if (!hasWorld) return;
    const own = cw.own;
    const alive = !!own && (own.flags & 1) !== 0;
    const pose = own ? (alive ? cw.ownPose(alpha) : { x: own.x, y: own.y, angle: cw.pred.aim }) : { x: MAP_CENTER, y: MAP_CENTER, angle: 0 };

    // camera: frame the Look circle; scoping pans toward the aim by up to the Scope reach
    const look = cw.ownStats.look;
    const targetScale = Math.min(this.w, (this.h * 16) / 9) / (CAMERA_FRAMING * look);
    this.scale += (targetScale - this.scale) * (1 - Math.exp(-dt / 0.4));
    this.scopeAmt += ((scoping && alive ? 1 : 0) - this.scopeAmt) * (1 - Math.exp(-dt / 0.15));
    const reach = cw.ownStats.scope * this.scopeAmt;
    this.cam.x = pose.x + Math.cos(pose.angle) * reach;
    this.cam.y = pose.y + Math.sin(pose.angle) * reach;
    this.world.scale.set(this.scale);
    this.world.position.set(this.w / 2 - this.cam.x * this.scale, this.h / 2 - this.cam.y * this.scale);

    this.under.clear(); this.itemsG.clear(); this.patterns.clear(); this.over.clear(); this.projG.clear();
    for (const pl of [this.itemPool, this.shadowPool, this.hullPool, this.gunPool, this.projPool, this.fxPool]) pl.begin();
    const a = this.art;
    const halfW = this.w / 2 / this.scale + 60, halfH = this.h / 2 / this.scale + 60;
    const vis = (x: number, y: number, m = 0) => Math.abs(x - this.cam.x) < halfW + m && Math.abs(y - this.cam.y) < halfH + m;

    // overtime ring
    const ring = cw.state?.ring ?? 0;
    if (ring > 0) {
      this.under.circle(MAP_CENTER, MAP_CENTER, ring + 1500).stroke({ width: 3000, color: 0xd63939, alpha: 0.16 });
      this.under.circle(MAP_CENTER, MAP_CENTER, ring).stroke({ width: 10, color: 0xff5252, alpha: 0.9 });
    }
    // scrap
    const pulse = 0.75 + 0.25 * Math.sin(this.t * 5);
    for (const p of cw.pellets.values()) {
      if (!vis(p.x, p.y)) continue;
      const s = this.itemPool.get(a.scrap);
      s.position.set(p.x, p.y); s.width = s.height = 17; s.alpha = pulse; s.rotation = this.t * 0.8 + p.x;
    }
    // crates
    for (const c of cw.crates) {
      if (!vis(c.x, c.y)) continue;
      const hp = c.hpPct / 255;
      const s = this.itemPool.get(a.crate);
      s.position.set(c.x, c.y); s.width = s.height = CRATE_RADIUS * 2.3;
      if (hp < 0.999) this.itemsG.rect(c.x - 24, c.y - 38, 48 * hp, 5).fill(0xffb74d);
    }
    // power-ups sit on the ground, each with its own picture
    for (const p of cw.powerups) {
      if (!vis(p.x, p.y)) continue;
      const s = this.itemPool.get(a.powerups[(p.kind - 1) % 4]);
      s.position.set(p.x, p.y); s.width = s.height = 56 + Math.sin(this.t * 4 + p.id) * 4;
    }
    // units (remote ones are drawn 100 ms in the past)
    const rt = cw.renderServerTime(perfNow);
    this.names.begin(); this.small.begin();
    for (const tr of cw.units.values()) {
      const p = cw.unitPose(tr, rt);
      if (!vis(p.x, p.y, 60)) continue;
      const u = tr.last;
      this.unit(p.x, p.y, p.angle, u.radius, u.slot, u.weapon, u.flags, u.hpPct / 200, perfNow < tr.flashUntil, false);
      this.names.get(cw.nameOf(u.slot), p.x, p.y - u.radius * UNIT_ART_SCALE - 14, 0xffffff, 0.95);
      const em = cw.emotes.get(u.slot);
      if (em) this.small.get(em.text, p.x, p.y - u.radius * UNIT_ART_SCALE - 36, 0xfff2c0);
    }
    if (own && alive) {
      const flags = ((own.flags & 2) ? UF_PROTECTED : 0) | ((own.flags & 4) ? UF_SCOPING : 0) | ((own.flags & 8) ? UF_SHIELD : 0);
      this.unit(pose.x, pose.y, pose.angle, cw.ownStats.radius, cw.slot, cw.ownStats.weapon.id, flags, own.hp / Math.max(1, own.maxHp), false, true);
      this.names.get('YOU', pose.x, pose.y - cw.ownStats.radius * UNIT_ART_SCALE - 14, 0xffffff, 1);
      const em = cw.emotes.get(cw.slot);
      if (em) this.small.get(em.text, pose.x, pose.y - cw.ownStats.radius * UNIT_ART_SCALE - 36, 0xfff2c0);
    } else if (own && !alive) {
      this.over.circle(pose.x, pose.y, cw.ownStats.radius).stroke({ width: 3, color: 0xf28b82, alpha: 0.5 });
    }
    // projectiles
    for (const p of cw.projectiles.values()) {
      const pos = cw.projPos(p, perfNow);
      if (pos.age < 0 || !vis(pos.x, pos.y)) continue;
      const w = WEAPONS[p.weapon] ?? WEAPONS[0];
      if (w.arcs) {
        this.projG.circle(pos.x + 3, pos.y + 14, 7).fill({ color: 0x000000, alpha: 0.3 });
        const s = this.projPool.get(a.shell);
        s.position.set(pos.x, pos.y); s.width = s.height = 22 + Math.sin(this.t * 14) * 2; s.rotation = this.t * 6;
      } else {
        const rail = w.id === 3;
        const s = this.projPool.get(rail ? a.bolt : a.bullet);
        s.anchor.set(1, 0.5); s.position.set(pos.x, pos.y); s.rotation = Math.atan2(p.dy, p.dx);
        s.width = rail ? 120 : 42; s.height = rail ? 16 : 10; s.tint = PALETTE[p.owner % 8]; s.alpha = 0.9; s.blendMode = 'add';
        const head = this.projPool.get(a.glow);
        head.position.set(pos.x, pos.y); head.width = head.height = rail ? 24 : 16; head.blendMode = 'add';
      }
    }
    // effects
    for (const f of cw.fx) {
      const k = (perfNow - f.t0) / f.life;
      if (k < 0 || k > 1 || !vis(f.x, f.y, 100)) continue;
      const put = (tex: Texture, size: number, tint: number, alpha: number, additive: boolean, rot = 0) => {
        const s = this.fxPool.get(tex);
        s.position.set(f.x, f.y); s.width = s.height = size; s.tint = tint; s.alpha = alpha; s.rotation = rot;
        if (additive) s.blendMode = 'add';
      };
      const RING = 2.3; // the ring picture fills 87% of its square
      switch (f.kind) {
        case 'muzzle': put(a.flash, f.r * 2.6 * (1 - k * 0.5), f.color, 0.9 * (1 - k), true, f.t0 % 6.28); break;
        case 'spark': put(a.glow, f.r * 2 * (0.6 + k), f.color, 0.9 * (1 - k), true); break;
        case 'boom': {
          const g = 0.3 + 0.7 * k;
          put(a.smoke, f.r * 2.6 * (0.4 + 0.8 * k), 0xffffff, 0.55 * (1 - k) * Math.min(1, k * 5), false, f.t0 % 6.28);
          put(a.glow, f.r * 2.4 * g, f.color, 0.95 * (1 - k), true);
          put(a.ring, f.r * RING * g, 0xfff1c9, 0.9 * (1 - k), true);
          break;
        }
        case 'tier': put(a.ring, f.r * RING * k, f.color, 1 - k, false); break;
        case 'kill': put(a.glow, f.r * 2 * k, f.color, 0.55 * (1 - k), true); put(a.ring, f.r * RING * k, 0xffd180, 1 - k, true); break;
        default: put(a.ring, f.r * RING * k, f.color, 1 - k, false);
      }
    }
    for (const fl of cw.floaters) {
      const k = (perfNow - fl.t0) / 800;
      this.small.get(fl.text, fl.x, fl.y - 30 * k, fl.color, 1 - k * k);
    }
    for (const pl of [this.itemPool, this.shadowPool, this.hullPool, this.gunPool, this.projPool, this.fxPool]) pl.end();
    this.names.end(); this.small.end();

    this.drawBeacon(cw, pose);
  }

  /** Arrow at the edge of the view pointing to the room leader once the beacon is on (Section 8). */
  private drawBeacon(cw: ClientWorld, pose: { x: number; y: number }) {
    const s = this.screen.clear();
    this.beaconText.visible = false;
    if (cw.beaconSlot < 0 || cw.beaconSlot === cw.slot) return;
    const tr = cw.units.get(cw.beaconSlot);
    if (!tr) return;
    const v = this.view();
    const sx = this.w / 2 + (tr.last.x - this.cam.x) * this.scale;
    const sy = this.h / 2 + (tr.last.y - this.cam.y) * this.scale;
    const m = 36;
    if (sx > v.x + m && sx < v.x + v.w - m && sy > v.y + m && sy < v.y + v.h - m) return;
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    const dx = sx - cx, dy = sy - cy;
    const k = Math.min((v.w / 2 - m) / Math.max(1, Math.abs(dx)), (v.h / 2 - m) / Math.max(1, Math.abs(dy)));
    const ax = cx + dx * k, ay = cy + dy * k;
    const a = Math.atan2(dy, dx);
    s.moveTo(ax + Math.cos(a) * 18, ay + Math.sin(a) * 18).lineTo(ax + Math.cos(a + 2.5) * 16, ay + Math.sin(a + 2.5) * 16).lineTo(ax + Math.cos(a - 2.5) * 16, ay + Math.sin(a - 2.5) * 16).fill(0xe39a6b).stroke({ width: 2, color: 0x000000 });
    this.beaconText.visible = true;
    this.beaconText.text = `LEADER ${cw.nameOf(cw.beaconSlot)}`;
    this.beaconText.x = ax - Math.cos(a) * 54; this.beaconText.y = ay - Math.sin(a) * 30;
    void pose;
  }

  destroy() {
    window.removeEventListener('resize', this.resize);
    this.app?.destroy(true, { children: true });
  }
}
