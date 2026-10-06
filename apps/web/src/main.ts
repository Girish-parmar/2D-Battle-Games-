import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './style.css';
import type { ResultsMsg } from '@war/shared';
import { ApiError, hasSession, me, verifyEmail, type ProfileView } from './api.js';
import type { App, ScreenName } from './app.js';
import { GameClient } from './game/client.js';
import { renderAccount } from './screens/account.js';
import { renderAuth } from './screens/auth.js';
import { renderBoard } from './screens/board.js';
import { renderLobby } from './screens/lobby.js';
import { renderResults } from './screens/results.js';
import { renderShop } from './screens/shop.js';
import { h, toast } from './ui.js';

const root = document.getElementById('app')!;
let leaveScreen: (() => void) | null = null;
let game: GameClient | null = null;
let reconnects = 0;

const app: App = {
  root,
  profile: null,
  results: null,
  go(screen: ScreenName) { void show(screen); },
  setProfile(p: ProfileView) { app.profile = p; },
  async refresh() { app.profile = await me(); return app.profile; },
  play() { void show('lobby').then(() => document.getElementById('play-btn')?.click()); }
};

async function show(screen: ScreenName) {
  leaveScreen?.(); leaveScreen = null;
  if (screen !== 'auth' && !app.profile) {
    try { await app.refresh(); } catch { screen = 'auth'; }
  } else if (screen !== 'auth') {
    try { await app.refresh(); } catch (e) { if (e instanceof ApiError && e.status === 401) screen = 'auth'; }
  }
  switch (screen) {
    case 'auth': renderAuth(app); break;
    case 'lobby': leaveScreen = (await renderLobby(app, startGame)) ?? null; break;
    case 'shop': await renderShop(app); break;
    case 'board': await renderBoard(app); break;
    case 'account': renderAccount(app); break;
    case 'results': renderResults(app); break;
  }
}

async function startGame(ticket: string) {
  leaveScreen?.(); leaveScreen = null;
  root.replaceChildren(h('div', { class: 'screen' }, h('div', { class: 'wrap' }, h('p', { class: 'muted', id: 'loading' }, 'Entering the arena...'))));
  let finished: { msg: ResultsMsg; matchId: string } | null = null;
  let resultTimer = 0;
  const client = new GameClient({
    ticket,
    onResults: (msg, matchId) => {
      finished = { msg, matchId };
      // let the final freeze play out before showing the results screen
      resultTimer = window.setTimeout(() => { app.results = finished; end(); void show('results'); }, 5000);
    },
    onExit: (reason, message) => {
      clearTimeout(resultTimer);
      end();
      if (finished) { app.results = finished; void show('results'); return; }
      if (reason === 'disconnected' && reconnects < 3) { reconnects++; toast('Connection lost. Rejoining your match...'); void rejoin(); return; }
      if (reason === 'kicked') toast(message === 'idle' ? 'You were removed for being idle.' : 'You were removed from the match.', true);
      else if (reason === 'error') toast(message ?? 'Could not join the match.', true);
      void show('lobby');
    }
  });
  function end() { if (game === client) game = null; client.stop(); }
  game = client;
  try { await client.start(); reconnects = reconnects; } catch (e) { console.error(e); end(); toast('The game could not start in this browser.', true); void show('lobby'); }
}

/** The queue seats a returning player back in the room they own, so this is just another join. */
async function rejoin() {
  await show('lobby');
  document.getElementById('play-btn')?.click();
}

// ---- boot ---------------------------------------------------------------------------------------
(async () => {
  const magic = new URLSearchParams(location.search).get('magic');
  if (magic) {
    history.replaceState(null, '', location.pathname);
    try { app.profile = await verifyEmail(magic); toast('Signed in.'); await show('lobby'); return; } catch (e) { toast((e as Error).message, true); }
  }
  if (hasSession()) await show('lobby'); else await show('auth');
})();

// the test hook lets automated checks read the live game state without touching the DOM
(window as unknown as { __war: () => unknown }).__war = () => game && {
  slot: game.cw.slot, own: game.cw.own, phase: game.cw.state?.phase, units: game.cw.units.size, pellets: game.cw.pellets.size,
  projectiles: game.cw.projectiles.size, rtt: game.cw.rtt, board: game.cw.board
};
