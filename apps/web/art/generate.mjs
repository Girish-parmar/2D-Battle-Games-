// Generates every image under apps/web/public/img as an SVG file.
//   node apps/web/art/generate.mjs
// The files are committed, so this only needs to run when the art changes. You can also edit the SVGs by hand.
// Conventions the renderer relies on (apps/web/src/game/render.ts):
//   hull-*.svg   128x128, light grey so the player colour can tint it, faces right (+x), body radius about 51
//   w1..w5.svg   256x128, gunmetal, hub at the centre (128,64), barrel points right
//   tile images (ground, wall, grate, hazard) have power-of-two sizes and wrap seamlessly
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'img');
mkdirSync(OUT, { recursive: true });

const svg = (name, w, h, body, defs = '') =>
  writeFileSync(join(OUT, `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>\n`);
const rng = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const n1 = (n) => +n.toFixed(1);
const rad = (d) => (d * Math.PI) / 180;
const arc = (cx, cy, r, a0, a1) => `M${n1(cx + Math.cos(rad(a0)) * r)} ${n1(cy + Math.sin(rad(a0)) * r)} A${r} ${r} 0 0 1 ${n1(cx + Math.cos(rad(a1)) * r)} ${n1(cy + Math.sin(rad(a1)) * r)}`;
const DARK = '#10201a';

// ---- unit hulls ---------------------------------------------------------------------------------------------------
const hullDefs = `<radialGradient id="b" cx=".38" cy=".32" r=".85"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#b9c4be"/></radialGradient>
<radialGradient id="t" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#97a39d"/></radialGradient>`;
const treads = [8, 98].map((y) => `<rect x="22" y="${y}" width="84" height="22" rx="7" fill="#35403a"/>${Array.from({ length: 10 }, (_, i) => `<rect x="${27 + i * 8}" y="${y + 3}" width="3" height="16" rx="1" fill="#1d2622"/>`).join('')}`).join('');
const disc = `<circle cx="64" cy="64" r="50" fill="#18201c"/><circle cx="64" cy="64" r="46" fill="url(#b)"/>`;
const lights = [[98, 43], [98, 79]].map(([x, y]) => `<rect x="${x}" y="${y}" width="8" height="6" rx="2" fill="#fff" stroke="#6d7a73" stroke-width="1"/>`).join('');
const grille = Array.from({ length: 5 }, (_, i) => `<rect x="20" y="${50 + i * 6}" width="14" height="3" rx="1" fill="#6d7a73"/>`).join('');
const turretRing = `<circle cx="64" cy="64" r="28" fill="url(#t)" stroke="#78857f" stroke-width="3"/>`;
const rivets = Array.from({ length: 8 }, (_, i) => `<circle cx="${n1(64 + Math.cos(rad(i * 45 + 22.5)) * 41)}" cy="${n1(64 + Math.sin(rad(i * 45 + 22.5)) * 41)}" r="2.4" fill="#fff" stroke="#6d7a73" stroke-width="1"/>`).join('');
const seams = `<circle cx="64" cy="64" r="37" fill="none" stroke="#8b9690" stroke-width="2"/>${[0, 1, 2, 3, 4, 5].map((i) => { const a = rad(i * 60 + 30); return `<line x1="${n1(64 + Math.cos(a) * 37)}" y1="${n1(64 + Math.sin(a) * 37)}" x2="${n1(64 + Math.cos(a) * 46)}" y2="${n1(64 + Math.sin(a) * 46)}" stroke="#8b9690" stroke-width="2"/>`; }).join('')}`;
const plates = [45, 135, 225, 315].map((a) => `<path d="${arc(64, 64, 41, a - 22, a + 22)}" fill="none" stroke="${DARK}" stroke-width="11" stroke-linecap="round"/><path d="${arc(64, 64, 41, a - 22, a + 22)}" fill="none" stroke="#e8eeea" stroke-width="7" stroke-linecap="round"/>`).join('');
const spikes = Array.from({ length: 8 }, (_, i) => { const a = i * 45 + 22.5; const p = (r, d) => `${n1(64 + Math.cos(rad(a + d)) * r)},${n1(64 + Math.sin(rad(a + d)) * r)}`; return `<polygon points="${p(46, -9)} ${p(59, 0)} ${p(46, 9)}" fill="#2a3530" stroke="${DARK}" stroke-width="1.5"/>`; }).join('');
svg('hull-a', 128, 128, treads + disc + seams + lights + grille + turretRing, hullDefs);
svg('hull-b', 128, 128, treads + disc + plates + seams + rivets + lights + grille + turretRing, hullDefs);
svg('hull-c', 128, 128, spikes + treads + disc + plates + seams + rivets + lights + grille + `<circle cx="64" cy="64" r="33" fill="none" stroke="${DARK}" stroke-width="3" stroke-dasharray="10 6"/>` + turretRing, hullDefs);

// ---- weapons ------------------------------------------------------------------------------------------------------
const wDefs = `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b7d74"/><stop offset=".5" stop-color="#3b4943"/><stop offset="1" stop-color="#1f2824"/></linearGradient>
<radialGradient id="h" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#718379"/><stop offset="1" stop-color="#26312c"/></radialGradient>`;
const hub = (r = 22) => `<circle cx="128" cy="64" r="${r}" fill="url(#h)" stroke="${DARK}" stroke-width="3"/><circle cx="128" cy="64" r="${n1(r * 0.45)}" fill="#161f1b" stroke="#52645b" stroke-width="2"/>`;
const barrel = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="url(#g)" stroke="${DARK}" stroke-width="2"/>`;
const collar = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="#1b2420" stroke="${DARK}" stroke-width="2"/>`;
svg('w1', 256, 128, barrel(128, 54, 74, 20) + collar(194, 51, 12, 26) + '<rect x="152" y="54" width="5" height="20" fill="#e39a6b"/>' + hub(), wDefs);
svg('w2', 256, 128, barrel(128, 41, 72, 14) + barrel(128, 73, 72, 14) + collar(192, 38, 11, 20) + collar(192, 70, 11, 20) + '<rect x="132" y="50" width="16" height="28" rx="3" fill="#2b3731" stroke="#10201a" stroke-width="2"/>' + hub(20), wDefs);
svg('w3', 256, 128, [-8, 8].map((d) => `<g transform="rotate(${d} 128 64)">${barrel(128, 55, 62, 18)}${collar(184, 52, 9, 24)}</g>`).join('') + barrel(128, 53, 68, 22) + collar(186, 48, 10, 32) + hub(), wDefs);
svg('w4', 256, 128, barrel(128, 54, 95, 20) + [148, 166, 184, 202].map((x) => `<rect x="${x}" y="49" width="5" height="30" rx="2" fill="#1b2420" stroke="#4fc3c8" stroke-width="1.5"/>`).join('') + '<rect x="132" y="62" width="90" height="4" rx="2" fill="#7fe3e8" opacity=".85"/><polygon points="223,57 234,64 223,71" fill="#1b2420" stroke="#4fc3c8" stroke-width="1.5"/>' + hub(24), wDefs);
svg('w5', 256, 128, '<rect x="128" y="46" width="78" height="36" rx="7" fill="url(#g)" stroke="#10201a" stroke-width="2"/>' + [146, 160, 174].map((x) => `<rect x="${x}" y="46" width="4" height="36" fill="#1b2420"/>`).join('') + '<polygon points="200,40 218,33 218,95 200,88" fill="#1b2420" stroke="#10201a" stroke-width="2"/><ellipse cx="217" cy="64" rx="3" ry="17" fill="#e39a6b" opacity=".9"/>' + hub(26), wDefs);

// ---- pickups and projectiles --------------------------------------------------------------------------------------
svg('crate', 96, 96, `<rect x="6" y="6" width="84" height="84" rx="6" fill="url(#w)" stroke="#3a2a17" stroke-width="4"/>
${[34, 62].map((y) => `<line x1="8" y1="${y}" x2="88" y2="${y}" stroke="#4a331b" stroke-width="3"/>`).join('')}
<line x1="14" y1="14" x2="82" y2="82" stroke="#2f2a24" stroke-width="10"/><line x1="82" y1="14" x2="14" y2="82" stroke="#2f2a24" stroke-width="10"/>
<line x1="14" y1="14" x2="82" y2="82" stroke="#d1a35c" stroke-width="3.5"/><line x1="82" y1="14" x2="14" y2="82" stroke="#d1a35c" stroke-width="3.5"/>
${[[6, 6], [68, 6], [6, 68], [68, 68]].map(([x, y]) => `<rect x="${x}" y="${y}" width="22" height="22" rx="3" fill="#3c3a36" stroke="#1a1816" stroke-width="2"/><circle cx="${x + 11}" cy="${y + 11}" r="3" fill="#8a8680"/>`).join('')}
<circle cx="48" cy="48" r="14" fill="#c2551b" stroke="#1a1816" stroke-width="3"/><rect x="45" y="39" width="6" height="18" rx="1" fill="#ffd9b8"/><rect x="39" y="45" width="18" height="6" rx="1" fill="#ffd9b8"/>`,
`<linearGradient id="w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9a6e3c"/><stop offset="1" stop-color="#664624"/></linearGradient>`);

const powerup = (name, color, glyph) => svg(name, 64, 64, `<circle cx="32" cy="32" r="31" fill="url(#o)"/><circle cx="32" cy="32" r="22" fill="#101a15" stroke="${color}" stroke-width="3"/>${glyph}`,
  `<radialGradient id="o"><stop offset=".55" stop-color="${color}" stop-opacity=".5"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`);
powerup('powerup-1', '#ffa040', '<polygon points="35,13 21,35 30,35 27,51 43,28 33,28" fill="#ffa040"/>');
powerup('powerup-2', '#4fc3c8', '<path d="M32 14 L47 19 V32 Q47 45 32 52 Q17 45 17 32 V19 Z" fill="#4fc3c8" fill-opacity=".25" stroke="#4fc3c8" stroke-width="3" stroke-linejoin="round"/><path d="M25 32 L30 37 L40 26" fill="none" stroke="#4fc3c8" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>');
powerup('powerup-3', '#7bd389', '<g fill="none" stroke="#7bd389" stroke-width="2.5">' + [6, 11, 16].map((r) => `<circle cx="32" cy="32" r="${r}"/>`).join('') + '</g><line x1="32" y1="32" x2="46" y2="19" stroke="#7bd389" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="32" r="3" fill="#7bd389"/>');
powerup('powerup-4', '#ff5fd2', '<g fill="none" stroke="#ff5fd2" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">' + [-8, 0, 8].map((d) => `<path d="M20 ${38 + d} L32 ${27 + d} L44 ${38 + d}"/>`).join('') + '</g>');

svg('scrap', 32, 32, `<polygon points="${Array.from({ length: 6 }, (_, i) => `${n1(16 + Math.cos(rad(i * 60)) * 13)},${n1(16 + Math.sin(rad(i * 60)) * 13)}`).join(' ')}" fill="#e3c46b" stroke="#8a6d1f" stroke-width="2"/><circle cx="16" cy="16" r="5" fill="#5a4712"/><path d="M7 11 L14 7" stroke="#fff1b8" stroke-width="2" stroke-linecap="round"/>`);
svg('bullet', 64, 16, '<rect x="0" y="5" width="64" height="6" rx="3" fill="url(#s)"/><rect x="26" y="7" width="38" height="2" rx="1" fill="#fff"/>',
  '<linearGradient id="s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>');
svg('bolt', 128, 20, '<rect x="0" y="4" width="128" height="12" rx="6" fill="url(#s)"/><rect x="40" y="8" width="88" height="4" rx="2" fill="#fff"/>',
  '<linearGradient id="s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>');
svg('shell', 48, 48, '<circle cx="24" cy="24" r="18" fill="#2b2f2d" stroke="#ffb066" stroke-width="4"/><path d="M12 20 A13 13 0 0 1 22 11" fill="none" stroke="#79807c" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="12" r="4" fill="#ffd180"/>');

// ---- effects ------------------------------------------------------------------------------------------------------
svg('glow', 128, 128, '<circle cx="64" cy="64" r="64" fill="url(#g)"/>',
  '<radialGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>');
svg('ring', 128, 128, '<circle cx="64" cy="64" r="56" fill="none" stroke="#fff" stroke-width="7"/><circle cx="64" cy="64" r="58" fill="none" stroke="#fff" stroke-width="5" opacity=".3"/>');
svg('flash', 128, 128, '<polygon points="64,2 72,56 126,64 72,72 64,126 56,72 2,64 56,56" fill="#fff"/><circle cx="64" cy="64" r="26" fill="url(#g)"/>',
  '<radialGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>');
svg('smoke', 128, 128, '<circle cx="64" cy="64" r="62" fill="url(#g)"/>',
  '<radialGradient id="g"><stop offset="0" stop-color="#d4d4d4" stop-opacity=".75"/><stop offset=".6" stop-color="#9a9a9a" stop-opacity=".35"/><stop offset="1" stop-color="#777" stop-opacity="0"/></radialGradient>');

// ---- terrain ------------------------------------------------------------------------------------------------------
{
  const r = rng(11);
  let b = '<rect width="512" height="512" fill="#16231d"/>';
  // every mark is drawn again at the tile's other edges so the texture repeats without a seam
  const put = (x, y, size, draw) => { for (const dx of [-512, 0, 512]) for (const dy of [-512, 0, 512]) { const X = x + dx, Y = y + dy; if (X + size > 0 && X - size < 512 && Y + size > 0 && Y - size < 512) b += draw(n1(X), n1(Y)); } };
  for (let i = 0; i < 30; i++) { const x = r() * 512, y = r() * 512, s = 50 + r() * 90, c = r() < 0.5 ? 'url(#lt)' : 'url(#dk)', o = n1(0.5 + r() * 0.5); put(x, y, s, (X, Y) => `<circle cx="${X}" cy="${Y}" r="${n1(s)}" fill="${c}" opacity="${o}"/>`); }
  for (let i = 0; i < 300; i++) { const x = r() * 512, y = r() * 512, s = 0.8 + r() * 1.8, c = ['#21352b', '#0f1914', '#28402f'][Math.floor(r() * 3)]; put(x, y, s, (X, Y) => `<circle cx="${X}" cy="${Y}" r="${n1(s)}" fill="${c}"/>`); }
  for (let i = 0; i < 70; i++) { const x = r() * 512, y = r() * 512, a = r() * 6.28, l = 3 + r() * 5; put(x, y, l, (X, Y) => `<line x1="${X}" y1="${Y}" x2="${n1(X + Math.cos(a) * l)}" y2="${n1(Y + Math.sin(a) * l)}" stroke="#2f5a3a" stroke-width="1.4" stroke-linecap="round" opacity=".55"/>`); }
  svg('ground', 512, 512, b, '<radialGradient id="lt"><stop offset="0" stop-color="#233b2f" stop-opacity=".55"/><stop offset="1" stop-color="#233b2f" stop-opacity="0"/></radialGradient><radialGradient id="dk"><stop offset="0" stop-color="#0c1510" stop-opacity=".6"/><stop offset="1" stop-color="#0c1510" stop-opacity="0"/></radialGradient>');
}
svg('wall', 128, 128, `<rect width="128" height="128" fill="#5f7168"/><rect width="128" height="128" fill="url(#v)"/>
<rect x="9" y="9" width="110" height="110" rx="3" fill="none" stroke="#46564e" stroke-width="3"/><rect x="12" y="12" width="104" height="104" rx="2" fill="none" stroke="#7f9288" stroke-width="1.2" opacity=".7"/>
<line x1="64" y1="9" x2="64" y2="119" stroke="#46564e" stroke-width="2"/>
${[[20, 20], [108, 20], [20, 108], [108, 108]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.5" fill="#8fa398" stroke="#34413a" stroke-width="1.6"/>`).join('')}
<path d="M30 70 L52 88 M86 30 L100 46 M40 40 L48 34" stroke="#4c5d54" stroke-width="1.5" opacity=".7"/>
<rect x="0" y="0" width="128" height="128" fill="none" stroke="#3a4841" stroke-width="4"/>`,
`<linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-color="#000" stop-opacity=".14"/></linearGradient>`);
svg('grate', 64, 64, `<rect width="64" height="64" fill="#223329"/>${[0, 1, 2, 3].flatMap((i) => [0, 1, 2, 3].map((j) => `<rect x="${3 + i * 16}" y="${3 + j * 16}" width="10" height="10" rx="2" fill="#101a15"/>`)).join('')}`);
svg('hazard', 64, 64, `<rect width="64" height="64" fill="#2a1d14"/>${[-1, 0, 1].map((k) => `<polygon points="${64 * k},0 ${64 * k + 32},0 ${64 * k + 96},64 ${64 * k + 64},64" fill="#c2551b"/>`).join('')}`);
svg('pad', 160, 160, `<circle cx="80" cy="80" r="72" fill="#1b2b23" fill-opacity=".7" stroke="#3d5a49" stroke-width="8"/><circle cx="80" cy="80" r="54" fill="none" stroke="#4a6c58" stroke-width="3" stroke-dasharray="8 6"/>
${Array.from({ length: 12 }, (_, i) => { const a = rad(i * 30); return `<line x1="${n1(80 + Math.cos(a) * 62)}" y1="${n1(80 + Math.sin(a) * 62)}" x2="${n1(80 + Math.cos(a) * 70)}" y2="${n1(80 + Math.sin(a) * 70)}" stroke="#7fa48f" stroke-width="3"/>`; }).join('')}
${[0, 90, 180, 270].map((d) => `<path d="M80 44 L70 56 M80 44 L90 56" transform="rotate(${d} 80 80)" stroke="#7fa48f" stroke-width="4" stroke-linecap="round" fill="none"/>`).join('')}
<circle cx="80" cy="80" r="11" fill="#4fc3c8" fill-opacity=".85" stroke="#cdeff1" stroke-width="2"/>`);
svg('mine', 64, 64, `${Array.from({ length: 8 }, (_, i) => `<polygon transform="rotate(${i * 45} 32 32)" points="28,16 32,5 36,16" fill="#3a3f3c"/>`).join('')}<circle cx="32" cy="32" r="16" fill="#2b2f2d" stroke="#7a2f1a" stroke-width="3"/><circle cx="32" cy="32" r="5" fill="#ff5252"/>`);
svg('decal-crater', 160, 160, '<ellipse cx="80" cy="82" rx="64" ry="58" fill="url(#c)"/><ellipse cx="80" cy="80" rx="62" ry="56" fill="none" stroke="#2c4235" stroke-width="6" opacity=".75"/><ellipse cx="80" cy="83" rx="44" ry="38" fill="#0b130f" opacity=".5"/>',
  '<radialGradient id="c"><stop offset=".5" stop-color="#0b130f" stop-opacity=".7"/><stop offset="1" stop-color="#0b130f" stop-opacity="0"/></radialGradient>');
svg('decal-rock', 96, 96, '<ellipse cx="50" cy="62" rx="34" ry="14" fill="#000" opacity=".25"/><polygon points="14,56 24,30 46,18 70,26 82,48 74,64 38,70" fill="#6c7c73" stroke="#3d4a43" stroke-width="3"/><polygon points="24,30 46,18 70,26 50,40" fill="#92a499"/><polygon points="50,40 70,26 82,48 74,64 56,56" fill="#586860"/>');
svg('decal-tuft', 96, 96, `<ellipse cx="48" cy="62" rx="30" ry="10" fill="#0c1511" opacity=".4"/>${[[-26, '#2f5a3a'], [-16, '#3d7a4c'], [-6, '#2f5a3a'], [4, '#4a8f5a'], [14, '#3d7a4c'], [24, '#2f5a3a']].map(([dx, c], i) => `<path d="M${48 + dx / 2} 62 Q${48 + dx} ${46 - (i % 3) * 4} ${48 + dx * 1.3} ${30 + (i % 2) * 6}" fill="none" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/>`).join('')}`);

// ---- brand and menu art -------------------------------------------------------------------------------------------
const barrelAt = (deg, color) => `<g transform="rotate(${deg} 64 70)"><rect x="56" y="14" width="16" height="66" rx="4" fill="${color}" stroke="${DARK}" stroke-width="3"/><rect x="53" y="10" width="22" height="12" rx="3" fill="${color}" stroke="${DARK}" stroke-width="3"/></g>`;
svg('emblem', 128, 128, `<path d="M64 6 L114 23 V62 Q114 102 64 122 Q14 102 14 62 V23 Z" fill="#15211b" stroke="#e39a6b" stroke-width="6" stroke-linejoin="round"/>
<path d="M64 19 L102 32 V62 Q102 94 64 110 Q26 94 26 62 V32 Z" fill="#1c2e27" stroke="#4fc3c8" stroke-width="3" stroke-linejoin="round"/>
${barrelAt(-42, '#e8eeea')}${barrelAt(42, '#e8eeea')}<circle cx="64" cy="70" r="17" fill="#e39a6b" stroke="${DARK}" stroke-width="4"/><circle cx="64" cy="70" r="7" fill="${DARK}"/>`);
svg('favicon', 64, 64, `<rect width="64" height="64" rx="14" fill="#0f1713"/><rect x="30" y="8" width="8" height="30" rx="3" fill="#e8eeea" transform="rotate(35 34 38)"/><circle cx="32" cy="38" r="16" fill="#e39a6b" stroke="#10201a" stroke-width="3"/><circle cx="32" cy="38" r="6" fill="#10201a"/><rect x="4" y="4" width="56" height="56" rx="12" fill="none" stroke="#4fc3c8" stroke-width="3"/>`);

{
  const r = rng(5);
  let b = '<rect width="1600" height="900" fill="url(#bg)"/>';
  for (let v = 0; v <= 1600; v += 160) b += `<line x1="${v}" y1="0" x2="${v}" y2="900" stroke="#22362c" stroke-width="2" opacity=".55"/>`;
  for (let v = 0; v <= 900; v += 160) b += `<line x1="0" y1="${v}" x2="1600" y2="${v}" stroke="#22362c" stroke-width="2" opacity=".55"/>`;
  for (let i = 0; i < 14; i++) { const x = r() * 1600, y = r() * 900, s = 30 + r() * 60; b += `<ellipse cx="${n1(x)}" cy="${n1(y)}" rx="${n1(s)}" ry="${n1(s * 0.88)}" fill="#0a120e" opacity=".55" stroke="#2a4033" stroke-width="4"/>`; }
  for (let i = 0; i < 6; i++) { const x = r() * 1600, y = r() * 900, a = r() * 360, c = i % 2 ? '#4fc3c8' : '#e39a6b'; b += `<g transform="translate(${n1(x)} ${n1(y)}) rotate(${n1(a)})"><rect x="0" y="-1.5" width="${n1(160 + r() * 260)}" height="3" fill="${c}" opacity=".35"/></g>`; }
  const tank = (x, y, a, s, c) => `<g transform="translate(${x} ${y}) rotate(${a}) scale(${s})" opacity=".62"><rect x="-42" y="-48" width="84" height="22" rx="7" fill="#0a120e"/><rect x="-42" y="26" width="84" height="22" rx="7" fill="#0a120e"/><circle r="46" fill="${c}" stroke="#0a120e" stroke-width="5"/><circle r="26" fill="#0a120e" opacity=".35"/><rect x="0" y="-9" width="86" height="18" rx="4" fill="#0a120e"/></g>`;
  b += tank(330, 600, -20, 1.35, '#e39a6b') + tank(560, 700, -35, 0.9, '#e39a6b') + tank(1180, 270, 160, 1.3, '#4fc3c8') + tank(1330, 420, 200, 0.85, '#4fc3c8') + tank(820, 180, 90, 0.7, '#e39a6b');
  for (const [x, y, c] of [[760, 420, '#e39a6b'], [1000, 560, '#4fc3c8'], [250, 220, '#e39a6b']]) b += `<circle cx="${x}" cy="${y}" r="150" fill="${c}" opacity=".14"/><circle cx="${x}" cy="${y}" r="60" fill="${c}" opacity=".22"/>`;
  b += '<rect width="1600" height="900" fill="url(#vg)"/>';
  svg('hero', 1600, 900, b, '<radialGradient id="bg" cx=".5" cy=".45" r=".8"><stop offset="0" stop-color="#1c3027"/><stop offset="1" stop-color="#0a110d"/></radialGradient><radialGradient id="vg" cx=".5" cy=".5" r=".75"><stop offset=".45" stop-color="#0f1713" stop-opacity="0"/><stop offset="1" stop-color="#0f1713" stop-opacity=".92"/></radialGradient>');
}

// ---- tier badges: hexagon colour by band, chevrons count the step inside the band, a second frame marks tiers 6 to 10 --
const bands = ['#b0794a', '#aab7b0', '#e3c46b', '#4fc3c8', '#cc79a7'];
const hex = (cx, cy, r) => Array.from({ length: 6 }, (_, i) => `${n1(cx + Math.cos(rad(i * 60 + 30)) * r)},${n1(cy + Math.sin(rad(i * 60 + 30)) * r)}`).join(' ');
for (let t = 1; t <= 10; t++) {
  const c = bands[Math.ceil(t / 2) - 1], n = ((t - 1) % 5) + 1, base = 32 + ((n - 1) * 7) / 2 + 4;
  svg(`tier-${t}`, 64, 64, `<polygon points="${hex(32, 32, 29)}" fill="#0b110e" stroke="${c}" stroke-width="3.5" stroke-linejoin="round"/>${t > 5 ? `<polygon points="${hex(32, 32, 23)}" fill="none" stroke="${c}" stroke-width="1.5" opacity=".8" stroke-linejoin="round"/>` : ''}${Array.from({ length: n }, (_, i) => `<path d="M21 ${n1(base - i * 7)} L32 ${n1(base - 9 - i * 7)} L43 ${n1(base - i * 7)}" fill="none" stroke="${c}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}`);
}

// ---- stat icons (also used for slots: weapon=damage, hull=hull, engine=speed, sensor=look, utility=repair) ---------------
const M = '#cfe3d6', A = '#e39a6b';
const icon = (name, body) => svg(`stat-${name}`, 48, 48, `<g fill="none" stroke="${M}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${body}</g>`);
icon('hull', `<path d="M24 5 L41 15 V33 L24 43 L7 33 V15 Z"/><path d="M24 14 L33 19 V29 L24 34 L15 29 V19 Z" stroke="${A}"/>`);
icon('armor', `<path d="M6 14 L24 7 L42 14 L24 21 Z"/><path d="M6 23 L24 30 L42 23" stroke="${A}"/><path d="M6 32 L24 39 L42 32"/>`);
icon('repair', `<rect x="17" y="6" width="14" height="36" rx="4" stroke="${A}" fill="${A}" fill-opacity=".25"/><rect x="6" y="17" width="36" height="14" rx="4" stroke="${A}" fill="${A}" fill-opacity=".25"/>`);
icon('speed', `<path d="M8 12 L20 24 L8 36"/><path d="M20 12 L32 24 L20 36" stroke="${A}"/><path d="M32 12 L44 24 L32 36"/>`);
icon('damage', `<polygon points="24,3 29,17 43,11 33,23 45,30 30,31 28,45 22,32 8,40 15,26 3,19 18,18" fill="${A}" fill-opacity=".3" stroke="${A}"/>`);
icon('fireRate', `${[10, 24, 38].map((x) => `<path d="M${x - 4} 40 V22 Q${x - 4} 10 ${x} 7 Q${x + 4} 10 ${x + 4} 22 V40 Z"/>`).join('')}<path d="M6 44 H42" stroke="${A}"/>`);
icon('range', `<circle cx="22" cy="26" r="14"/><circle cx="22" cy="26" r="4" fill="${A}" stroke="${A}"/><path d="M22 6 V12 M22 40 V46 M2 26 H8"/><path d="M30 18 L44 6 M36 6 H44 V14" stroke="${A}"/>`);
icon('look', `<path d="M3 24 Q24 5 45 24 Q24 43 3 24 Z"/><circle cx="24" cy="24" r="8" stroke="${A}" fill="${A}" fill-opacity=".3"/><circle cx="24" cy="24" r="3" fill="${M}"/>`);
icon('scope', `<circle cx="24" cy="24" r="15"/><path d="M24 3 V13 M24 35 V45 M3 24 H13 M35 24 H45"/><circle cx="24" cy="24" r="3" fill="${A}" stroke="${A}"/>`);
icon('feed', `<polygon points="${hex(24, 24, 18)}" fill="#e3c46b" fill-opacity=".25" stroke="#e3c46b"/><circle cx="24" cy="24" r="6" stroke="#e3c46b"/>`);
icon('reborn', `<path d="M38 24 A14 14 0 1 1 30 11.5"/><path d="M26 5 L32 12 L24 16" stroke="${A}"/><circle cx="24" cy="24" r="3" fill="${A}" stroke="${A}"/>`);

console.log(`wrote art to ${OUT}`);
