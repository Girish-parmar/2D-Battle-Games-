import {
  ARMOR_FLOOR, ASSIST_BASE, ASSIST_RATE, BOT_BOUNTY_MULT, BRACKETS, CAPS, CREDIT_BASE, CREDIT_CAP, CREDIT_DAILY_FIRST,
  CREDIT_DAILY_FULL_MATCHES, CREDIT_PER_MS, CREDIT_PLACEMENT, CR_K, CR_K_NEW, CR_MIN_HUMANS, CR_NEW_MATCHES,
  DEATH_KEEP, GS_CAP, HULL_BASE, HULL_GROWTH, ITEM_BONUS_WP, ITEM_BY_ID, ITEM_DRAWBACK_WP, ITEM_SHARE_MAX, KILL_BASE,
  KILL_CAP, KILL_RATE, LOOK_BASE, LOOK_GROWTH, MAGNET_RADIUS, MAX_LEVEL, MAX_TIER, MIN_PLAYED_S, MK_LADDER, PELLET_BASE_VALUE,
  PELLET_MIN_VALUE, PELLET_TIER_DECAY, QUEUE_WINDOW_MAX, QUEUE_WINDOW_START, QUEUE_WINDOW_STEP, RADIUS_MIN, RADIUS_SPAN,
  REPAIR_BASE, REPEAT_KILL_PAY, RESPAWN_BASE_S, RESPAWN_PER_TIER_S, ROOKIE_KEEP, ROOKIE_MAX_LEVEL, RP_HALF_BELOW,
  RP_MIN_HUMANS, SCOPE_BASE, SLOTS, SPEED_BASE, SPEED_GROWTH, STAT_KEYS, STAT_WEIGHT, TIER_THRESHOLDS, UNDERDOG_MULT,
  UNDERDOG_TIERS, WEAPONS, XP_BASE, XP_PER_MS, XP_PLACEMENT, RAPID_PLACEMENT_XP, type BracketDef, type ItemDef,
  type Slot, type StatKey, type WeaponDef
} from './constants.js';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---- Growth and tiers -------------------------------------------------------
export function growthFraction(gs: number): number {
  return Math.sqrt(Math.min(Math.max(gs, 0), GS_CAP) / GS_CAP);
}
export function radiusFor(gs: number): number {
  return RADIUS_MIN + RADIUS_SPAN * growthFraction(gs);
}
export function tierFor(gs: number): number {
  let t = 1;
  for (let i = 0; i < TIER_THRESHOLDS.length; i++) if (gs >= TIER_THRESHOLDS[i]) t = i + 1;
  return t;
}
export function tierThreshold(tier: number): number {
  return TIER_THRESHOLDS[clamp(tier, 1, MAX_TIER) - 1];
}
export function weaponIndexForTier(tier: number): number {
  return Math.min(WEAPONS.length - 1, Math.floor((tier - 1) / 2));
}
export function weaponForTier(tier: number): WeaponDef {
  return WEAPONS[weaponIndexForTier(tier)];
}
/** Progress inside the current tier, 0..1 (1 at max tier). */
export function tierProgress(gs: number): number {
  const t = tierFor(gs);
  if (t >= MAX_TIER) return 1;
  const lo = tierThreshold(t);
  const hi = tierThreshold(t + 1);
  return (gs - lo) / (hi - lo);
}

// ---- Items and stats --------------------------------------------------------
export interface EffectiveItem {
  slot: Slot;
  item: string;
  mk: number;
}
export function mkDef(mk: number) {
  return MK_LADDER[clamp(mk, 1, MK_LADDER.length) - 1];
}
/** Bonus and drawback size in the stat's own unit (percent, flat armor, or wu of scope). */
export function itemEffect(item: ItemDef, mk: number): { primary: number; drawback: number } {
  const f = mkDef(mk).factor;
  return {
    primary: (ITEM_BONUS_WP / STAT_WEIGHT[item.primary]) * f,
    drawback: (ITEM_DRAWBACK_WP / STAT_WEIGHT[item.drawback]) * f
  };
}
export interface Buffs {
  overdrive?: boolean;
  radar?: boolean;
  nitro?: boolean;
}
export interface UnitStats {
  g: number;
  tier: number;
  weapon: WeaponDef;
  radius: number;
  maxHp: number;
  armor: number;
  repair: number;
  speed: number;
  look: number;
  scope: number;
  damageMult: number;
  fireMult: number;
  rangeMult: number;
  feedMult: number;
  rebornMult: number;
  magnet: number;
}
export function itemPct(items: EffectiveItem[]): Record<StatKey, number> {
  const pct = Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) as Record<StatKey, number>;
  for (const it of items) {
    const def = ITEM_BY_ID[it.item];
    if (!def) continue;
    const e = itemEffect(def, it.mk);
    pct[def.primary] += e.primary;
    pct[def.drawback] -= e.drawback;
  }
  return pct;
}
/** `probe` adds raw stat changes (in item units). Only the balance simulators use it, to measure what a stat is worth. */
export function computeStats(gs: number, items: EffectiveItem[], buffs: Buffs = {}, probe?: Partial<Record<StatKey, number>>): UnitStats {
  const g = growthFraction(gs);
  const tier = tierFor(gs);
  const p = itemPct(items);
  if (probe) for (const k of Object.keys(probe) as StatKey[]) p[k] += probe[k] ?? 0;
  const maxHp = clamp(HULL_BASE * (1 + HULL_GROWTH * g) * (1 + p.hull / 100), 20, CAPS.hull);
  const speedCap = buffs.nitro ? CAPS.speedBuffed : CAPS.speed;
  const speed = Math.min(speedCap, SPEED_BASE * (1 - SPEED_GROWTH * g) * (1 + p.speed / 100) * (buffs.nitro ? 1.25 : 1));
  const lookCap = buffs.radar ? CAPS.lookBuffed : CAPS.look;
  const look = Math.min(lookCap, LOOK_BASE * (1 + LOOK_GROWTH * g) * (1 + p.look / 100) * (buffs.radar ? 1.3 : 1));
  let damageMult = clamp(1 + p.damage / 100, 0.5, CAPS.damageMult);
  let fireMult = clamp(1 + p.fireRate / 100, 0.5, CAPS.fireMult) * (buffs.overdrive ? 1.3 : 1);
  if (damageMult * fireMult > CAPS.dpsMult) fireMult = CAPS.dpsMult / damageMult;
  return {
    g,
    tier,
    weapon: weaponForTier(tier),
    radius: radiusFor(gs),
    maxHp,
    armor: clamp(p.armor, 0, CAPS.armor),
    repair: clamp(REPAIR_BASE * (1 + p.repair / 100), 0, CAPS.repair),
    speed,
    look,
    scope: clamp(SCOPE_BASE + p.scope, 0, CAPS.scope),
    damageMult,
    fireMult,
    rangeMult: clamp(1 + p.range / 100, 0.5, CAPS.rangeMult),
    feedMult: clamp(1 + p.feed / 100, 0.5, CAPS.feed),
    rebornMult: clamp(1 - p.reborn / 100, 0.1, 1.5),
    magnet: MAGNET_RADIUS
  };
}

// ---- Combat and scoring -----------------------------------------------------
export function damageAfterArmor(hit: number, armor: number): number {
  return Math.max(ARMOR_FLOOR * hit, hit - armor);
}
export function pelletValue(tier: number, feedMult = 1): number {
  return Math.max(PELLET_MIN_VALUE, PELLET_BASE_VALUE - PELLET_TIER_DECAY * (tier - 1)) * feedMult;
}
/** repeatIndex is how many times this killer already killed this victim in the window (0 = first). */
export function killBounty(victimGs: number, victimTier: number, killerTier: number, repeatIndex: number, victimIsBot: boolean): number {
  let pts = Math.min(KILL_CAP, KILL_BASE + KILL_RATE * victimGs);
  if (victimTier >= killerTier + UNDERDOG_TIERS) pts *= UNDERDOG_MULT;
  pts *= REPEAT_KILL_PAY[Math.min(repeatIndex, REPEAT_KILL_PAY.length - 1)];
  if (victimIsBot) pts *= BOT_BOUNTY_MULT;
  return pts;
}
export function assistBounty(victimGs: number, victimIsBot: boolean): number {
  const pts = ASSIST_BASE + ASSIST_RATE * victimGs;
  return victimIsBot ? pts * BOT_BOUNTY_MULT : pts;
}
/** Growth Score after a death. Match Score is untouched. */
export function deathGs(tier: number, gs: number, rookie: boolean): number {
  if (rookie) {
    const lo = tierThreshold(tier);
    const hi = tier >= MAX_TIER ? lo + 700 : tierThreshold(tier + 1);
    return Math.min(gs, lo + ROOKIE_KEEP * (hi - lo));
  }
  if (tier <= 1) return 0;
  const lo = tierThreshold(tier - 1);
  const hi = tierThreshold(tier);
  return Math.min(gs, lo + DEATH_KEEP * (hi - lo));
}
export function respawnSeconds(tier: number, rebornMult: number): number {
  return Math.max(CAPS.rebornFloorS, (RESPAWN_BASE_S + RESPAWN_PER_TIER_S * (tier - 1)) * rebornMult);
}

// ---- Levels, brackets, budget -----------------------------------------------
export function budgetForLevel(level: number): number {
  return Math.floor((200 + 7 * (clamp(level, 1, MAX_LEVEL) - 1)) / 10); // floor(20 + 0.7 (L-1)), exact in integers
}
export function bracketForLevel(level: number): BracketDef {
  return BRACKETS.find((b) => level >= b.minLevel && level <= b.maxLevel) ?? BRACKETS[BRACKETS.length - 1];
}
export function slotsForLevel(level: number): Slot[] {
  return SLOTS.slice(0, level >= 16 ? 5 : level >= 8 ? 4 : 3);
}
export function isRookie(level: number): boolean {
  return level <= ROOKIE_MAX_LEVEL;
}
export function maxItemPp(bracket: BracketDef): number {
  return ITEM_SHARE_MAX * bracket.ppCap;
}
export function maxMkUnlocked(level: number): number {
  let m = 0;
  for (const d of MK_LADDER) if (level >= d.unlockLevel) m = d.mk;
  return m;
}

export type LoadoutIds = Partial<Record<Slot, string>>;
export type Inventory = Record<string, number>; // item family -> highest Mk owned

export interface FitResult {
  effective: EffectiveItem[];
  dropped: { slot: Slot; item: string; mk: number; reason: string }[];
  ppUsed: number;
}
/**
 * Resolve a saved loadout for a room: drop what the account does not own or cannot use,
 * then drop the highest-PP item until the loadout fits the lower of the account budget
 * and the room bracket cap.
 */
export function fitLoadout(level: number, bracket: BracketDef, loadout: LoadoutIds, inventory: Inventory): FitResult {
  const dropped: FitResult['dropped'] = [];
  const open = slotsForLevel(level);
  let eff: EffectiveItem[] = [];
  for (const slot of SLOTS) {
    const id = loadout[slot];
    if (!id) continue;
    const def = ITEM_BY_ID[id];
    const owned = inventory[id] ?? 0;
    if (!def || def.slot !== slot) { dropped.push({ slot, item: id, mk: owned, reason: 'invalid' }); continue; }
    if (!open.includes(slot)) { dropped.push({ slot, item: id, mk: owned, reason: 'slot locked' }); continue; }
    if (owned < 1) { dropped.push({ slot, item: id, mk: 0, reason: 'not owned' }); continue; }
    const mk = Math.min(owned, maxMkUnlocked(level));
    if (mkDef(mk).pp > maxItemPp(bracket)) { dropped.push({ slot, item: id, mk, reason: 'above 35% of bracket cap' }); continue; }
    eff.push({ slot, item: id, mk });
  }
  const cap = Math.min(budgetForLevel(level), bracket.ppCap);
  const pp = () => eff.reduce((s, e) => s + mkDef(e.mk).pp, 0);
  while (pp() > cap && eff.length) {
    let hi = 0;
    for (let i = 1; i < eff.length; i++) if (mkDef(eff[i].mk).pp > mkDef(eff[hi].mk).pp) hi = i;
    const [d] = eff.splice(hi, 1);
    dropped.push({ ...d, reason: 'over budget' });
  }
  return { effective: eff, dropped, ppUsed: pp() };
}
/** Validation for saving a loadout (rejects instead of trimming). */
export function validateLoadout(level: number, loadout: LoadoutIds, inventory: Inventory): string[] {
  const errors: string[] = [];
  const bracket = bracketForLevel(level);
  const open = slotsForLevel(level);
  let pp = 0;
  for (const slot of SLOTS) {
    const id = loadout[slot];
    if (!id) continue;
    const def = ITEM_BY_ID[id];
    if (!def) { errors.push(`unknown item ${id}`); continue; }
    if (def.slot !== slot) { errors.push(`${def.name} does not fit the ${slot} slot`); continue; }
    if (!open.includes(slot)) { errors.push(`${slot} slot unlocks later`); continue; }
    const mk = inventory[id] ?? 0;
    if (mk < 1) { errors.push(`${def.name} is not owned`); continue; }
    if (mkDef(mk).pp > maxItemPp(bracket)) errors.push(`${def.name} Mk ${mk} costs more than 35% of the bracket cap`);
    pp += mkDef(mk).pp;
  }
  const budget = Math.min(budgetForLevel(level), bracket.ppCap);
  if (pp > budget) errors.push(`loadout uses ${pp} PP but the budget is ${budget}`);
  return errors;
}
export function loadoutPp(loadout: LoadoutIds, inventory: Inventory): number {
  let pp = 0;
  for (const slot of SLOTS) {
    const id = loadout[slot];
    if (id && (inventory[id] ?? 0) >= 1) pp += mkDef(inventory[id]).pp;
  }
  return pp;
}

// ---- XP, credits ------------------------------------------------------------
export function xpToNext(level: number): number {
  return 200 + 40 * (level - 1);
}
export function cumulativeXp(level: number): number {
  return 200 * (level - 1) + 20 * (level - 1) * (level - 2);
}
export function levelForXp(xp: number): number {
  let l = 1;
  while (l < MAX_LEVEL && xp >= cumulativeXp(l + 1)) l++;
  return l;
}
export function xpForMatch(ms: number, rank: number, playedS: number, rapidPlacement = false): number {
  if (playedS < MIN_PLAYED_S) return 0;
  const place = rank >= 1 && rank <= XP_PLACEMENT.length ? XP_PLACEMENT[rank - 1] : 0;
  const xp = XP_BASE + XP_PER_MS * ms + place;
  return Math.round(rapidPlacement ? xp * RAPID_PLACEMENT_XP : xp);
}
export interface CreditInput {
  ms: number;
  rank: number;
  playedS: number;
  firstOfDay: boolean;
  matchesToday: number; // matches already played today, before this one
  humans: number;
}
export function creditsForMatch(c: CreditInput): number {
  if (c.playedS < MIN_PLAYED_S) return 0;
  const place = c.rank >= 1 && c.rank <= CREDIT_PLACEMENT.length ? CREDIT_PLACEMENT[c.rank - 1] : 0;
  let match = CREDIT_BASE + CREDIT_PER_MS * c.ms + place;
  if (c.matchesToday >= CREDIT_DAILY_FULL_MATCHES) match *= 0.5;
  if (c.humans < CR_MIN_HUMANS) match *= 0.5;
  return Math.round(match) + (c.firstOfDay ? CREDIT_DAILY_FIRST : 0);
}
export function capCredits(balance: number): number {
  return Math.min(CREDIT_CAP, balance);
}

// ---- Ranking ----------------------------------------------------------------
export function rpForMatch(rankHuman: number, humans: number): number {
  if (humans < RP_MIN_HUMANS) return 0;
  const rp = 5 + 20 * (1 - (rankHuman - 1) / (humans - 1));
  return Math.round(humans < RP_HALF_BELOW ? rp / 2 : rp);
}
export function crDelta(myCr: number, myRank: number, others: { cr: number; rank: number }[], matchesPlayed: number): number {
  const n = others.length + 1;
  if (n < CR_MIN_HUMANS) return 0;
  const k = matchesPlayed < CR_NEW_MATCHES ? CR_K_NEW : CR_K;
  let sum = 0;
  for (const o of others) {
    const e = 1 / (1 + Math.pow(10, (o.cr - myCr) / 400));
    const s = myRank < o.rank ? 1 : myRank === o.rank ? 0.5 : 0;
    sum += s - e;
  }
  return (k / (n - 1)) * sum;
}
export function queueWindow(waitSeconds: number): number {
  return Math.min(QUEUE_WINDOW_MAX, QUEUE_WINDOW_START + QUEUE_WINDOW_STEP * Math.floor(waitSeconds / 10));
}
/** Redis-style composite: higher total first, then whoever reached it earlier. */
export function boardScore(total: number, minutesSincePeriodStart: number): number {
  return total * 1_000_000 + (999_999 - Math.min(999_999, Math.max(0, Math.floor(minutesSincePeriodStart))));
}
