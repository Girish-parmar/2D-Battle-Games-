// Every number in this file comes from the design canvas. The section that
// defines it is named beside it so a change here can be traced back.

// ---- World and timing (Sections 3, 10, A6, A15) ----------------------------
export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;
export const DT = 1 / TICK_HZ;
export const MAP_SIZE = 3200; // wu, square map, bounded
export const MAP_CENTER = MAP_SIZE / 2;
export const MAX_UNITS = 32; // hard room maximum
export const TARGET_UNITS = 24;
export const MIN_START_UNITS = 12;
export const FORMING_MAX_S = 20;
export const WARMUP_S = 15;
export const ENDING_S = 5;
export const RESULTS_S = 20;
export const LATE_JOIN_FRACTION = 0.4;
export const OVERTIME_S = 120;
export const OVERTIME_TRIGGER_GAP = 0.05;
export const OVERTIME_RING_START = 1600;
export const OVERTIME_RING_END = 600;
export const OVERTIME_RING_DPS = 15;
export const MERCY_RATIO = 2.5;
export const MERCY_HOLD_S = 60;
export const MIN_MATCH_S = 300;
export const MAX_MATCH_S = 900;
export const GHOST_S = 8;
export const RECONNECT_S = 60;
export const ABORT_HUMANS_S = 30;
export const INTERP_MS = 100;
export const LAG_COMP_MAX_MS = 200;
export const HISTORY_TICKS = 10;

// ---- Scrap, crates, hazards (Section 3) -------------------------------------
export const PELLET_COUNT = 450;
export const PELLET_RADIUS = 5;
export const PELLET_RESPAWN_S = 12;
export const PELLET_MIN_UNIT_DIST = 300;
export const PELLET_BASE_VALUE = 2.0;
export const PELLET_TIER_DECAY = 0.15;
export const PELLET_MIN_VALUE = 0.65;
export const MAGNET_RADIUS = 40;
export const CRATE_COUNT = 10;
export const CRATES_FOUNDRY = 6;
export const CRATE_HP = 80;
export const CRATE_POINTS = 25;
export const CRATE_RESPAWN_S = 40;
export const CRATE_RADIUS = 24;
export const FOUNDRY_SIZE = 800;
export const WALL_COUNT = 40;
export const SPAWN_PADS = 16;
export const MINEFIELD_COUNT = 4;
export const MINEFIELD_RADIUS = 250;
export const MINE_DAMAGE = 30;
export const MINE_INTERVAL_S = 3;
export const POWERUP_PICKUP_RADIUS = 28;

// ---- Growth, tiers (Sections 3, 5) ------------------------------------------
export const TIER_THRESHOLDS = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200] as const;
export const MAX_TIER = 10;
export const GS_CAP = 3200;
export const RADIUS_MIN = 16;
export const RADIUS_SPAN = 24;
export const HULL_BASE = 100;
export const HULL_GROWTH = 1.5;
export const SPEED_BASE = 240;
export const SPEED_GROWTH = 0.3;
export const LOOK_BASE = 600;
export const LOOK_GROWTH = 0.2;
export const SCOPE_BASE = 150;
export const SCOPE_SPEED_PENALTY = 0.25;
export const REPAIR_BASE = 2.0;
export const REPAIR_DELAY_S = 5;
export const CAMERA_FRAMING = 1.743; // view width = 1.743 * Look (16:9, half-diagonal = Look)
export const AIM_TURN_RATE = 18; // rad/s base turn rate

// Hard caps (Section 4)
export const CAPS = {
  hull: 300,
  armor: 3.0,
  repair: 6.0,
  speed: 300,
  speedBuffed: 330,
  damageMult: 1.25,
  fireMult: 1.5,
  dpsMult: 1.6,
  rangeMult: 1.4,
  look: 900,
  lookBuffed: 1000,
  scope: 350,
  feed: 1.3,
  rebornFloorS: 2.0,
  rebornCeilS: 6.6
} as const;
export const ARMOR_FLOOR = 0.3; // damage never below 30% of the hit

// ---- Death, respawn, protection (A9) ----------------------------------------
export const RESPAWN_BASE_S = 3.0;
export const RESPAWN_PER_TIER_S = 0.4;
export const DEATH_KEEP = 0.25;
export const SPAWN_PROTECT_S = 3;
export const LATE_PROTECT_S = 5;
export const SPAWN_CLEARANCE = 700;
export const SPAWN_PAD_COOLDOWN_S = 5;
export const SPAWN_KILL_WINDOW_S = 4;

// ---- Scoring (Section 3) -----------------------------------------------------
export const KILL_BASE = 40;
export const KILL_RATE = 0.15;
export const KILL_CAP = 400;
export const UNDERDOG_TIERS = 2;
export const UNDERDOG_MULT = 1.25;
export const ASSIST_BASE = 15;
export const ASSIST_RATE = 0.05;
export const ASSIST_DAMAGE_FRACTION = 0.25;
export const ASSIST_WINDOW_S = 5;
export const REPEAT_KILL_WINDOW_S = 120;
export const REPEAT_KILL_PAY = [1, 0.5, 0.25, 0] as const;
export const BOT_BOUNTY_MULT = 0.5;
export const BEACON_AFTER_S = 180;
export const BEACON_MIN_MS = 1400;

// ---- Weapons (Section 3) -------------------------------------------------------
export interface PelletSpec {
  angle: number; // radians offset from aim
  lateral: number; // wu offset perpendicular to aim
}
export interface WeaponDef {
  id: number;
  code: string;
  name: string;
  unlockTier: number;
  pellets: PelletSpec[];
  damage: number;
  rate: number; // volleys per second
  speed: number; // wu/s
  range: number; // wu
  radius: number; // projectile hit radius
  pierce: number; // extra targets pierced
  pierceFactor: number;
  aoeRadius: number;
  aoeFalloff: number; // damage fraction at the blast edge
  minRange: number;
  turnMult: number;
  arcs: boolean; // flies over walls
}
const deg = (d: number) => (d * Math.PI) / 180;
export const WEAPONS: readonly WeaponDef[] = [
  { id: 0, code: 'W1', name: 'Rifle Cannon', unlockTier: 1, pellets: [{ angle: 0, lateral: 0 }], damage: 12, rate: 3.0, speed: 700, range: 520, radius: 4, pierce: 0, pierceFactor: 1, aoeRadius: 0, aoeFalloff: 1, minRange: 0, turnMult: 1, arcs: false },
  { id: 1, code: 'W2', name: 'Twin Cannon', unlockTier: 3, pellets: [{ angle: 0, lateral: -12 }, { angle: 0, lateral: 12 }], damage: 11, rate: 2.1, speed: 700, range: 520, radius: 4, pierce: 0, pierceFactor: 1, aoeRadius: 0, aoeFalloff: 1, minRange: 0, turnMult: 1, arcs: false },
  { id: 2, code: 'W3', name: 'Spread Launcher', unlockTier: 5, pellets: [{ angle: -deg(8), lateral: 0 }, { angle: 0, lateral: 0 }, { angle: deg(8), lateral: 0 }], damage: 9, rate: 1.8, speed: 620, range: 420, radius: 4, pierce: 0, pierceFactor: 1, aoeRadius: 0, aoeFalloff: 1, minRange: 0, turnMult: 1, arcs: false },
  { id: 3, code: 'W4', name: 'Rail Lance', unlockTier: 7, pellets: [{ angle: 0, lateral: 0 }], damage: 40, rate: 1.3, speed: 1200, range: 700, radius: 5, pierce: 1, pierceFactor: 0.6, aoeRadius: 0, aoeFalloff: 1, minRange: 0, turnMult: 0.7, arcs: false },
  { id: 4, code: 'W5', name: 'Siege Mortar', unlockTier: 9, pellets: [{ angle: 0, lateral: 0 }], damage: 55, rate: 1.1, speed: 450, range: 650, radius: 8, pierce: 0, pierceFactor: 1, aoeRadius: 70, aoeFalloff: 0.5, minRange: 150, turnMult: 1, arcs: true }
];

export const PROJECTILE_CAP = 600;
export const MORTAR_FUSE_RADIUS = 36;

// ---- Power-ups (Section 3) ---------------------------------------------------
export type PowerupKind = 'overdrive' | 'aegis' | 'radar' | 'nitro';
export const POWERUP_KINDS: PowerupKind[] = ['overdrive', 'aegis', 'radar', 'nitro'];
export const POWERUPS: Record<PowerupKind, { name: string; duration: number; mult?: number; shield?: number }> = {
  overdrive: { name: 'Overdrive', duration: 10, mult: 1.3 },
  aegis: { name: 'Aegis', duration: 12, shield: 60 },
  radar: { name: 'Radar', duration: 12, mult: 1.3 },
  nitro: { name: 'Nitro', duration: 8, mult: 1.25 }
};

// ---- Stats, items, Mk ladder (Sections 4, 7) --------------------------------
export type StatKey = 'hull' | 'armor' | 'repair' | 'speed' | 'damage' | 'fireRate' | 'range' | 'look' | 'scope' | 'feed' | 'reborn';
export const STAT_KEYS: StatKey[] = ['hull', 'armor', 'repair', 'speed', 'damage', 'fireRate', 'range', 'look', 'scope', 'feed', 'reborn'];
// Weighted Power per 1% of the stat (armor: per +1.0 flat; scope: per wu).
// CALIBRATED against the bot simulators (apps/server/scripts/probe.ts). The design canvas starts from
// hull 1.0, armor 7.0, speed 0.6, fireRate 1.0, range 0.4, feed 0.5, reborn 0.3. The probes showed range, damage and
// speed worth more per percent and hull, armor and respawn worth less, so item sizes were rebalanced. Look, scope and
// repair keep their design weights because the bots cannot use them well enough to measure them. A later pass that
// also cut repair to 0.06 and reborn to 0.16 spread the builds further apart (see BALANCE.md), so it was reverted.
// Re-run the probes after real playtests: bots rank by score only and never scope, so they undervalue defence and
// awareness.
export const STAT_WEIGHT: Record<StatKey, number> = {
  hull: 0.7, armor: 4.5, repair: 0.1, speed: 0.52, damage: 1.0, fireRate: 0.7,
  range: 0.8, look: 0.3, scope: 0.08, feed: 0.45, reborn: 0.2
};
export const ITEM_BONUS_WP = 8.0;
export const ITEM_DRAWBACK_WP = 6.25;

export type Slot = 'weapon' | 'hull' | 'engine' | 'sensor' | 'utility';
export const SLOTS: Slot[] = ['weapon', 'hull', 'engine', 'sensor', 'utility'];

export interface ItemDef {
  id: string;
  name: string;
  slot: Slot;
  primary: StatKey;
  drawback: StatKey;
}
export const ITEMS: readonly ItemDef[] = [
  { id: 'hardened_rounds', name: 'Hardened Rounds', slot: 'weapon', primary: 'damage', drawback: 'fireRate' },
  { id: 'rapid_loader', name: 'Rapid Loader', slot: 'weapon', primary: 'fireRate', drawback: 'damage' },
  { id: 'long_barrel', name: 'Long Barrel', slot: 'weapon', primary: 'range', drawback: 'speed' },
  { id: 'heavy_plating', name: 'Heavy Plating', slot: 'hull', primary: 'hull', drawback: 'speed' },
  { id: 'reactive_armor', name: 'Reactive Armor', slot: 'hull', primary: 'armor', drawback: 'hull' },
  { id: 'afterburner', name: 'Afterburner', slot: 'engine', primary: 'speed', drawback: 'hull' },
  { id: 'phoenix_core', name: 'Phoenix Core', slot: 'engine', primary: 'reborn', drawback: 'speed' },
  { id: 'wide_radar', name: 'Wide-Angle Radar', slot: 'sensor', primary: 'look', drawback: 'speed' },
  { id: 'tele_optics', name: 'Tele-Optics', slot: 'sensor', primary: 'scope', drawback: 'look' },
  { id: 'scavenger_magnet', name: 'Scavenger Magnet', slot: 'utility', primary: 'feed', drawback: 'damage' },
  { id: 'field_repair', name: 'Field Repair Kit', slot: 'utility', primary: 'repair', drawback: 'damage' }
];
export const ITEM_BY_ID: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

export interface MkDef {
  mk: number;
  factor: number;
  pp: number;
  price: number;
  cumulative: number;
  unlockLevel: number;
  rarity: string;
}
export const MK_LADDER: readonly MkDef[] = [
  { mk: 1, factor: 0.4, pp: 2, price: 150, cumulative: 150, unlockLevel: 1, rarity: 'Common' },
  { mk: 2, factor: 0.7, pp: 4, price: 350, cumulative: 500, unlockLevel: 3, rarity: 'Common' },
  { mk: 3, factor: 1.0, pp: 7, price: 750, cumulative: 1250, unlockLevel: 5, rarity: 'Uncommon' },
  { mk: 4, factor: 1.3, pp: 11, price: 1500, cumulative: 2750, unlockLevel: 10, rarity: 'Rare' },
  { mk: 5, factor: 1.6, pp: 16, price: 3000, cumulative: 5750, unlockLevel: 30, rarity: 'Epic' }
];
export const SALVAGE_REFUND = 0.7;
export const ITEM_SHARE_MAX = 0.35;

// ---- Brackets, levels (Sections 5, 6) --------------------------------------
export interface BracketDef {
  id: number; // 1..5
  name: string;
  minLevel: number;
  maxLevel: number;
  ppCap: number;
  baseLenS: number;
  botAimDeg: number;
  botReactMs: number;
}
export const BRACKETS: readonly BracketDef[] = [
  { id: 1, name: 'Recruit', minLevel: 1, maxLevel: 9, ppCap: 25, baseLenS: 360, botAimDeg: 14, botReactMs: 500 },
  { id: 2, name: 'Soldier', minLevel: 10, maxLevel: 19, ppCap: 32, baseLenS: 480, botAimDeg: 10, botReactMs: 400 },
  { id: 3, name: 'Veteran', minLevel: 20, maxLevel: 29, ppCap: 39, baseLenS: 600, botAimDeg: 7, botReactMs: 300 },
  { id: 4, name: 'Elite', minLevel: 30, maxLevel: 39, ppCap: 46, baseLenS: 720, botAimDeg: 5, botReactMs: 220 },
  { id: 5, name: 'Warlord', minLevel: 40, maxLevel: 50, ppCap: 54, baseLenS: 780, botAimDeg: 3, botReactMs: 160 }
];
export const MAX_LEVEL = 50;
export const ROOKIE_MAX_LEVEL = 4;
export const ROOKIE_BOT_SHARE = 0.6;
export const ROOKIE_BOT_AIM_DEG = 18;
export const ROOKIE_BOT_REACT_MS = 600;
export const ROOKIE_KEEP = 0.25;

// ---- Economy and progression (Sections 5, 7) -------------------------------
export const XP_BASE = 60;
export const XP_PER_MS = 0.1;
export const XP_PLACEMENT = [80, 50, 30] as const;
export const MIN_PLAYED_S = 180;
export const CREDIT_BASE = 30;
export const CREDIT_PER_MS = 0.06;
export const CREDIT_PLACEMENT = [60, 40, 30, 15, 15, 15] as const;
export const CREDIT_DAILY_FIRST = 100;
export const CREDIT_DAILY_FULL_MATCHES = 10;
export const CREDIT_CAP = 25000;
export const RAPID_PLACEMENT_CR = 1300;
export const RAPID_PLACEMENT_XP = 1.5;
export const RAPID_PLACEMENT_LEVEL = 10;

// ---- Ranking (Sections 6, 9) -------------------------------------------------
export const CR_START = 1000;
export const CR_K_NEW = 32;
export const CR_K = 20;
export const CR_NEW_MATCHES = 20;
export const CR_MIN_HUMANS = 4;
export const RP_MIN_HUMANS = 4;
export const RP_HALF_BELOW = 8;
export const DAILY_BEST = 8;
export const WEEKLY_BEST = 30;
export const ALLTIME_MIN_MATCHES = 30;
export const BOARD_SIZE = 100;
export const QUEUE_WINDOW_START = 100;
export const QUEUE_WINDOW_STEP = 50;
export const QUEUE_WINDOW_MAX = 400;
export const PLAY_DOWN_OFFER_S = 45;

// ---- Anti-abuse (Sections 9, 14) -------------------------------------------
export const PAIR_ROOMS_MAX = 5;
export const FEED_SHARE_MAX = 0.4;
export const FEED_MIN_DEATHS = 4;
export const IDLE_KICK_S = 60;
export const WS_MSG_PER_S = 40;
