// Image helpers shared by the menus and the game. The files are in apps/web/public/img and are made by
// apps/web/art/generate.mjs.
import { h } from './ui.js';

// Okabe-Ito colour-blind-safe palette; each colour also has its own ring pattern so colour is never the only signal.
export const PALETTE = [0xE69F00, 0x56B4E9, 0x009E73, 0xF0E442, 0x0072B2, 0xD55E00, 0xCC79A7, 0xB0B0B0];

export const asset = (name: string) => `${import.meta.env.BASE_URL}img/${name}`;

const SLOT_ICON: Record<string, string> = { weapon: 'damage', hull: 'hull', engine: 'speed', sensor: 'look', utility: 'repair' };

export const statIcon = (stat: string, label = '') =>
  h('img', { class: 'sico', src: asset(`stat-${stat}.svg`), alt: label, width: '22', height: '22', loading: 'lazy' });
export const slotIcon = (slot: string) => statIcon(SLOT_ICON[slot] ?? 'hull');
export const tierIcon = (tier: number, size = 40) =>
  h('img', { class: 'tico', src: asset(`tier-${Math.min(10, Math.max(1, tier))}.svg`), alt: `Tier ${tier}`, width: String(size), height: String(size) });

/** Which hull picture goes with a weapon: bigger weapons come with heavier armour. */
export const hullVariant = (weapon: number) => (weapon <= 1 ? 'a' : weapon <= 3 ? 'b' : 'c');

const images = new Map<string, Promise<HTMLImageElement>>();
function loadImage(name: string): Promise<HTMLImageElement> {
  let p = images.get(name);
  if (!p) {
    p = (async () => { const i = new Image(); i.src = asset(name); await i.decode(); return i; })();
    images.set(name, p);
  }
  return p;
}

/** A small canvas showing a coloured tank with the given weapon, drawn the same way the game draws it. */
export function unitPreview(color: number, weapon: number, size = 120): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size * 2;
  c.style.width = c.style.height = `${size}px`;
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', `Tank with weapon ${weapon + 1}`);
  void (async () => {
    try {
      const [hull, gun] = await Promise.all([loadImage(`hull-${hullVariant(weapon)}.svg`), loadImage(`w${weapon + 1}.svg`)]);
      const k = c.width / 190, hs = 128 * k, cx = c.width * 0.38; // hub sits left of centre so the barrel fits
      const tint = document.createElement('canvas');
      tint.width = tint.height = hs;
      const t = tint.getContext('2d')!;
      t.drawImage(hull, 0, 0, hs, hs);
      t.globalCompositeOperation = 'multiply';
      t.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      t.fillRect(0, 0, hs, hs);
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(hull, 0, 0, hs, hs);
      const g = c.getContext('2d')!;
      g.drawImage(tint, cx - hs / 2, (c.height - hs) / 2);
      g.drawImage(gun, cx - 128 * k, (c.height - 128 * k) / 2, 256 * k, 128 * k);
    } catch { /* the preview is decoration */ }
  })();
  return c;
}
