import { Texture } from 'pixi.js';
import { asset } from '../art.js';

/** Every picture the match renderer draws. Loaded once, before the first frame. */
export interface Art {
  ground: Texture; wall: Texture; grate: Texture; hazard: Texture; pad: Texture; mine: Texture;
  craters: Texture; rock: Texture; tuft: Texture;
  hulls: Texture[]; guns: Texture[];
  crate: Texture; powerups: Texture[]; scrap: Texture;
  bullet: Texture; bolt: Texture; shell: Texture;
  glow: Texture; ring: Texture; flash: Texture; smoke: Texture;
}

// name, size in pixels it is drawn at (SVG is sharp at any size, so this picks the texture resolution)
const SIZES: Record<string, [number, number]> = {
  ground: [512, 512], wall: [128, 128], grate: [64, 64], hazard: [64, 64], pad: [160, 160], mine: [64, 64],
  'decal-crater': [160, 160], 'decal-rock': [96, 96], 'decal-tuft': [96, 96],
  'hull-a': [128, 128], 'hull-b': [128, 128], 'hull-c': [128, 128], w1: [256, 128], w2: [256, 128], w3: [256, 128], w4: [256, 128], w5: [256, 128],
  crate: [96, 96], 'powerup-1': [64, 64], 'powerup-2': [64, 64], 'powerup-3': [64, 64], 'powerup-4': [64, 64], scrap: [32, 32],
  bullet: [64, 16], bolt: [128, 20], shell: [48, 48], glow: [128, 128], ring: [128, 128], flash: [128, 128], smoke: [128, 128]
};
const TILED = new Set(['ground', 'wall', 'grate', 'hazard']);

async function load(name: string): Promise<Texture> {
  const [w, h] = SIZES[name];
  const img = new Image();
  img.src = asset(`${name}.svg`);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  const tex = Texture.from(c);
  if (TILED.has(name)) tex.source.style.addressMode = 'repeat';
  return tex;
}

export async function loadArt(): Promise<Art> {
  const names = Object.keys(SIZES);
  const tex = new Map<string, Texture>();
  await Promise.all(names.map(async (n) => {
    try { tex.set(n, await load(n)); } catch (e) { console.error(`missing image ${n}.svg`, e); tex.set(n, Texture.WHITE); }
  }));
  const t = (n: string) => tex.get(n)!;
  return {
    ground: t('ground'), wall: t('wall'), grate: t('grate'), hazard: t('hazard'), pad: t('pad'), mine: t('mine'),
    craters: t('decal-crater'), rock: t('decal-rock'), tuft: t('decal-tuft'),
    hulls: ['a', 'b', 'c'].map((v) => t(`hull-${v}`)), guns: [1, 2, 3, 4, 5].map((i) => t(`w${i}`)),
    crate: t('crate'), powerups: [1, 2, 3, 4].map((i) => t(`powerup-${i}`)), scrap: t('scrap'),
    bullet: t('bullet'), bolt: t('bolt'), shell: t('shell'),
    glow: t('glow'), ring: t('ring'), flash: t('flash'), smoke: t('smoke')
  };
}
