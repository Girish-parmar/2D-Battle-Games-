import { describe, expect, it } from 'vitest';
import {
  ITEM_BY_ID, MK_LADDER, STAT_WEIGHT, WEAPONS, assistBounty, boardScore, bracketForLevel, budgetForLevel, capCredits, computeStats, creditsForMatch,
  crDelta, cumulativeXp, damageAfterArmor, deathGs, fitLoadout, growthFraction, itemEffect, killBounty, levelForXp, pelletValue,
  queueWindow, radiusFor, respawnSeconds, rpForMatch, slotsForLevel, tierFor, validateLoadout, weaponIndexForTier, xpForMatch, xpToNext,
  type Inventory
} from '../src/index.js';

describe('growth and tiers', () => {
  it('radius is 16 at GS 0, 28 at GS 800 and 40 at GS 3200 and above', () => {
    expect(radiusFor(0)).toBeCloseTo(16, 5);
    expect(radiusFor(800)).toBeCloseTo(28, 5);
    expect(radiusFor(3200)).toBeCloseTo(40, 5);
    expect(radiusFor(10000)).toBeCloseTo(40, 5);
  });
  it('radius never decreases as GS rises', () => {
    let prev = 0;
    for (let gs = 0; gs <= 4000; gs += 7) {
      const r = radiusFor(gs);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });
  it('tier thresholds', () => {
    expect(tierFor(99)).toBe(1);
    expect(tierFor(100)).toBe(2);
    expect(tierFor(3199)).toBe(9);
    expect(tierFor(3200)).toBe(10);
    expect(tierFor(99999)).toBe(10);
  });
  it('weapon follows tier at 1,3,5,7,9', () => {
    const idx = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(weaponIndexForTier);
    expect(idx).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
  it('unit stats at GS 800 (g=0.5) match the worked example', () => {
    const s = computeStats(800, []);
    expect(growthFraction(800)).toBeCloseTo(0.5, 5);
    expect(s.maxHp).toBeCloseTo(175, 5);
    expect(s.speed).toBeCloseTo(204, 5);
    expect(s.look).toBeCloseTo(660, 5);
  });
  it('ideal time to kill between equal tiers stays within 2.8 to 3.9 s', () => {
    const rows: [number, number][] = [[0, 2.8], [250, 3.1], [700, 3.5], [1400, 3.8], [2500, 3.8]];
    for (const [gs, expected] of rows) {
      const s = computeStats(gs, []);
      const dps = s.weapon.damage * s.weapon.pellets.length * s.weapon.rate;
      expect(s.maxHp / dps).toBeCloseTo(expected, 1);
    }
  });
  it('weapon DPS matches the design table', () => {
    const dps = WEAPONS.map((w) => w.damage * w.pellets.length * w.rate);
    expect(dps.map((d) => Math.round(d * 10) / 10)).toEqual([36, 46.2, 48.6, 52, 60.5]);
  });
});

describe('scoring', () => {
  it('scrap value', () => {
    expect(pelletValue(1)).toBeCloseTo(2.0, 5);
    expect(pelletValue(7)).toBeCloseTo(1.1, 5);
    expect(pelletValue(10)).toBeCloseTo(0.65, 5);
    expect(pelletValue(10, 1.3)).toBeCloseTo(0.845, 5);
  });
  it('kill bounty examples', () => {
    expect(killBounty(1200, 6, 6, 0, false)).toBeCloseTo(220, 5);
    expect(killBounty(1200, 6, 4, 0, false)).toBeCloseTo(275, 5);
    expect(killBounty(5000, 10, 10, 0, false)).toBeCloseTo(400, 5);
    expect([0, 1, 2, 3, 9].map((i) => killBounty(1200, 6, 6, i, false))).toEqual([220, 110, 55, 0, 0]);
    expect(killBounty(1200, 6, 6, 0, true)).toBeCloseTo(110, 5);
  });
  it('assist bounty', () => {
    expect(assistBounty(1200, false)).toBeCloseTo(75, 5);
  });
  it('death drops one tier and keeps 25 percent of the lower tier', () => {
    expect(deathGs(7, 1520, false)).toBeCloseTo(1100, 5);
    expect(tierFor(deathGs(7, 1520, false))).toBe(6);
    expect(deathGs(1, 80, false)).toBe(0);
    expect(deathGs(4, 600, true)).toBeCloseTo(512.5, 5);
    expect(tierFor(deathGs(4, 600, true))).toBe(4);
  });
  it('respawn timer', () => {
    const phoenixIII = computeStats(1400, [{ slot: 'engine', item: 'phoenix_core', mk: 3 }]);
    expect(respawnSeconds(7, 1)).toBeCloseTo(5.4, 5);
    // Phoenix Core Mk III cuts the timer by 8.0 / weight percent: 26.7% with the design weight, 40% after calibration
    expect(respawnSeconds(7, phoenixIII.rebornMult)).toBeCloseTo(Math.max(2, 5.4 * (1 - 8 / STAT_WEIGHT.reborn / 100)), 5);
    expect(respawnSeconds(1, 0.1)).toBe(2.0);
  });
  it('armor', () => {
    expect(damageAfterArmor(12, 1.8)).toBeCloseTo(10.2, 5);
    expect(damageAfterArmor(9, 3.0)).toBeCloseTo(6.0, 5);
    expect(damageAfterArmor(5, 100)).toBeCloseTo(1.5, 5);
    expect(damageAfterArmor(40, 1.8)).toBeCloseTo(38.2, 5);
  });
});

describe('items and budget', () => {
  it('budget by level', () => {
    expect([1, 5, 10, 17, 20, 30, 40, 50].map(budgetForLevel)).toEqual([20, 22, 26, 31, 33, 40, 47, 54]);
    expect(budgetForLevel(31)).toBe(41);
  });
  it('bracket caps match the design', () => {
    expect([9, 19, 29, 39, 50].map((l) => bracketForLevel(l).ppCap)).toEqual([25, 32, 39, 46, 54]);
    expect(bracketForLevel(1).id).toBe(1);
    expect(bracketForLevel(10).id).toBe(2);
    expect(bracketForLevel(40).id).toBe(5);
  });
  it('slots unlock at 8 and 16', () => {
    expect([1, 7, 8, 15, 16].map((l) => slotsForLevel(l).length)).toEqual([3, 3, 4, 4, 5]);
  });
  it('item size is the weighted-power budget divided by the stat weight, and Mk V scales by 1.6', () => {
    const e3 = itemEffect(ITEM_BY_ID.heavy_plating, 3);
    expect(e3.primary).toBeCloseTo(8.0 / STAT_WEIGHT.hull, 5);
    expect(e3.drawback).toBeCloseTo(6.25 / STAT_WEIGHT.speed, 5);
    const e5 = itemEffect(ITEM_BY_ID.heavy_plating, 5);
    expect(e5.primary).toBeCloseTo(e3.primary * 1.6, 5);
    expect(e5.drawback).toBeCloseTo(e3.drawback * 1.6, 5);
  });
  it('every item has net weighted power of 1.75 at Mk III', () => {
    const w = STAT_WEIGHT as Record<string, number>;
    for (const id of Object.keys(ITEM_BY_ID)) {
      const d = ITEM_BY_ID[id];
      const e = itemEffect(d, 3);
      expect(e.primary * w[d.primary] - e.drawback * w[d.drawback]).toBeCloseTo(1.75, 5);
    }
  });
  it('Wide-Angle Radar Mk V at Tier 10 is capped at 900 wu', () => {
    const s = computeStats(3200, [{ slot: 'sensor', item: 'wide_radar', mk: 5 }]);
    expect(s.look).toBe(900);
  });
  it('caps hold for every single-item loadout at Tier 1 and Tier 10', () => {
    for (const id of Object.keys(ITEM_BY_ID)) {
      for (const gs of [0, 3200]) {
        const s = computeStats(gs, [{ slot: ITEM_BY_ID[id].slot, item: id, mk: 5 }]);
        expect(s.maxHp).toBeLessThanOrEqual(300);
        expect(s.armor).toBeLessThanOrEqual(3);
        expect(s.repair).toBeLessThanOrEqual(6);
        expect(s.speed).toBeLessThanOrEqual(300);
        expect(s.look).toBeLessThanOrEqual(900);
        expect(s.scope).toBeLessThanOrEqual(350);
        expect(s.feedMult).toBeLessThanOrEqual(1.3);
        expect(s.rangeMult).toBeLessThanOrEqual(1.4);
        expect(s.damageMult * s.fireMult).toBeLessThanOrEqual(1.6 + 1e-9);
      }
    }
  });
  it('Mk ladder matches the design', () => {
    expect(MK_LADDER.map((m) => m.pp)).toEqual([2, 4, 7, 11, 16]);
    expect(MK_LADDER.map((m) => m.price)).toEqual([150, 350, 750, 1500, 3000]);
    expect(MK_LADDER.map((m) => m.cumulative)).toEqual([150, 500, 1250, 2750, 5750]);
  });
  it('level 17 loadout of four Mk III and one Mk I is legal, a Mk II swap is not', () => {
    const inv: Inventory = { hardened_rounds: 3, reactive_armor: 3, afterburner: 3, wide_radar: 3, scavenger_magnet: 1 };
    const lo = { weapon: 'hardened_rounds', hull: 'reactive_armor', engine: 'afterburner', sensor: 'wide_radar', utility: 'scavenger_magnet' };
    expect(validateLoadout(17, lo, inv)).toEqual([]);
    expect(validateLoadout(17, lo, { ...inv, scavenger_magnet: 2 }).join(' ')).toMatch(/32 PP/);
  });
  it('a Mk IV item is rejected in bracket 1 by the 35 percent rule', () => {
    const errs = validateLoadout(9, { weapon: 'hardened_rounds' }, { hardened_rounds: 4 });
    expect(errs.join(' ')).toMatch(/35%/);
  });
  it('fitLoadout drops the highest PP item first when a play-down clamps the cap', () => {
    const inv: Inventory = { hardened_rounds: 5, reactive_armor: 5, afterburner: 4, wide_radar: 3, scavenger_magnet: 2 };
    const lo = { weapon: 'hardened_rounds', hull: 'reactive_armor', engine: 'afterburner', sensor: 'wide_radar', utility: 'scavenger_magnet' };
    const fit = fitLoadout(41, bracketForLevel(35), lo, inv);
    expect(fit.ppUsed).toBeLessThanOrEqual(46);
    expect(fit.dropped.some((d) => d.reason === 'over budget')).toBe(true);
    expect(fit.ppUsed).toBe(38);
  });
});

describe('progression and economy', () => {
  it('xp curve', () => {
    expect(xpToNext(16)).toBe(800);
    expect(cumulativeXp(17)).toBe(8000);
    expect(cumulativeXp(50)).toBe(56840);
    expect(levelForXp(7999)).toBe(16);
    expect(levelForXp(8000)).toBe(17);
    expect(levelForXp(999999)).toBe(50);
  });
  it('xp per match', () => {
    expect(xpForMatch(640, 5, 600)).toBe(124);
    expect(xpForMatch(640, 1, 600)).toBe(204);
    expect(xpForMatch(640, 5, 170)).toBe(0);
    expect(xpForMatch(640, 5, 600, true)).toBe(186);
  });
  it('credits per match', () => {
    const base = { playedS: 600, firstOfDay: false, matchesToday: 0, humans: 12 };
    expect(creditsForMatch({ ...base, ms: 700, rank: 8 })).toBe(72);
    expect(creditsForMatch({ ...base, ms: 640, rank: 5 })).toBe(83);
    expect(creditsForMatch({ ...base, ms: 700, rank: 8, matchesToday: 10 })).toBe(36);
    expect(creditsForMatch({ ...base, ms: 700, rank: 8, firstOfDay: true })).toBe(172);
    expect(creditsForMatch({ ...base, ms: 700, rank: 8, humans: 3 })).toBe(36);
    expect(capCredits(30000)).toBe(25000);
  });
  it('ranking points', () => {
    expect(rpForMatch(3, 12)).toBe(21);
    expect(rpForMatch(3, 6)).toBe(9);
    expect(rpForMatch(1, 3)).toBe(0);
    expect(rpForMatch(1, 12)).toBe(25);
    expect(rpForMatch(12, 12)).toBe(5);
  });
  it('career rating worked example is +5.3', () => {
    const d = crDelta(1000, 2, [{ cr: 1100, rank: 1 }, { cr: 1000, rank: 3 }, { cr: 900, rank: 4 }], 0);
    expect(d).toBeCloseTo(5.33, 1);
    expect(crDelta(1000, 1, [{ cr: 1000, rank: 2 }], 0)).toBe(0);
  });
  it('queue window widens by 50 every 10 s up to 400', () => {
    expect([0, 9, 10, 30, 60, 120].map(queueWindow)).toEqual([100, 100, 150, 250, 400, 400]);
  });
  it('board tie-break prefers whoever reached the total first', () => {
    expect(boardScore(112, 400)).toBe(112999599);
    expect(boardScore(112, 700)).toBe(112999299);
    expect(boardScore(112, 400)).toBeGreaterThan(boardScore(112, 700));
  });
});
