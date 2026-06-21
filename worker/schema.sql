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
