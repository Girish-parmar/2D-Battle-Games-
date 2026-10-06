import type { ResultsMsg } from '@war/shared';
import type { ProfileView } from './api.js';

export type ScreenName = 'auth' | 'lobby' | 'shop' | 'board' | 'account' | 'results';

/** Shared handle every screen receives. */
export interface App {
  root: HTMLElement;
  profile: ProfileView | null;
  results: { msg: ResultsMsg; matchId: string } | null;
  go(screen: ScreenName): void;
  setProfile(p: ProfileView): void;
  refresh(): Promise<ProfileView>;
  play(): void;
}
