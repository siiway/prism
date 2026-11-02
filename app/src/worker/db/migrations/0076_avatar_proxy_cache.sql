CREATE TABLE IF NOT EXISTS avatar_proxy_cache (
  mapping_id TEXT PRIMARY KEY REFERENCES image_proxy_mappings(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  body BLOB NOT NULL,
  size_bytes INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_avatar_proxy_cache_expires
  ON avatar_proxy_cache(expires_at);
