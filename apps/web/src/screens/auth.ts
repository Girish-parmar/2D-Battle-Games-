import { WEAPONS } from '@war/shared';
import { guestLogin, requestEmail, verifyEmail } from '../api.js';
import { asset, PALETTE, unitPreview } from '../art.js';
import type { App } from '../app.js';
import { h, mount, toast } from '../ui.js';

export function renderAuth(app: App) {
  const err = h('div', { class: 'err', role: 'alert' });
  const name = h('input', { type: 'text', id: 'guest-name', maxlength: '16', placeholder: 'Optional, 3 to 16 characters', autocomplete: 'nickname' });
  const email = h('input', { type: 'email', id: 'email', placeholder: 'you@example.com', autocomplete: 'email' });
  const year = h('input', { type: 'number', id: 'birth-year', min: '1900', max: String(new Date().getFullYear()), placeholder: 'e.g. 2005' });
  const devLink = h('div', { class: 'stack hidden', id: 'dev-link' });
  const busy = async (fn: () => Promise<void>) => { err.textContent = ''; try { await fn(); } catch (e) { err.textContent = (e as Error).message; } };

  const guest = h('button', { class: 'btn primary big', id: 'guest-btn', type: 'button', onClick: () => busy(async () => {
    app.setProfile(await guestLogin(name.value.trim()));
    app.go('lobby');
  }) }, 'Play as guest');

  const send = h('button', { class: 'btn', id: 'email-btn', type: 'button', onClick: () => busy(async () => {
    const r = await requestEmail(email.value.trim(), Number(year.value));
    toast('Check your email for a sign-in link.');
    if (r.devToken) {
      devLink.classList.remove('hidden');
      devLink.replaceChildren(
        h('p', { class: 'muted' }, 'Development mode: no email is sent. Use this button instead of the link.'),
        h('button', { class: 'btn primary', id: 'dev-verify', type: 'button', onClick: () => busy(async () => { app.setProfile(await verifyEmail(r.devToken!)); app.go('lobby'); }) }, 'Open the sign-in link')
      );
    }
  }) }, 'Email me a link');

  const arsenal = h('div', { class: 'arsenal', 'aria-label': 'Weapons' }, WEAPONS.map((w, i) =>
    h('div', { class: 'gun' }, unitPreview(PALETTE[(i * 2 + 1) % 8], i, 110), h('strong', {}, w.name), h('span', { class: 'muted' }, `Tier ${w.unlockTier}`))));

  mount(app.root, h('div', { class: 'screen hero' }, h('div', { class: 'wrap', style: { maxWidth: '760px', paddingTop: '6vh' } },
    h('div', { class: 'brand' }, h('img', { class: 'emblem', src: asset('emblem.svg'), alt: '', width: '48', height: '48' }), '2D War Arena', h('small', {}, 'ALPHA')),
    h('p', { class: 'muted' }, 'Start small. Score to grow. Spend what you earn on upgrades that trade one strength for another.'),
    h('div', { class: 'card' },
      h('h2', {}, 'Your arsenal grows as you score'),
      arsenal
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'Jump in'),
      h('label', {}, 'Name', name),
      guest,
      h('p', { class: 'muted' }, 'Guests keep their progress on this device. Add an email later to keep it and to appear on the leaderboards.')
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'Sign in with email'),
      h('div', { class: 'grid2' }, h('label', {}, 'Email', email), h('label', {}, 'Year of birth', year)),
      h('p', { class: 'muted' }, 'You must be 13 or older. We keep your email and birth year to sign you in, and nothing else personal.'),
      send, devLink
    ),
    err
  )));
}
