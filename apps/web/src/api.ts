// Thin REST client. Keeps the access token fresh using the rotating refresh token.

export interface ProfileView {
  id: string; name: string; kind: string; level: number; xp: number; xpInLevel: number; xpToNext: number; credits: number; gems: number;
  bracket: number; bracketName: string; budget: number; slots: string[]; presets: Record<string, string>[]; activePreset: number;
  presetsUnlocked: number; inventory: Record<string, number>; totalMatches: number; dailyMatches: number; ppUsed: number; creditCap: number;
}
export interface ShopItem {
  id: string; name: string; slot: string; primary: string; drawback: string; owned: number;
  effects: { primary: number; drawback: number }[];
  next: { mk: number; price: number; pp: number; unlockLevel: number; locked: boolean; affordable: boolean } | null;
  salvage: number;
}
export interface Shop {
  ladder: { mk: number; factor: number; pp: number; price: number; cumulative: number; unlockLevel: number; rarity: string }[];
  items: ShopItem[]; slotsOpen: string[]; budget: number; bracket: number; maxMk: number; nameChangeCost: number; profile: ProfileView;
}
export type QueueStatus =
  | { state: 'waiting'; waitS: number; window: number; queued: number; offerDown: boolean; downBracket?: number }
  | { state: 'ready'; roomId: string; roomTicket: string; bracket: number; playDown: boolean }
  | { state: 'gone' };
export interface BoardRow { rank: number; name: string; score: number; matches: number; you: boolean }
export interface Board {
  bracket: number; period: string; total: number; top: BoardRow[]; near: BoardRow[]; mine: { rank: number; score: number; matches: number } | null;
  brackets: { id: number; name: string }[]; note?: string;
}

const KEY = 'war.session';
interface Session { access: string; refresh: string }
let session: Session | null = null;
try { session = JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { session = null; }

function store(s: Session | null) {
  session = s;
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}
export const hasSession = () => !!session;
export const accessToken = () => session?.access ?? '';
export const signOut = () => store(null);

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  if (!session) return false;
  refreshing ??= (async () => {
    try {
      const r = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh: session!.refresh }) });
      if (!r.ok) { store(null); return false; }
      store((await r.json()) as Session);
      return true;
    } catch { return false; } finally { refreshing = null; }
  })();
  return refreshing;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function call<T>(path: string, opts: { method?: string; body?: unknown; retry?: boolean } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(session ? { authorization: 'Bearer ' + session.access } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  });
  if (res.status === 401 && opts.retry !== false && session && await refresh()) return call<T>(path, { ...opts, retry: false });
  let json: any = null;
  try { json = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(json?.error ?? `request failed (${res.status})`, res.status);
  return json as T;
}

export async function guestLogin(name?: string): Promise<ProfileView> {
  const r = await call<Session & { profile: ProfileView }>('/api/auth/guest', { body: { name: name || undefined } });
  store({ access: r.access, refresh: r.refresh });
  return r.profile;
}
export async function requestEmail(email: string, birthYear: number) {
  return call<{ sent: boolean; devLink?: string; devToken?: string }>('/api/auth/email/request', { body: { email, birthYear } });
}
export async function verifyEmail(token: string): Promise<ProfileView> {
  const r = await call<Session & { profile: ProfileView }>('/api/auth/email/verify', { body: { token, guestAccess: session?.access } });
  store({ access: r.access, refresh: r.refresh });
  return r.profile;
}
export const me = () => call<ProfileView>('/api/me');
export const shop = () => call<Shop>('/api/shop');
export const buy = (item: string) => call<Shop>('/api/shop/buy', { body: { item } });
export const salvage = (item: string) => call<Shop>('/api/shop/salvage', { body: { item } });
export const saveLoadout = (preset: number, loadout: Record<string, string>) => call<ProfileView>('/api/loadout', { method: 'PUT', body: { preset, loadout } });
export const setActivePreset = (preset: number) => call<ProfileView>('/api/loadout/active', { body: { preset } });
export const joinQueue = () => call<{ ticket: string }>('/api/queue/join', { body: {} });
export const queueStatus = (ticket: string) => call<QueueStatus>('/api/queue/status?ticket=' + encodeURIComponent(ticket));
export const cancelQueue = (ticket: string) => call('/api/queue/cancel', { body: { ticket } });
export const acceptDown = (ticket: string) => call('/api/queue/accept-down', { body: { ticket } });
export const leaderboard = (bracket: number, period: string) => call<Board>(`/api/leaderboard?bracket=${bracket}&period=${period}`);
export const rename = (name: string) => call<ProfileView>('/api/me/name', { method: 'PUT', body: { name } });
export const deleteAccount = () => call('/api/me', { method: 'DELETE' });
export const exportData = () => call<unknown>('/api/me/export');
export const report = (matchId: string, targetName: string, reason: string) => call('/api/report', { body: { matchId, targetName, reason } });
