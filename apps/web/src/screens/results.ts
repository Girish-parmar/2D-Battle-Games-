import { report } from '../api.js';
import type { App } from '../app.js';
import { tierIcon } from '../art.js';
import { fmt, h, meter, mount, toast } from '../ui.js';

const END: Record<string, string> = { timer: 'Time ran out', mercy: 'Mercy end: one player ran away with it', overtime: 'Decided in overtime', abort: 'Room closed early' };

export function renderResults(app: App) {
  const r = app.results;
  if (!r) { app.go('lobby'); return; }
  const { msg, matchId } = r;
  const mine = msg.mine;
  const top3 = msg.rows.slice(0, 3);
  const medals = ['1st', '2nd', '3rd'];

  const humans = msg.rows.filter((x) => !x.bot && x.name !== app.profile?.name);
  const target = h('select', { id: 'report-target', 'aria-label': 'Player to report' }, humans.map((x) => h('option', { value: x.name }, x.name)));
  const reason = h('select', { id: 'report-reason', 'aria-label': 'Reason' },
    h('option', { value: 'cheating' }, 'Cheating'), h('option', { value: 'boosting' }, 'Boosting or AFK'), h('option', { value: 'name' }, 'Offensive name'), h('option', { value: 'other' }, 'Other'));

  mount(app.root, h('div', { class: 'screen' }, h('div', { class: 'wrap' },
    h('div', { class: 'brand' }, 'Match results', h('small', {}, (END[msg.endReason] ?? msg.endReason).toUpperCase())),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' },
        h('h2', {}, 'Podium'),
        h('div', { class: 'row', style: { gap: '24px' } }, top3.map((t, i) => h('div', { class: 'stack' }, h('span', { class: 'pill' }, medals[i]), h('strong', {}, t.bot ? `[BOT] ${t.name}` : t.name), h('span', { class: 'mono' }, fmt(t.ms))))),
        mine ? h('div', { class: 'stack', id: 'rewards' },
          h('h2', {}, 'Your rewards'),
          mine.levelUp ? h('div', { class: 'pill teal' }, `Level up! You are level ${mine.level}`) : null,
          h('div', { class: 'row between' }, h('span', {}, 'XP'), h('strong', { id: 'r-xp' }, `+${fmt(mine.xp)}`)),
          meter(mine.xpToNext ? mine.xpInLevel / mine.xpToNext : 1),
          h('div', { class: 'row between' }, h('span', {}, 'Credits'), h('strong', { id: 'r-credits' }, `+${fmt(mine.credits)}`)),
          h('div', { class: 'row between' }, h('span', {}, 'Ranking points'), h('strong', {}, `+${mine.rp}`)),
          h('div', { class: 'row between' }, h('span', {}, 'Career rating'), h('strong', { class: mine.crDelta >= 0 ? 'up' : 'down' }, `${mine.crDelta >= 0 ? '+' : ''}${mine.crDelta}`)),
          mine.note ? h('p', { class: 'muted' }, mine.note) : null
        ) : h('p', { class: 'muted' }, 'No rewards were recorded for this match.')
      ),
      h('div', { class: 'card' },
        h('h2', {}, 'Standings'),
        h('div', { class: 'scroll-x' }, h('table', { id: 'standings' },
          h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Player'), h('th', {}, 'Tier'), h('th', { class: 'num' }, 'Score'), h('th', { class: 'num' }, 'K'), h('th', { class: 'num' }, 'D'), h('th', { class: 'num' }, 'A'))),
          h('tbody', {}, msg.rows.map((x) => h('tr', { class: x.name === app.profile?.name && !x.bot ? 'you' : '' },
            h('td', {}, x.rank), h('td', {}, x.bot ? `[BOT] ${x.name}` : x.name), h('td', {}, h('span', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, tierIcon(x.maxTier, 26), `T${x.maxTier}`)), h('td', { class: 'num' }, fmt(x.ms)), h('td', { class: 'num' }, x.kills), h('td', { class: 'num' }, x.deaths), h('td', { class: 'num' }, x.assists))))))
      )
    ),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary big', id: 'again-btn', type: 'button', onClick: () => app.play() }, 'Queue again'),
      h('button', { class: 'btn', id: 'to-lobby', type: 'button', onClick: () => app.go('lobby') }, 'Back to lobby')
    ),
    humans.length ? h('div', { class: 'card' },
      h('h2', {}, 'Report a player'),
      h('div', { class: 'row' }, h('label', {}, 'Player', target), h('label', {}, 'Reason', reason),
        h('button', { class: 'btn', type: 'button', onClick: async () => {
          try { await report(matchId, target.value, reason.value); toast('Report sent. A person reviews every report.'); } catch (e) { toast((e as Error).message, true); }
        } }, 'Send report'))
    ) : null
  )));
}
