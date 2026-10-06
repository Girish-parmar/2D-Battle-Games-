import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  ALLTIME_MIN_MATCHES, BOARD_SIZE, CR_START, DAILY_BEST, WEEKLY_BEST, boardScore, type Inventory, type LoadoutIds
} from '@war/shared';

// A single-process stand-in for the PostgreSQL tables and Redis boards in the design (Section 11).
// The shapes match db/schema.sql so the store can be swapped for Postgres without touching callers.

export interface Account {
  id: string;
  kind: 'guest' | 'email' | 'google';
  email?: string;
  birthYear?: number;
  createdAt: number;
  lastSeenAt: number;
  bannedUntil?: number;
  deletedAt?: number;
}
export interface Profile {
  accountId: string;
  displayName: string;
  level: number;
  xp: number;
  credits: number;
  gems: number;
  cr: number;
  crMatches: number;
  totalMatches: number;
  activePreset: number;
  presets: LoadoutIds[];
  inventory: Inventory;
  dailyMatches: number;
  dailyReset: string;
  nameChangedAt: number;
  cosmetics: string[];
}
export interface LedgerRow { id: number; accountId: string; kind: 'xp' | 'credits' | 'gems'; delta: number; reason: string; ref: string; createdAt: number }
export interface MatchRow { id: string; startedAt: number; endedAt: number; bracket: number; durationS: number; players: number; humans: number; endReason: string; rulesetVer: number }
export interface MatchPlayerRow {
  matchId: string; slot: number; accountId: string | null; isBot: boolean; finalRank: number; ms: number; kills: number; deaths: number;
  assists: number; maxTier: number; xpGain: number; creditsGain: number; rp: number; crDelta: number; flags: number; bracket: number; endedAt: number; counted: boolean;
}
export interface ReportRow { id: number; reporterId: string; targetId: string; matchId: string; reason: string; createdAt: number; status: 'open' | 'closed' }
export interface BanRow { id: number; accountId: string; reason: string; until: number; createdBy: string; createdAt: number }
export interface MagicToken { token: string; email: string; birthYear: number; expiresAt: number }

export interface RefreshRow { hash: string; accountId: string; expiresAt: number }

interface DbShape {
  refresh: RefreshRow[];
  accounts: Account[];
  profiles: Profile[];
  matches: MatchRow[];
  matchPlayers: MatchPlayerRow[];
  ledger: LedgerRow[];
  reports: ReportRow[];
  bans: BanRow[];
  pairs: Record<string, number>;
  seq: number;
}
const empty = (): DbShape => ({ refresh: [], accounts: [], profiles: [], matches: [], matchPlayers: [], ledger: [], reports: [], bans: [], pairs: {}, seq: 1 });

export const utcDay = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
export function weekStart(ms: number): number {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}
export const dayStart = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };

export class Store {
  private db: DbShape = empty();
  private ledgerKeys = new Set<string>();
  private magic = new Map<string, MagicToken>();
  private timer: NodeJS.Timeout | null = null;
  private byId = new Map<string, Profile>();
  private accById = new Map<string, Account>();
  private matchIds = new Set<string>();

  constructor(private file: string | null) {
    if (file && existsSync(file)) {
      try { this.db = { ...empty(), ...JSON.parse(readFileSync(file, 'utf8')) }; } catch { this.db = empty(); }
    }
    for (const a of this.db.accounts) this.accById.set(a.id, a);
    for (const p of this.db.profiles) this.byId.set(p.accountId, p);
    for (const l of this.db.ledger) this.ledgerKeys.add(this.lkey(l.ref, l.accountId, l.kind, l.reason));
    for (const m of this.db.matches) this.matchIds.add(m.id);
  }

  save(now = false) {
    if (!this.file) return;
    if (now) { this.flush(); return; }
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 500);
    this.timer.unref?.();
  }
  flush() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.db));
    renameSync(tmp, this.file);
  }

  // ---- accounts ---------------------------------------------------------------
  private uniqueName(base: string): string {
    const clean = base.replace(/[^A-Za-z0-9_ -]/g, '').trim().slice(0, 16) || 'Player';
    let name = clean, n = 1;
    while (this.db.profiles.some((p) => p.displayName.toLowerCase() === name.toLowerCase())) name = `${clean.slice(0, 12)}${++n}`;
    return name;
  }
  createAccount(kind: Account['kind'], opts: { email?: string; birthYear?: number; name?: string } = {}): { account: Account; profile: Profile } {
    const now = Date.now();
    const account: Account = { id: randomUUID(), kind, email: opts.email?.toLowerCase(), birthYear: opts.birthYear, createdAt: now, lastSeenAt: now };
    const profile: Profile = {
      accountId: account.id,
      displayName: this.uniqueName(opts.name ?? `Guest${randomBytes(2).readUInt16BE() % 10000}`),
      level: 1, xp: 0, credits: 0, gems: 0, cr: CR_START, crMatches: 0, totalMatches: 0, activePreset: 0,
      presets: [{}, {}, {}], inventory: {}, dailyMatches: 0, dailyReset: utcDay(now), nameChangedAt: 0, cosmetics: []
    };
    this.db.accounts.push(account);
    this.db.profiles.push(profile);
    this.accById.set(account.id, account);
    this.byId.set(account.id, profile);
    this.save();
    return { account, profile };
  }
  account(id: string) { return this.accById.get(id); }
  profile(id: string) { return this.byId.get(id); }
  findByEmail(email: string) { return this.db.accounts.find((a) => a.email === email.toLowerCase() && !a.deletedAt); }
  setDisplayName(id: string, name: string): string | null {
    const p = this.byId.get(id);
    if (!p) return 'no such account';
    if (!/^[A-Za-z0-9_ -]{3,16}$/.test(name)) return 'names are 3 to 16 letters, digits, spaces, _ or -';
    if (this.db.profiles.some((o) => o.accountId !== id && o.displayName.toLowerCase() === name.toLowerCase())) return 'that name is taken';
    p.displayName = name;
    this.save();
    return null;
  }
  touch(id: string) { const a = this.accById.get(id); if (a) a.lastSeenAt = Date.now(); }
  deleteAccount(id: string) {
    const a = this.accById.get(id); const p = this.byId.get(id);
    if (!a || !p) return;
    a.deletedAt = Date.now(); a.email = undefined; a.birthYear = undefined;
    p.displayName = 'Deleted player';
    this.save();
  }
  isBanned(id: string): BanRow | undefined {
    const now = Date.now();
    return this.db.bans.find((b) => b.accountId === id && b.until > now);
  }

  // ---- refresh tokens (30 days, rotated on every use) ---------------------------------
  private hash(t: string) { return createHash('sha256').update(t).digest('hex'); }
  issueRefresh(accountId: string): string {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    this.db.refresh = this.db.refresh.filter((r) => r.expiresAt > now);
    this.db.refresh.push({ hash: this.hash(token), accountId, expiresAt: now + 30 * 86_400_000 });
    this.save();
    return token;
  }
  /** Consumes the token and returns its account; the caller issues the replacement. */
  consumeRefresh(token: string): string | null {
    const h = this.hash(token);
    const i = this.db.refresh.findIndex((r) => r.hash === h && r.expiresAt > Date.now());
    if (i < 0) return null;
    const [row] = this.db.refresh.splice(i, 1);
    this.save();
    return row.accountId;
  }

  // ---- magic links (email login) -----------------------------------------------
  issueMagic(email: string, birthYear: number): string {
    const token = randomBytes(24).toString('base64url');
    this.magic.set(token, { token, email: email.toLowerCase(), birthYear, expiresAt: Date.now() + 15 * 60_000 });
    return token;
  }
  consumeMagic(token: string): MagicToken | null {
    const t = this.magic.get(token);
    this.magic.delete(token);
    return t && t.expiresAt > Date.now() ? t : null;
  }

  // ---- ledger ----------------------------------------------------------------------
  private lkey(ref: string, acc: string, kind: string, reason: string) { return `${ref}|${acc}|${kind}|${reason}`; }
  /** Returns false (and does nothing) if this exact entry was already written. */
  ledger(accountId: string, kind: LedgerRow['kind'], delta: number, reason: string, ref: string): boolean {
    const k = this.lkey(ref, accountId, kind, reason);
    if (this.ledgerKeys.has(k)) return false;
    this.ledgerKeys.add(k);
    this.db.ledger.push({ id: this.db.seq++, accountId, kind, delta, reason, ref, createdAt: Date.now() });
    this.save();
    return true;
  }
  ledgerFor(accountId: string, limit = 50) { return this.db.ledger.filter((l) => l.accountId === accountId).slice(-limit).reverse(); }

  // ---- matches ---------------------------------------------------------------------
  hasMatch(id: string) { return this.matchIds.has(id); }
  addMatch(m: MatchRow, players: MatchPlayerRow[]) {
    this.matchIds.add(m.id);
    this.db.matches.push(m);
    this.db.matchPlayers.push(...players);
    this.save();
  }
  /** Rooms two accounts shared today (win-trading check). Returns the new count. */
  bumpPair(a: string, b: string, day: string): number {
    const key = `${day}:${a < b ? a : b}:${a < b ? b : a}`;
    this.db.pairs[key] = (this.db.pairs[key] ?? 0) + 1;
    return this.db.pairs[key];
  }
  matchesOf(accountId: string, limit = 20) {
    return this.db.matchPlayers.filter((r) => r.accountId === accountId).slice(-limit).reverse();
  }
  allMatchPlayers() { return this.db.matchPlayers; }
  matchCount() { return this.db.matches.length; }

  // ---- reports and bans -------------------------------------------------------------
  addReport(r: Omit<ReportRow, 'id' | 'createdAt' | 'status'>): ReportRow {
    const row: ReportRow = { ...r, id: this.db.seq++, createdAt: Date.now(), status: 'open' };
    this.db.reports.push(row);
    this.save();
    return row;
  }
  reportsToday(reporterId: string) {
    const start = dayStart(Date.now());
    return this.db.reports.filter((r) => r.reporterId === reporterId && r.createdAt >= start).length;
  }
  openReportsAgainst(targetId: string) { return this.db.reports.filter((r) => r.targetId === targetId && r.status === 'open').length; }
  addBan(accountId: string, reason: string, days: number, by: string) {
    this.db.bans.push({ id: this.db.seq++, accountId, reason, until: Date.now() + days * 86_400_000, createdBy: by, createdAt: Date.now() });
    this.save();
  }
  listReports() { return this.db.reports; }

  // ---- leaderboards (Section 9) ------------------------------------------------------
  /** Daily and weekly boards sum the best N Ranking Points matches. All-time ranks Career Rating. */
  leaderboard(bracket: number, period: 'daily' | 'weekly' | 'all', me: string | null, open: boolean) {
    const now = Date.now();
    const rows: { accountId: string; name: string; score: number; matches: number; tie: number }[] = [];
    const eligible = (id: string) => {
      const a = this.accById.get(id);
      return !!a && !a.deletedAt && (open || a.kind !== 'guest');
    };
    if (period === 'all') {
      for (const p of this.db.profiles) {
        if (!eligible(p.accountId) || p.crMatches < ALLTIME_MIN_MATCHES) continue;
        rows.push({ accountId: p.accountId, name: p.displayName, score: p.cr, matches: p.crMatches, tie: 0 });
      }
    } else {
      const start = period === 'daily' ? dayStart(now) : weekStart(now);
      const best = period === 'daily' ? DAILY_BEST : WEEKLY_BEST;
      const byAcc = new Map<string, MatchPlayerRow[]>();
      for (const r of this.db.matchPlayers) {
        if (r.bracket !== bracket || !r.accountId || r.endedAt < start || !r.counted) continue;
        const list = byAcc.get(r.accountId) ?? [];
        list.push(r);
        byAcc.set(r.accountId, list);
      }
      for (const [id, list] of byAcc) {
        if (!eligible(id) || list.length < 5 && !open) continue;
        const top = [...list].sort((a, b) => b.rp - a.rp || a.endedAt - b.endedAt).slice(0, best);
        const total = top.reduce((s, r) => s + r.rp, 0);
        const reachedAt = Math.max(...top.map((r) => r.endedAt));
        rows.push({ accountId: id, name: this.byId.get(id)?.displayName ?? '?', score: total, matches: list.length, tie: boardScore(total, (reachedAt - start) / 60000) });
      }
    }
    rows.sort((a, b) => (period === 'all' ? b.score - a.score : b.tie - a.tie) || a.name.localeCompare(b.name));
    const ranked = rows.map((r, i) => ({ rank: i + 1, ...r }));
    const top = ranked.slice(0, BOARD_SIZE).map((r) => ({ rank: r.rank, name: r.name, score: Math.round(r.score), matches: r.matches, you: r.accountId === me }));
    let mine: { rank: number; score: number; matches: number } | null = null;
    let near: typeof top = [];
    if (me) {
      const idx = ranked.findIndex((r) => r.accountId === me);
      if (idx >= 0) {
        mine = { rank: ranked[idx].rank, score: Math.round(ranked[idx].score), matches: ranked[idx].matches };
        near = ranked.slice(Math.max(0, idx - 5), idx + 6).map((r) => ({ rank: r.rank, name: r.name, score: Math.round(r.score), matches: r.matches, you: r.accountId === me }));
      }
    }
    return { bracket, period, total: ranked.length, top, mine, near };
  }
}
