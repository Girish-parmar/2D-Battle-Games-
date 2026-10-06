// End-to-end smoke test: drives the real client in Chromium against a running server.
//   BASE=http://localhost:8081 SHOTS=./shots node e2e/play.mjs
// Start the server with a fast clock so a whole match fits in about a minute:
//   NODE_ENV=production TIME_SCALE=6 PORT=8081 pnpm start
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:8081';
const SHOTS = process.env.SHOTS ?? './shots';
const EXE = process.env.CHROME ?? '/opt/pw-browsers/chromium';
mkdirSync(SHOTS, { recursive: true });

const log = (m) => console.log(`[e2e] ${m}`);
const fail = (m) => { console.error(`[e2e] FAIL: ${m}`); process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

await page.goto(BASE);
await page.waitForSelector('#guest-btn');
await page.fill('#guest-name', 'E2E Tester');
await page.screenshot({ path: `${SHOTS}/1-auth.png` });
await page.click('#guest-btn');
await page.waitForSelector('#play-btn');
log('guest login works, lobby shown');
await page.screenshot({ path: `${SHOTS}/2-lobby.png` });

await page.click('#nav-shop');
await page.waitForSelector('[data-slot="weapon"]');
await page.screenshot({ path: `${SHOTS}/3-shop.png` });
await page.click('#nav-board');
await page.waitForSelector('#nav-board.active');
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/4-board.png` });
await page.click('#nav-lobby');
await page.waitForSelector('#play-btn');

await page.click('#play-btn');
log('queued');
await page.waitForFunction(() => window.__war && window.__war()?.own, null, { timeout: 60000 });
log('in the arena');
await page.screenshot({ path: `${SHOTS}/5-forming.png` });

// play: move, aim and fire
await page.mouse.move(900, 300);
await page.keyboard.down('d');
await page.mouse.down();
await page.waitForFunction(() => window.__war()?.phase === 'playing', null, { timeout: 30000 });
log('match is live');
let last = null;
for (let i = 0; i < 12; i++) {
  await page.keyboard.up('d'); await page.keyboard.up('s');
  await page.keyboard.down(i % 2 ? 'a' : 'd'); await page.keyboard.down(i % 3 ? 'w' : 's');
  await page.mouse.move(400 + (i * 70) % 700, 200 + (i * 53) % 350);
  await sleep(700);
  last = await page.evaluate(() => window.__war());
  if (i === 5) await page.screenshot({ path: `${SHOTS}/6-playing.png` });
}
if (!last?.own) fail('no own state');
else {
  log(`own after play: tier ${last.own.tier}, score ${Math.round(last.own.ms)}, hp ${Math.round(last.own.hp)}, units visible ${last.units}, scrap visible ${last.pellets}, rtt ${Math.round(last.rtt)} ms`);
  if (last.pellets < 1) fail('no scrap visible');
}
await page.keyboard.down('Tab');
await page.screenshot({ path: `${SHOTS}/7-tab.png` });
await page.keyboard.up('Tab');
await page.keyboard.press('Escape');
await page.waitForSelector('#hud-menu:not(.hidden)');
await page.screenshot({ path: `${SHOTS}/8-menu.png` });
await page.click('#resume-btn');
await page.mouse.up();

await page.waitForSelector('#rewards, #standings', { timeout: 150000 });
log('results screen shown');
await page.screenshot({ path: `${SHOTS}/9-results.png` });
const xp = await page.textContent('#r-xp').catch(() => null);
const cr = await page.textContent('#r-credits').catch(() => null);
log(`rewards: xp ${xp}, credits ${cr}`);
if (!xp || xp === '+0') fail('no XP awarded');
await page.click('#to-lobby');
await page.waitForSelector('#play-btn');
const credits = await page.textContent('#credits');
log(`lobby credits now: ${credits}`);

const real = errors.filter((e) => !/favicon|GPU stall|WebGL/i.test(e));
if (real.length) { fail(`browser errors:\n  ${real.join('\n  ')}`); }
await browser.close();
if (!process.exitCode) log('PASS');
