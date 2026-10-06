import { deleteAccount, exportData, rename, requestEmail, signOut, verifyEmail } from '../api.js';
import type { App } from '../app.js';
import { h, mount, toast } from '../ui.js';
import { topbar } from './lobby.js';

export function renderAccount(app: App) {
  const p = app.profile!;
  const name = h('input', { type: 'text', id: 'new-name', value: p.name, maxlength: '16' });
  const email = h('input', { type: 'email', id: 'claim-email', placeholder: 'you@example.com' });
  const year = h('input', { type: 'number', id: 'claim-year', placeholder: 'Year of birth' });
  const out = h('div', { class: 'stack' });
  const guard = async (fn: () => Promise<void>) => { try { await fn(); } catch (e) { toast((e as Error).message, true); } };

  mount(app.root, h('div', { class: 'screen' }, h('div', { class: 'wrap' }, topbar(app, 'account'),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' },
        h('h2', {}, 'Name'),
        h('label', {}, 'Display name', name),
        h('p', { class: 'muted' }, 'Your first change from a guest name is free. After that a change costs 300 credits and is limited to once every 30 days.'),
        h('button', { class: 'btn', id: 'rename-btn', type: 'button', onClick: () => guard(async () => { app.setProfile(await rename(name.value.trim())); toast('Name changed.'); app.go('account'); }) }, 'Change name')
      ),
      h('div', { class: 'card' },
        h('h2', {}, p.kind === 'guest' ? 'Keep your progress' : 'Signed in'),
        p.kind === 'guest'
          ? h('div', { class: 'stack' },
            h('p', { class: 'muted' }, 'Add an email to keep your level, credits and items, and to appear on the leaderboards.'),
            h('label', {}, 'Email', email), h('label', {}, 'Year of birth', year),
            h('button', { class: 'btn primary', id: 'claim-btn', type: 'button', onClick: () => guard(async () => {
              const r = await requestEmail(email.value.trim(), Number(year.value));
              toast('Check your email for a link.');
              if (r.devToken) out.replaceChildren(h('button', { class: 'btn', id: 'claim-verify', type: 'button', onClick: () => guard(async () => { app.setProfile(await verifyEmail(r.devToken!)); toast('Progress saved to your email.'); app.go('account'); }) }, 'Development mode: open the link'));
            }) }, 'Email me a link'), out)
          : h('p', { class: 'muted' }, 'Your progress is tied to your email.')
      ),
      h('div', { class: 'card' },
        h('h2', {}, 'Your data'),
        h('button', { class: 'btn', id: 'export-btn', type: 'button', onClick: () => guard(async () => {
          const data = await exportData();
          const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: 'war-arena-data.json' });
          a.click();
        }) }, 'Download my data'),
        h('button', { class: 'btn', id: 'delete-btn', type: 'button', onClick: () => guard(async () => {
          if (!confirm('Delete your account? This removes your email and renames you to "Deleted player". It cannot be undone.')) return;
          await deleteAccount(); signOut(); location.reload();
        }) }, 'Delete my account')
      ),
      h('div', { class: 'card' },
        h('h2', {}, 'Session'),
        h('button', { class: 'btn', id: 'signout-btn', type: 'button', onClick: () => { signOut(); location.reload(); } }, 'Sign out'),
        h('p', { class: 'muted' }, 'Controls: WASD to move, mouse to aim, hold left button to fire, hold right button or Shift to scope, F toggles auto-fire, Tab shows the scoreboard, hold Q then press 1 to 6 for emotes, Esc opens the menu.')
      )
    )
  )));
}
