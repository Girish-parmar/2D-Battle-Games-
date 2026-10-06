import { randomUUID } from 'node:crypto';
import {
  CREDIT_CAP, ITEMS, ITEM_BY_ID, MAX_LEVEL, MIN_PLAYED_S, MK_LADDER, PAIR_ROOMS_MAX, RAPID_PLACEMENT_CR, RAPID_PLACEMENT_LEVEL,
  RP_MIN_HUMANS, SALVAGE_REFUND, SLOTS, STAT_WEIGHT, bracketForLevel, budgetForLevel, capCredits, creditsForMatch, crDelta,
  cumulativeXp, itemEffect, levelForXp, loadoutPp, maxMkUnlocked, mkDef, rpForMatch, slotsForLevel, validateLoadout, xpForMatch, xpToNext,
  type LoadoutIds, type MyRewards
} from '@war/shared';
import { FLAG_FEED, FLAG_IDLE, RULESET, type MatchResult } from './room.js';
import { utcDay, type MatchPlayerRow, type Profile, type Store } from './store.js';

export const FLAG_PAIR = 4;
export const NAME_CHANGE_COST = 300;
export const NAME_CHANGE_DAYS = 30;

export const presetsUnlocked = (level: number) => 1 + (level >= 10 ? 1 : 0) + (level >= 20 ? 1 : 0);

// ---- Shop (Section 7) ------------------------------------------------------------------
export type ShopResult = { ok: true; profile: Profile } | { ok: false; error: string };

export function buyOrUpgrade(store: Store, p: Profile, itemId: string): ShopResult {
  const def = ITEM_BY_ID[itemId];
  if (!def) return { ok: false, error: 'unknown item' };
  const owned = p.inventory[itemId] ?? 0;
  if (owned >= MK_LADDER.length) return { ok: false, error: 'already at Mk V' };
  const next = mkDef(owned + 1);
  if (p.level < next.unlockLevel) return { ok: false, error: `Mk ${next.mk} unlocks at level ${next.unlockLevel}` };
  if (p.credits < next.price) return { ok: false, error: `needs ${next.price - p.credits} more credits` };
  p.credits -= next.price;
  p.inventory[itemId] = next.mk;
  store.ledger(p.accountId, 'credits', -next.price, `buy:${itemId}:mk${next.mk}`, randomUUID());
  store.save();
  return { ok: true, profile: p };
}

export function salvage(store: Store, p: Profile, itemId: string): ShopResult {
  const owned = p.inventory[itemId] ?? 0;
  if (!ITEM_BY_ID[itemId] || owned < 1) return { ok: false, error: 'not owned' };
  const refund = Math.round(mkDef(owned).price * SALVAGE_REFUND);
  p.credits = capCredits(p.credits + refund);
  if (owned === 1) {
    delete p.inventory[itemId];
    for (const lo of p.presets) for (const s of SLOTS) if (lo[s] === itemId) delete lo[s];
  } else p.inventory[itemId] = owned - 1;
  store.ledger(p.accountId, 'credits', refund, `salvage:${itemId}:mk${owned}`, randomUUID());
  store.save();
  return { ok: true, profile: p };
}

export function saveLoadout(store: Store, p: Profile, preset: number, loadout: LoadoutIds): { ok: true } | { ok: false; errors: string[] } {
  if (preset < 0 || preset >= presetsUnlocked(p.level)) return { ok: false, errors: ['that preset is still locked'] };
  const clean: LoadoutIds = {};
  for (const s of SLOTS) if (loadout[s]) clean[s] = loadout[s];
  const errors = validateLoadout(p.level, clean, p.inventory);
  if (errors.length) return { ok: false, errors };
  p.presets[preset] = clean;
  store.save();
  return { ok: true };
}

export function changeName(store: Store, p: Profile, name: string): string | null {
  const now = Date.now();
  if (p.nameChangedAt && now - p.nameChangedAt < NAME_CHANGE_DAYS * 86_400_000) return 'names can be changed once every 30 days';
  const first = p.nameChangedAt === 0 && /^Guest\d+$/.test(p.displayName);
  if (!first && p.credits < NAME_CHANGE_COST) return `a name change costs ${NAME_CHANGE_COST} credits`;
  const err = store.setDisplayName(p.accountId, name);
  if (err) return err;
  if (!first) { p.credits -= NAME_CHANGE_COST; store.ledger(p.accountId, 'credits', -NAME_CHANGE_COST, 'name-change', randomUUID()); }
  p.nameChangedAt = now;
  store.save();
  return null;
}

/** Everything the shop and loadout screens need, with effects precomputed per Mk. */
export function catalogFor(p: Profile) {
  const bracket = bracketForLevel(p.level);
  return {
    ladder: MK_LADDER,
    weights: STAT_WEIGHT,
    items: ITEMS.map((it) => {
      const owned = p.inventory[it.id] ?? 0;
      const next = owned < MK_LADDER.length ? mkDef(owned + 1) : null;
      return {
        id: it.id, name: it.name, slot: it.slot, primary: it.primary, drawback: it.drawback, owned,
        effects: MK_LADDER.map((m) => itemEffect(it, m.mk)),
        next: next && { mk: next.mk, price: next.price, pp: next.pp, unlockLevel: next.unlockLevel, locked: p.level < next.unlockLevel, affordable: p.credits >= next.price },
        salvage: owned ? Math.round(mkDef(owned).price * SALVAGE_REFUND) : 0
      };
    }),
    slotsOpen: slotsForLevel(p.level),
    budget: Math.min(budgetForLevel(p.level), bracket.ppCap),
    bracket: bracket.id,
    maxMk: maxMkUnlocked(p.level)
  };
}

export function profileView(p: Profile, accountKind: string) {
  const bracket = bracketForLevel(p.level);
  return {
    id: p.accountId, name: p.displayName, kind: accountKind, level: p.level, xp: p.xp, xpInLevel: p.xp - cumulativeXp(p.level),
    xpToNext: p.level >= MAX_LEVEL ? 0 : xpToNext(p.level), credits: p.credits, gems: p.gems, bracket: bracket.id, bracketName: bracket.name,
    budget: Math.min(budgetForLevel(p.level), bracket.ppCap), slots: slotsForLevel(p.level), presets: p.presets, activePreset: p.activePreset,
    presetsUnlocked: presetsUnlocked(p.level), inventory: p.inventory, totalMatches: p.totalMatches, dailyMatches: p.dailyMatches,
    ppUsed: loadoutPp(p.presets[p.activePreset] ?? {}, p.inventory), creditCap: CREDIT_CAP
  };
}

// ---- Match results (Sections 5, 7, 9) -----------------------------------------------------
export function applyMatchResult(store: Store, r: MatchResult): Map<string, MyRewards> {
  const rewards = new Map<string, MyRewards>();
  if (store.hasMatch(r.matchId)) return rewards; // idempotent: a retried result pays once
  const humans = r.players.filter((p) => !p.bot && p.accountId);
  const day = utcDay(r.endedAt);
  const rewardsOpen = r.endReason !== 'abort' || r.durationS >= 300;
  const ratedRoom = r.endReason !== 'abort' && humans.length >= RP_MIN_HUMANS;

  // win-trading: the same two accounts sharing more than 5 rooms in a day lose RP for the later rooms
  const pairFlag = new Set<string>();
  for (let i = 0; i < humans.length; i++) for (let j = i + 1; j < humans.length; j++) {
    if (store.bumpPair(humans[i].accountId!, humans[j].accountId!, day) > PAIR_ROOMS_MAX) { pairFlag.add(humans[i].accountId!); pairFlag.add(humans[j].accountId!); }
  }

  const rows: MatchPlayerRow[] = [];
  for (const p of r.players) {
    const base: MatchPlayerRow = {
      matchId: r.matchId, slot: p.slot, accountId: p.bot ? null : p.accountId, isBot: p.bot, finalRank: p.rank, ms: p.ms, kills: p.kills, deaths: p.deaths,
      assists: p.assists, maxTier: p.maxTier, xpGain: 0, creditsGain: 0, rp: 0, crDelta: 0, flags: p.flags, bracket: r.bracket, endedAt: r.endedAt, counted: false
    };
    if (p.bot || !p.accountId) { rows.push(base); continue; }
    const prof = store.profile(p.accountId);
    if (!prof) { rows.push(base); continue; }
    if (prof.dailyReset !== day) { prof.dailyReset = day; prof.dailyMatches = 0; }
    const eligible = rewardsOpen && p.playedS >= MIN_PLAYED_S;
    const flags = p.flags | (pairFlag.has(p.accountId) ? FLAG_PAIR : 0);
    const flagged = (flags & (FLAG_FEED | FLAG_IDLE | FLAG_PAIR)) !== 0;
    const counted = ratedRoom && eligible && !flagged;
    const rapid = prof.cr >= RAPID_PLACEMENT_CR && prof.level < RAPID_PLACEMENT_LEVEL;
    const xp = eligible ? xpForMatch(p.ms, p.rank, p.playedS, rapid) : 0;
    const credits = eligible ? creditsForMatch({ ms: p.ms, rank: p.rank, playedS: p.playedS, firstOfDay: prof.dailyMatches === 0, matchesToday: prof.dailyMatches, humans: humans.length }) : 0;
    const rp = counted ? rpForMatch(p.rankHuman ?? humans.length, humans.length) : 0;
    let delta = 0;
    if (counted) {
      const others = humans.filter((o) => o !== p).map((o) => ({ cr: o.cr, rank: o.rankHuman ?? humans.length }));
      delta = crDelta(prof.cr, p.rankHuman ?? humans.length, others, prof.crMatches);
    }
    const before = prof.level;
    prof.xp += xp;
    prof.level = levelForXp(prof.xp);
    const newBalance = capCredits(prof.credits + credits);
    const paid = newBalance - prof.credits;
    prof.credits = newBalance;
    if (counted) { prof.cr = Math.max(0, Math.round(prof.cr + delta)); prof.crMatches++; }
    prof.dailyMatches++;
    prof.totalMatches++;
    if (xp) store.ledger(prof.accountId, 'xp', xp, 'match', r.matchId);
    if (paid) store.ledger(prof.accountId, 'credits', paid, 'match', r.matchId);
    let note: string | undefined;
    if (!rewardsOpen) note = 'The room closed before 5:00, so no rewards were paid.';
    else if (p.playedS < MIN_PLAYED_S) note = 'You played under 3 minutes, so no rewards were paid.';
    else if (flagged) note = 'This match was flagged by the anti-abuse checks, so rating points were withheld.';
    else if (!ratedRoom) note = 'Fewer than 4 humans were in the room, so there is no rating change.';
    rows.push({ ...base, xpGain: xp, creditsGain: paid, rp, crDelta: Math.round(delta), flags, counted });
    rewards.set(prof.accountId, {
      xp, credits: paid, rp, crDelta: Math.round(delta), level: prof.level, levelUp: prof.level > before,
      xpToNext: prof.level >= MAX_LEVEL ? 0 : xpToNext(prof.level), xpInLevel: prof.xp - cumulativeXp(prof.level), counted, note
    });
  }
  store.addMatch({
    id: r.matchId, startedAt: r.startedAt, endedAt: r.endedAt, bracket: r.bracket, durationS: r.durationS, players: r.players.length,
    humans: humans.length, endReason: r.endReason, rulesetVer: RULESET
  }, rows);
  store.save();
  return rewards;
}
