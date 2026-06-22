CREATE TABLE IF NOT EXISTS transit_cache (
  cache_key TEXT PRIMARY KEY,
  minutes INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS route_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS route_search_sessions (
  session_id TEXT PRIMARY KEY,
  graph_version TEXT NOT NULL,
  profile_hash TEXT NOT NULL,
  overlay_hash TEXT NOT NULL,
  ranking_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  diagnostics TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS route_search_sessions_expiry
  ON route_search_sessions (expires_at);
