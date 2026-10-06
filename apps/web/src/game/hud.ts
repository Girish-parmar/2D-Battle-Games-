import { EMOTES, TIER_THRESHOLDS, tierProgress, type Phase } from '@war/shared';
import { asset, tierIcon } from '../art.js';
import { h, meter, mmss, fmt } from '../ui.js';
import { isMuted, setMuted } from './sfx.js';
import type { ClientWorld } from './state.js';

const PHASE_LABEL: Record<Phase, string> = {
  forming: 'Forming', warmup: 'Warm-up', playing: 'Playing', overtime: 'Overtime', ending: 'Final', results: 'Results', closed: 'Closed'
};

/** The in-match overlay. Plain DOM over the canvas, so text stays crisp and readable. */
export class Hud {
  readonly root = h('div', { id: 'hud', role: 'region', 'aria-label': 'Match HUD' });
  private tierImg = tierIcon(1, 46);
  private tierBadge = h('div', { class: 'badge tierbadge' }, this.tierImg);
  private shownTier = 1;
  private gunImg = h('img', { class: 'gunico', src: asset('w1.svg'), alt: '', width: '104', height: '52', style: { margin: '-12px -20px -12px -26px' } });
  private gunText = h('span', {}, '');
  private shownGun = 0;
  private tierText = h('div', {}, '');
  private tierBar = h('div', { class: 'meter' }, h('i'));
  private timerT = h('div', { class: 't' }, '0:00');
  private timerP = h('div', { class: 'p' }, '');
  private board = h('div', { class: 'hp', id: 'hud-board' });
  private feed = h('div', { class: 'hp', id: 'hud-feed' });
  private hpText = h('div', {}, '');
  private hpFill = h('i');
  private shieldFill = h('b');
  private statText = h('div', { class: 'muted' }, '');
  private weapon = h('div', { class: 'chip row', style: { gap: '8px' } }, this.gunImg, this.gunText);
  private power = h('div', { class: 'chip hidden' }, '');
  private scope = h('div', { class: 'chip' }, 'Scope');
  private auto = h('div', { class: 'chip hidden' }, 'Auto-fire');
  private net = h('div', { class: 'hp', id: 'hud-net' }, '');
  private death = h('div', { class: 'hp hidden', id: 'hud-death' });
  private infoEl = h('div', { class: 'hidden', id: 'hud-info', 'aria-live': 'polite' });
  private bannerEl = h('div', { class: 'hidden', id: 'hud-banner' });
  private emotes = h('div', { id: 'hud-emotes', class: 'hidden' }, EMOTES.map((e, i) => h('span', {}, `${i + 1} ${e}`)));
  private full = h('div', { class: 'hp hidden', id: 'hud-full' });
  private hit = h('div', { class: 'hp', id: 'hud-hit' });
  private menu = h('div', { class: 'hidden', id: 'hud-menu' });
  private bannerTimer = 0;
  private lastBoardKey = '';
  private lastFeedKey = '';
  private lowAt = 0;

  constructor(host: HTMLElement, private opts: { onLeave(): void; onResume(): void; onLowHealth(): void }) {
    this.root.append(
      h('div', { class: 'hp', id: 'hud-tier' }, this.tierBadge, h('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', gap: '6px' } }, this.tierText, this.tierBar)),
      h('div', { class: 'hp', id: 'hud-timer' }, this.timerT, this.timerP),
      this.board, this.feed,
      h('div', { class: 'hp', id: 'hud-vitals' }, this.hpText, h('div', { class: 'bar' }, this.hpFill, this.shieldFill), this.statText),
      h('div', { class: 'hp', id: 'hud-weapon' }, this.weapon, this.power, this.scope, this.auto),
      this.net, this.death, this.infoEl, this.bannerEl, this.emotes, this.full, this.hit, this.menu
    );
    host.append(this.root);
    this.buildMenu();
  }

  private buildMenu() {
    const mute = h('button', { class: 'btn', type: 'button' }, isMuted() ? 'Sound: off' : 'Sound: on');
    mute.addEventListener('click', () => { setMuted(!isMuted()); mute.textContent = isMuted() ? 'Sound: off' : 'Sound: on'; });
    this.menu.append(h('div', { class: 'card' },
      h('h2', {}, 'Paused'),
      h('p', { class: 'muted' }, 'The match keeps running while this menu is open.'),
      h('button', { class: 'btn primary', type: 'button', id: 'resume-btn', onClick: () => this.opts.onResume() }, 'Resume'),
      mute,
      h('button', { class: 'btn', type: 'button', id: 'leave-btn', onClick: () => this.opts.onLeave() }, 'Leave match')
    ));
  }
  toggleMenu(open?: boolean) {
    const show = open ?? this.menu.classList.contains('hidden');
    this.menu.classList.toggle('hidden', !show);
    return show;
  }
  get menuOpen() { return !this.menu.classList.contains('hidden'); }

  showBanner(title: string, sub?: string) {
    this.bannerEl.replaceChildren(title, sub ? h('small', {}, sub) : '');
    this.bannerEl.classList.remove('hidden');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.add('hidden'), 1800);
  }
  hurt() {
    this.hit.style.opacity = '1';
    setTimeout(() => { this.hit.style.opacity = '0'; }, 120);
  }

  update(cw: ClientWorld, perfNow: number, fps: number, flags: { tab: boolean; emote: boolean; autoFire: boolean; scoping: boolean }) {
    const own = cw.own;
    const st = cw.state;
    if (!own || !st) return;
    const alive = (own.flags & 1) !== 0;
    const s = cw.ownStats;

    // tier and weapon
    if (own.tier !== this.shownTier) { this.shownTier = own.tier; this.tierImg.src = asset(`tier-${Math.min(10, Math.max(1, own.tier))}.svg`); this.tierImg.alt = `Tier ${own.tier}`; }
    const next = own.tier < TIER_THRESHOLDS.length ? TIER_THRESHOLDS[own.tier] : null;
    this.tierText.textContent = `${s.weapon.name}${next ? ` · ${fmt(own.gs)} / ${fmt(next)} to Tier ${own.tier + 1}` : ' · max Tier'}`;
    (this.tierBar.firstElementChild as HTMLElement).style.width = `${tierProgress(own.gs) * 100}%`;

    // timer
    const serverNow = st.serverNow + (Date.now() - cw.stateAt);
    let left = 0;
    if (st.phase === 'playing') left = st.matchEndsAt - serverNow;
    else left = cw.phaseLeftMs();
    this.timerT.textContent = mmss(left);
    this.timerP.textContent = `${PHASE_LABEL[st.phase]} · B${st.bracket} · ${st.humans} players${st.bots ? `, ${st.bots} bots` : ''}`;
    const infoText: Record<string, [string, string]> = {
      forming: ['Waiting for players', 'Bots fill the empty slots when the timer ends. You can move around.'],
      warmup: ['Get ready', 'Damage and scoring are off during warm-up.'],
      overtime: ['Overtime', 'The ring is shrinking. Stay inside it.'],
      ending: ['Match over', 'Final standings are locked.']
    };
    const info = infoText[st.phase];
    if (info) { this.infoEl.replaceChildren(info[0], h('small', {}, info[1])); this.infoEl.classList.remove('hidden'); } else this.infoEl.classList.add('hidden');

    // vitals
    const hpFrac = own.hp / Math.max(1, own.maxHp);
    this.hpText.textContent = `HP ${Math.ceil(own.hp)} / ${Math.round(own.maxHp)}${own.shield > 0 ? `  +${Math.ceil(own.shield)} shield` : ''}`;
    this.hpFill.style.width = `${hpFrac * 100}%`;
    this.hpFill.style.background = hpFrac > 0.5 ? '' : hpFrac > 0.25 ? '#ffb74d' : '#f28b82';
    this.shieldFill.style.width = `${Math.min(1, own.shield / Math.max(1, own.maxHp)) * 100}%`;
    this.statText.textContent = `Armor ${s.armor.toFixed(1)} · Speed ${Math.round(s.speed)} · Look ${Math.round(s.look)}`;
    if (alive && hpFrac < 0.25 && perfNow - this.lowAt > 1200) { this.lowAt = perfNow; this.opts.onLowHealth(); }

    // weapon row
    if (s.weapon.id !== this.shownGun) { this.shownGun = s.weapon.id; this.gunImg.src = asset(`w${s.weapon.id + 1}.svg`); }
    this.gunText.textContent = `${s.weapon.code} ${s.weapon.name}`;
    if (own.powerup > 0) {
      const names = ['Overdrive', 'Aegis', 'Radar', 'Nitro'];
      this.power.textContent = `${names[own.powerup - 1]} ${own.powerupLeft.toFixed(0)}s`;
      this.power.classList.remove('hidden'); this.power.classList.add('on');
    } else this.power.classList.add('hidden');
    this.scope.classList.toggle('on', flags.scoping);
    this.auto.classList.toggle('hidden', !flags.autoFire);
    this.auto.classList.add('on');
    this.net.textContent = `ping ${Math.round(cw.rtt)} ms · ${Math.round(fps)} fps`;

    // death overlay
    if (!alive && st.phase !== 'ending' && st.phase !== 'results') {
      this.death.replaceChildren(h('div', { class: 'big' }, 'Eliminated'), h('div', {}, `Respawning in ${(own.respawnMs / 1000).toFixed(1)} s`), h('div', { class: 'muted' }, 'You drop one Tier'));
      this.death.classList.remove('hidden');
    } else this.death.classList.add('hidden');

    // scoreboard (top 10 plus your own row)
    const bd = cw.board;
    if (bd) {
      const key = bd.rows.map((r) => `${r.slot}:${r.tier}:${Math.round(r.ms)}:${r.kills}`).join('|') + '|' + bd.myRank;
      if (key !== this.lastBoardKey) {
        this.lastBoardKey = key;
        const rows = bd.rows.map((r, i) => {
          const you = r.slot === cw.slot;
          const rank = i < 10 ? i + 1 : bd.myRank;
          return h('div', { class: 'r' + (you ? ' you' : '') }, h('span', {}, rank), h('span', { class: 'nm' }, you ? `${cw.nameOf(r.slot)} (you)` : cw.nameOf(r.slot)), h('span', {}, `T${r.tier}`), h('span', { style: { textAlign: 'right' } }, fmt(r.ms)), h('span', { style: { textAlign: 'right' } }, r.kills));
        });
        this.board.replaceChildren(h('div', { class: 'r h' }, h('span', {}, '#'), h('span', {}, 'NAME'), h('span', {}, 'TIER'), h('span', { style: { textAlign: 'right' } }, 'SCORE'), h('span', { style: { textAlign: 'right' } }, 'K')), ...rows);
      }
    }
    const fkey = cw.feed.map((f) => f.t).join(',');
    if (fkey !== this.lastFeedKey) {
      this.lastFeedKey = fkey;
      this.feed.replaceChildren(...cw.feed.map((f) => h('div', { style: { color: f.mine ? '#ffd180' : '' } }, f.text)));
    }
    this.emotes.classList.toggle('hidden', !flags.emote);
    this.full.classList.toggle('hidden', !flags.tab);
    this.root.classList.toggle('tabbed', !!flags.tab);
    if (flags.tab && bd) {
      this.full.replaceChildren(h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Rank'), h('th', {}, 'Name'), h('th', {}, 'Tier'), h('th', { class: 'num' }, 'Score'), h('th', { class: 'num' }, 'Kills'))),
        h('tbody', {}, bd.rows.map((r, i) => h('tr', { class: r.slot === cw.slot ? 'you' : '' }, h('td', {}, i < 10 ? i + 1 : bd.myRank), h('td', {}, cw.nameOf(r.slot)), h('td', {}, `T${r.tier}`), h('td', { class: 'num' }, fmt(r.ms)), h('td', { class: 'num' }, r.kills))))));
    }
  }

  destroy() { this.root.remove(); }
}
