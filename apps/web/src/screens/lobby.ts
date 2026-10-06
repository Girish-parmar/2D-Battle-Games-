import { BRACKETS } from '@war/shared';
import { acceptDown, ApiError, call, cancelQueue, joinQueue, leaderboard, queueStatus, setActivePreset } from '../api.js';
import { asset } from '../art.js';
import type { App } from '../app.js';
import { fmt, h, meter, mount, toast } from '../ui.js';

export function topbar(app: App, here: string) {
  const p = app.profile!;
  const btn = (label: string, to: Parameters<App['go']>[0], id: string) =>
    h('button', { class: 'btn small' + (here === to ? ' active' : ''), type: 'button', id, onClick: () => app.go(to) }, label);
  return h('div', { class: 'topbar' },
    h('div', { class: 'brand' }, h('img', { class: 'emblem', src: asset('emblem.svg'), alt: '', width: '36', height: '36' }), '2D War Arena'),
    h('div', { class: 'nav' }, btn('Lobby', 'lobby', 'nav-lobby'), btn('Loadout and shop', 'shop', 'nav-shop'), btn('Leaderboards', 'board', 'nav-board'), btn('Account', 'account', 'nav-account')),
    h('div', { class: 'row' }, h('span', { class: 'pill teal' }, `Level ${p.level}`), h('strong', { id: 'credits' }, `${fmt(p.credits)} credits`))
  );
}

/** Polls the queue until a seat is ready, then hands the room ticket to the game. */
export class QueueFlow {
  ticket = '';
  private timer = 0;
  private stopped = false;
  constructor(private onStatus: (s: Awaited<ReturnType<typeof queueStatus>>) => void, private onReady: (ticket: string) => void, private onFail: (m: string) => void) {}
  async start() {
    try { this.ticket = (await joinQueue()).ticket; } catch (e) { this.onFail((e as Error).message); return; }
    this.poll();
  }
  private poll = async () => {
    if (this.stopped) return;
    try {
      const s = await queueStatus(this.ticket);
      if (this.stopped) return;
      if (s.state === 'ready') { this.onReady(s.roomTicket); return; }
      if (s.state === 'gone') { this.onFail('The queue ticket expired. Try again.'); return; }
      this.onStatus(s);
    } catch (e) { if (e instanceof ApiError && e.status !== 429) { this.onFail(e.message); return; } }
    this.timer = window.setTimeout(this.poll, 1000);
  };
  async cancel() { this.stopped = true; clearTimeout(this.timer); if (this.ticket) { try { await cancelQueue(this.ticket); } catch { /* ignore */ } } }
  async down() { await acceptDown(this.ticket); }
}

export async function renderLobby(app: App, startPlay: (ticket: string) => void) {
  const p = app.profile!;
  const status = h('div', { class: 'stack', id: 'queue-status' });
  const playBtn = h('button', { class: 'btn primary big', id: 'play-btn', type: 'button' }, 'Play');
  let flow: QueueFlow | null = null;

  const setIdle = () => {
    flow = null;
    playBtn.disabled = false;
    playBtn.textContent = 'Play';
    status.replaceChildren(h('p', { class: 'muted' }, `Bracket ${p.bracket}, ${p.bracketName}. Matches last ${BRACKETS[p.bracket - 1].baseLenS / 60} minutes. Rooms fill with bots if few players are waiting.`));
  };
  playBtn.addEventListener('click', async () => {
    if (flow) { await flow.cancel(); setIdle(); return; }
    playBtn.textContent = 'Cancel';
    status.replaceChildren(h('p', {}, 'Joining the queue...'));
    flow = new QueueFlow((s) => {
      if (s.state !== 'waiting') return;
      status.replaceChildren(
        h('p', { id: 'queue-wait' }, `Searching... ${Math.floor(s.waitS)} s. ${s.queued} waiting in your bracket. Rating window plus or minus ${s.window}.`),
        s.offerDown ? h('div', { class: 'card', id: 'down-offer' },
          h('p', {}, `Few players are waiting in your bracket. You can play in bracket ${s.downBracket} instead. Your loadout is trimmed to that bracket's power budget for the match.`),
          h('button', { class: 'btn primary', id: 'accept-down', type: 'button', onClick: async () => { await flow?.down(); toast('Switched to the lower bracket.'); } }, 'Play one bracket down')) : ''
      );
    }, (ticket) => { startPlay(ticket); }, (m) => { toast(m, true); setIdle(); });
    void flow.start();
  });

  const presets = h('div', { class: 'row' }, Array.from({ length: p.presetsUnlocked }, (_, i) =>
    h('button', { class: 'btn small' + (p.activePreset === i ? ' active' : ''), type: 'button', onClick: async () => { try { app.setProfile(await setActivePreset(i)); app.go('lobby'); } catch (e) { toast((e as Error).message, true); } } }, `Preset ${i + 1}`)));
  const ppFrac = p.ppUsed / Math.max(1, p.budget);

  const lastMatch = h('div', { class: 'muted' }, 'No matches yet.');
  const daily = h('div', { class: 'muted' }, 'Loading...');
  mount(app.root, h('div', { class: 'screen' }, h('div', { class: 'wrap' },
    topbar(app, 'lobby'),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' },
        h('h2', {}, `${p.name}`),
        h('div', { class: 'row between' }, h('span', {}, `Level ${p.level} · ${p.bracketName}`), h('span', { class: 'muted mono' }, p.level >= 50 ? 'MAX' : `${fmt(p.xpInLevel)} / ${fmt(p.xpToNext)} XP`)),
        meter(p.level >= 50 ? 1 : p.xpInLevel / Math.max(1, p.xpToNext)),
        h('div', { class: 'row between' }, h('span', {}, 'Loadout'), h('span', { class: 'mono' }, `${p.ppUsed} / ${p.budget} PP`)),
        meter(ppFrac, ppFrac > 1 ? 'bad' : ''),
        presets,
        playBtn,
        status
      ),
      h('div', { class: 'card' }, h('h2', {}, 'Last match'), lastMatch, h('h2', {}, `Daily top 5, bracket ${p.bracket}`), daily)
    )
  )));
  setIdle();

  try {
    const ms = await call<{ matches: { finalRank: number; ms: number; kills: number; xpGain: number; creditsGain: number; rp: number }[] }>('/api/matches');
    if (ms.matches[0]) {
      const m = ms.matches[0];
      lastMatch.replaceChildren(`Placed ${m.finalRank}. Score ${fmt(m.ms)}, ${m.kills} kills. +${m.xpGain} XP, +${m.creditsGain} credits${m.rp ? `, +${m.rp} ranking points` : ''}.`);
    }
    const b = await leaderboard(p.bracket, 'daily');
    daily.replaceChildren(b.top.length ? h('div', { class: 'stack' }, b.top.slice(0, 5).map((r) => h('div', { class: 'row between' }, h('span', {}, `${r.rank}. ${r.name}`), h('span', { class: 'mono' }, r.score)))) : (b.note ?? 'No ranked matches yet today.'));
  } catch { /* offline hints are optional */ }
  return () => { void flow?.cancel(); };
}
