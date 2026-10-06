import {
  ITEM_BY_ID, MK_LADDER, SLOTS, WEAPONS, computeStats, loadoutPp, validateLoadout, type EffectiveItem, type LoadoutIds, type Slot
} from '@war/shared';
import { buy, salvage, saveLoadout, setActivePreset, shop as loadShop, type Shop, type ShopItem } from '../api.js';
import { slotIcon, statIcon } from '../art.js';
import type { App } from '../app.js';
import { amount, fmt, h, meter, mount, STAT_LABEL, toast } from '../ui.js';
import { topbar } from './lobby.js';

const SLOT_LABEL: Record<string, string> = { weapon: 'Weapon', hull: 'Hull', engine: 'Engine', sensor: 'Sensor', utility: 'Utility' };
const UNLOCK_AT: Record<string, number> = { sensor: 8, utility: 16 };
const STAT_OF: Record<string, string> = { Hull: 'hull', Armor: 'armor', Speed: 'speed', Damage: 'damage', 'Fire rate': 'fireRate', Range: 'range', Look: 'look', Scope: 'scope', Feed: 'feed', Repair: 'repair', 'Respawn timer': 'reborn' };

export async function renderShop(app: App) {
  let data: Shop;
  try { data = await loadShop(); } catch (e) { toast((e as Error).message, true); app.go('lobby'); return; }
  let preset = app.profile!.activePreset;
  let selected: Slot = 'weapon';
  let draft: LoadoutIds = { ...(app.profile!.presets[preset] ?? {}) } as LoadoutIds;

  const inv = () => data.profile.inventory;
  const saved = () => (data.profile.presets[preset] ?? {}) as LoadoutIds;
  const dirty = () => SLOTS.some((s) => (draft[s] ?? '') !== (saved()[s] ?? ''));
  const effective = (): EffectiveItem[] => SLOTS.filter((s) => draft[s] && (inv()[draft[s]!] ?? 0) > 0).map((s) => ({ slot: s, item: draft[s]!, mk: inv()[draft[s]!] }));

  const apply = (s: Shop) => { data = s; app.setProfile(s.profile); };
  const act = async (fn: () => Promise<Shop>) => {
    try {
      apply(await fn());
      for (const s of SLOTS) if (draft[s] && !(inv()[draft[s]!] > 0)) delete draft[s];
      draw();
    } catch (e) { toast((e as Error).message, true); }
  };

  const itemCard = (it: ShopItem) => {
    const def = ITEM_BY_ID[it.id];
    const eq = draft[it.slot as Slot] === it.id;
    const shown = Math.max(1, it.owned);
    const e = it.effects[shown - 1];
    const next = it.next;
    const lines = [
      h('div', {}, h('span', { class: 'up' }, `${STAT_LABEL[it.primary]} ${amount(it.primary, e.primary, it.primary === 'reborn' ? '-' : '+')}`),
        ' · ', h('span', { class: 'down' }, `${STAT_LABEL[it.drawback]} ${amount(it.drawback, e.drawback, '-')}`),
        h('span', { class: 'muted' }, it.owned ? ` at Mk ${it.owned}` : ` at Mk 1`))
    ];
    if (it.owned && next) {
      const n = it.effects[next.mk - 1];
      lines.push(h('div', { class: 'muted' }, `Mk ${next.mk}: ${STAT_LABEL[it.primary]} ${amount(it.primary, n.primary, it.primary === 'reborn' ? '-' : '+')}, ${STAT_LABEL[it.drawback]} ${amount(it.drawback, n.drawback, '-')} · ${next.pp} PP`));
    }
    const buyBtn = next
      ? h('button', { class: 'btn small', type: 'button', 'data-buy': it.id, disabled: next.locked || !next.affordable, onClick: () => act(() => buy(it.id)) },
        `${it.owned ? `Upgrade to Mk ${next.mk}` : 'Buy Mk 1'}: ${fmt(next.price)}`)
      : h('span', { class: 'pill' }, 'Mk V');
    const why = next ? (next.locked ? `Mk ${next.mk} unlocks at level ${next.unlockLevel}` : !next.affordable ? `${fmt(next.price - data.profile.credits)} credits short` : '') : '';
    return h('div', { class: 'item' + (eq ? ' eq' : ''), 'data-item': it.id },
      h('div', { class: 'row between' }, h('div', { class: 'row', style: { gap: '8px' } }, statIcon(it.primary), h('strong', {}, def.name)), h('span', { class: 'muted' }, it.owned ? `Mk ${it.owned}, ${MK_LADDER[it.owned - 1].pp} PP` : 'Not owned')),
      ...lines,
      h('div', { class: 'row' },
        it.owned ? h('button', { class: 'btn small' + (eq ? ' active' : ''), type: 'button', 'data-equip': it.id, onClick: () => { if (eq) delete draft[it.slot as Slot]; else draft[it.slot as Slot] = it.id; draw(); } }, eq ? 'Equipped (tap to remove)' : 'Equip') : null,
        buyBtn,
        it.owned ? h('button', { class: 'btn small', type: 'button', 'data-salvage': it.id, onClick: () => act(() => salvage(it.id)) }, `Salvage +${fmt(it.salvage)}`) : null
      ),
      why ? h('div', { class: 'muted' }, why) : null
    );
  };

  const statsPanel = () => {
    const base = computeStats(0, []);
    const now = computeStats(0, effective());
    const w = WEAPONS[0];
    const rows: [string, number, number, string, boolean][] = [
      ['Hull', base.maxHp, now.maxHp, ' HP', true], ['Armor', base.armor, now.armor, '', true], ['Speed', base.speed, now.speed, ' wu/s', true],
      ['Damage', w.damage, w.damage * now.damageMult, '', true], ['Fire rate', w.rate, w.rate * now.fireMult, ' /s', true], ['Range', w.range, w.range * now.rangeMult, ' wu', true],
      ['Look', base.look, now.look, ' wu', true], ['Scope', base.scope, now.scope, ' wu', true], ['Feed', base.feedMult, now.feedMult, 'x', true], ['Repair', base.repair, now.repair, ' HP/s', true],
      ['Respawn timer', 3, Math.max(2, 3 * now.rebornMult), ' s', false]
    ];
    return rows.map(([label, a, b, unit, higherBetter]) => {
      const better = Math.abs(a - b) < 0.05 ? '' : (b > a) === higherBetter ? 'up' : 'down';
      const f = (v: number) => (Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v).toString());
      return h('div', { class: 'statrow' }, h('span', { class: 'row', style: { gap: '8px' } }, statIcon(STAT_OF[label] ?? 'hull'), label), h('span', { class: better }, `${f(a)} → ${f(b)}${unit}`));
    });
  };

  function draw() {
    const p = data.profile;
    const errors = validateLoadout(p.level, draft, inv());
    const used = loadoutPp(draft, inv());
    const frac = used / Math.max(1, data.budget);
    const items = data.items.filter((i) => i.slot === selected);
    const saveBtn = h('button', { class: 'btn primary', id: 'save-loadout', type: 'button', disabled: !dirty() || errors.length > 0, onClick: async () => {
      try {
        app.setProfile(await saveLoadout(preset, draft as Record<string, string>));
        if (p.activePreset !== preset) app.setProfile(await setActivePreset(preset));
        data = await loadShop(); app.setProfile(data.profile);
        toast('Loadout saved.'); draw();
      } catch (e) { toast((e as Error).message, true); }
    } }, 'Save loadout');

    mount(app.root, h('div', { class: 'screen' }, h('div', { class: 'wrap' },
      topbar(app, 'shop'),
      h('div', { class: 'card' },
        h('div', { class: 'row between' },
          h('div', { class: 'stack', style: { minWidth: '260px', flex: '1' } },
            h('div', { class: 'row between' }, h('strong', {}, 'Power budget'), h('span', { class: 'mono', id: 'pp' }, `${used} / ${data.budget} PP`)),
            meter(frac, frac > 1 ? 'bad' : frac > 0.9 ? 'warn' : '')),
          h('div', { class: 'row' }, Array.from({ length: p.presetsUnlocked }, (_, i) =>
            h('button', { class: 'btn small' + (preset === i ? ' active' : ''), type: 'button', onClick: () => { preset = i; draft = { ...(p.presets[i] ?? {}) } as LoadoutIds; draw(); } }, `Preset ${i + 1}${p.activePreset === i ? ' ✓' : ''}`))),
          saveBtn),
        errors.length ? h('div', { class: 'err', role: 'alert' }, errors.join('. ')) : null,
        h('p', { class: 'muted' }, 'Every item gives one bonus and takes something away. Mk I to V scale both. The budget grows with your level.')
      ),
      h('div', { class: 'shop' },
        h('div', { class: 'stack' }, h('h2', { class: 'display muted', style: { fontSize: '14px' } }, 'Slots'), SLOTS.map((s) => {
          const open = data.slotsOpen.includes(s);
          const it = draft[s];
          const mk = it ? inv()[it] ?? 0 : 0;
          return h('button', { class: 'slotbtn' + (selected === s ? ' sel' : '') + (open ? '' : ' locked'), type: 'button', 'data-slot': s, disabled: !open, onClick: () => { selected = s; draw(); } },
            h('div', { class: 'row', style: { gap: '8px' } }, slotIcon(s), h('strong', {}, SLOT_LABEL[s])),
            h('span', { class: 'muted' }, open ? (it && mk ? `${ITEM_BY_ID[it].name}, Mk ${mk}, ${MK_LADDER[mk - 1].pp} PP` : 'Empty') : `Unlocks at level ${UNLOCK_AT[s]}`));
        })),
        h('div', { class: 'stack' }, h('h2', { class: 'display muted', style: { fontSize: '14px' } }, `Items for the ${SLOT_LABEL[selected]} slot`), items.map(itemCard)),
        h('div', { class: 'card' }, h('h2', {}, 'Net stats at Tier 1'), h('div', {}, statsPanel()), h('p', { class: 'muted' }, 'Bonuses and drawbacks on the same stat add together. Growth with Tier applies after.'))
      )
    )));
  }
  draw();
}
