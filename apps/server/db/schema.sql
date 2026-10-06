-- PostgreSQL schema from the design canvas, Section 11.
-- The running server uses a JSON-file store with the same shapes (apps/server/src/store.ts).
-- Move to Postgres by implementing the Store methods against these tables.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE account_kind AS ENUM ('guest', 'email', 'google');
CREATE TYPE ledger_kind AS ENUM ('xp', 'credits', 'gems');
CREATE TYPE end_reason AS ENUM ('timer', 'mercy', 'overtime', 'abort');

CREATE TABLE accounts (
  id            uuid PRIMARY KEY,
  kind          account_kind NOT NULL,
  email         citext UNIQUE,
  google_sub    text UNIQUE,
  birth_year    smallint,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  banned_until  timestamptz,
  deleted_at    timestamptz
);
CREATE INDEX accounts_last_seen_idx ON accounts (last_seen_at);

CREATE TABLE profiles (
  account_id     uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  display_name   citext NOT NULL UNIQUE,
  level          smallint NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 50),
  xp             integer NOT NULL DEFAULT 0,
  credits        integer NOT NULL DEFAULT 0 CHECK (credits >= 0 AND credits <= 25000),
  gems           integer NOT NULL DEFAULT 0 CHECK (gems >= 0),
  cr             smallint NOT NULL DEFAULT 1000 CHECK (cr >= 0),
  cr_matches     integer NOT NULL DEFAULT 0,
  total_matches  integer NOT NULL DEFAULT 0,
  active_preset  smallint NOT NULL DEFAULT 0,
  daily_matches  smallint NOT NULL DEFAULT 0,
  daily_reset    date NOT NULL DEFAULT current_date,
  name_changed_at timestamptz,
  cosmetics      jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX profiles_level_idx ON profiles (level);

-- One row per item family holds the highest Mk owned (1..5).
CREATE TABLE inventory (
  account_id   uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  family       text NOT NULL,
  mk           smallint NOT NULL CHECK (mk BETWEEN 1 AND 5),
  acquired_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, family)
);

-- items is {"weapon": "hardened_rounds", "hull": "reactive_armor", ...}. Validated on write and again on room join.
CREATE TABLE loadouts (
  account_id  uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  preset      smallint NOT NULL CHECK (preset BETWEEN 0 AND 2),
  items       jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (account_id, preset)
);

CREATE TABLE matches (
  id            uuid PRIMARY KEY,
  started_at    timestamptz NOT NULL,
  ended_at      timestamptz NOT NULL,
  bracket       smallint NOT NULL CHECK (bracket BETWEEN 1 AND 5),
  duration_s    smallint NOT NULL CHECK (duration_s = 0 OR duration_s BETWEEN 300 AND 900),
  players       smallint NOT NULL,
  humans        smallint NOT NULL,
  end_reason    end_reason NOT NULL,
  node          text,
  ruleset_ver   smallint NOT NULL
);
CREATE INDEX matches_bracket_ended_idx ON matches (bracket, ended_at);

CREATE TABLE match_players (
  match_id      uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  slot          smallint NOT NULL,
  account_id    uuid REFERENCES accounts (id),
  is_bot        boolean NOT NULL DEFAULT false,
  final_rank    smallint NOT NULL,
  ms            integer NOT NULL,
  kills         smallint NOT NULL,
  deaths        smallint NOT NULL,
  assists       smallint NOT NULL,
  max_tier      smallint NOT NULL,
  xp_gain       integer NOT NULL DEFAULT 0,
  credits_gain  integer NOT NULL DEFAULT 0,
  rp            smallint NOT NULL DEFAULT 0,
  cr_delta      smallint NOT NULL DEFAULT 0,
  loadout       jsonb,
  flags         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, slot)
);
CREATE INDEX match_players_account_idx ON match_players (account_id, match_id DESC);

-- The unique key makes a retried result pay once.
CREATE TABLE ledger (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  kind        ledger_kind NOT NULL,
  delta       integer NOT NULL,
  reason      text NOT NULL,
  ref         uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ref, account_id, kind, reason)
);
CREATE INDEX ledger_account_created_idx ON ledger (account_id, created_at DESC);

-- Durable copy of the Redis boards.
CREATE TABLE leaderboard_periods (
  period_key    text NOT NULL,
  bracket       smallint NOT NULL,
  account_id    uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  rp_sum        integer NOT NULL,
  best_matches  smallint NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period_key, bracket, account_id)
);
CREATE INDEX leaderboard_rank_idx ON leaderboard_periods (period_key, bracket, rp_sum DESC);

CREATE TABLE reports (
  id           bigserial PRIMARY KEY,
  reporter_id  uuid NOT NULL REFERENCES accounts (id),
  target_id    uuid NOT NULL REFERENCES accounts (id),
  match_id     uuid REFERENCES matches (id),
  reason       text NOT NULL CHECK (reason IN ('cheating', 'boosting', 'name', 'other')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  status       text NOT NULL DEFAULT 'open'
);
CREATE INDEX reports_target_idx ON reports (target_id, created_at);

CREATE TABLE bans (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES accounts (id),
  reason      text NOT NULL,
  until       timestamptz NOT NULL,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bans_account_idx ON bans (account_id);

CREATE TABLE refresh_tokens (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_account_idx ON refresh_tokens (account_id);
CREATE INDEX refresh_tokens_hash_idx ON refresh_tokens (token_hash);
