import { BRACKETS } from '@war/shared';
import { leaderboard, type Board } from '../api.js';
import type { App } from '../app.js';
import { fmt, h, mount, toast } from '../ui.js';
import { topbar } from './lobby.js';

export async function renderBoard(app: App) {
  let bracket = app.profile!.bracket;
  let period: 'daily' | 'weekly' | 'all' = 'daily';
  const body = h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Loading...'));

  async function load() {
    body.replaceChildren(h('p', { class: 'muted' }, 'Loading...'));
    let b: Board;
    try { b = await leaderboard(bracket, period); } catch (e) { toast((e as Error).message, true); return; }
    const label = period === 'all' ? 'Career Rating' : 'Ranking Points';
    const rows = (b.top.length ? b.top : []).map((r) => h('tr', { class: r.you ? 'you' : '' }, h('td', {}, r.rank), h('td', {}, r.name), h('td', { class: 'num' }, fmt(r.score)), h('td', { class: 'num' }, r.matches)));
    body.replaceChildren(
      h('div', { class: 'row between' },
        h('h2', {}, `${BRACKETS[bracket - 1].name} · ${period === 'daily' ? 'Today' : period === 'weekly' ? 'This week' : 'All time'}`),
        h('span', { class: 'muted' }, period === 'daily' ? 'Best 8 matches, resets 00:00 UTC' : period === 'weekly' ? 'Best 30 matches, resets Monday 00:00 UTC' : 'Needs 30 rated matches')),
      b.note ? h('p', { class: 'muted' }, b.note) : '',
      b.mine ? h('p', {}, `You are ranked ${b.mine.rank} of ${b.total} with ${fmt(b.mine.score)}.`) : '',
      rows.length ? h('div', { class: 'scroll-x' }, h('table', { id: 'board-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Rank'), h('th', {}, 'Player'), h('th', { class: 'num' }, label), h('th', { class: 'num' }, 'Matches'))), h('tbody', {}, rows)))
        : h('p', { class: 'muted' }, 'Nobody is on this board yet. Boards count only rooms with 4 or more humans.')
    );
  }
  const tabs = h('div', { class: 'row' });
  const draw = () => {
    tabs.replaceChildren(
      ...BRACKETS.map((b) => h('button', { class: 'btn small' + (bracket === b.id ? ' active' : ''), type: 'button', onClick: () => { bracket = b.id; draw(); void load(); } }, `${b.id} ${b.name}`)),
      h('span', { style: { width: '16px' } }),
      ...(['daily', 'weekly', 'all'] as const).map((pd) => h('button', { class: 'btn small' + (period === pd ? ' active' : ''), type: 'button', onClick: () => { period = pd; draw(); void load(); } }, pd === 'all' ? 'All time' : pd === 'daily' ? 'Daily' : 'Weekly'))
    );
  };
  draw();
  mount(app.root, h('div', { class: 'screen' }, h('div', { class: 'wrap' }, topbar(app, 'board'), tabs, body)));
  await load();
}
