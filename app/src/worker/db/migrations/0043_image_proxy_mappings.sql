-- Image-proxy mapping table.
--
-- Before this migration, /api/proxy/image accepted any base64-encoded URL
-- and would fetch+stream it through the worker. That turned the proxy into
-- a general-purpose anonymous fetcher for arbitrary HTTPS hosts (rate-
-- limited only by the upstream and isBlockedHost). This table replaces
-- that scheme: only URLs that have been explicitly registered (server-side
-- when serving avatars/icons, or via the authenticated registration
-- endpoint for previews and user-supplied markdown images) can be proxied.
--
-- id is the first 32 hex chars of sha256(url) — deterministic, so the same
-- URL always resolves to the same id and INSERT OR IGNORE is safe to call
-- repeatedly. UNIQUE on url so we never store the same URL twice under a
-- different id.
--
-- created_by is the user who first caused the mapping to exist: the caller
-- of POST /api/proxy/image/register, the user saving a README, etc. NULL
-- means the mapping was created by an automatic server-side render path
-- (an avatar URL surfaced through proxyImageUrl) where there isn't a
-- single attributable user — those rows are anchored by the underlying
-- column instead.
--
-- ON DELETE SET NULL on the FK so deleting a user doesn't cascade-prune
-- mappings that other users may still be linking to.
--
-- Backfill from existing rows (users.avatar_url, teams.avatar_url,
-- oauth_apps.icon_url, config(site_icon_url), social_connections avatars
-- in profile_data, profile_readme image embeds) is performed on demand
-- from the admin panel: POST /admin/migrate-image-proxy.
CREATE TABLE IF NOT EXISTS image_proxy_mappings (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_image_proxy_mappings_created_at
  ON image_proxy_mappings(created_at);
CREATE INDEX IF NOT EXISTS idx_image_proxy_mappings_created_by
  ON image_proxy_mappings(created_by);
