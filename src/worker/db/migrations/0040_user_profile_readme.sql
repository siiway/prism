-- Profile README. A user-supplied markdown blob shown on the public profile,
-- optionally sourced from a bound GitHub account's profile README.
--
-- profile_readme stores the raw markdown source for the manual editor case.
-- When profile_readme_source = 'github', the rendered content comes from the
-- github_readme_cache table (keyed by GitHub login) and profile_readme is
-- ignored — we keep the column to make switching back to manual cheap.
--
-- Rendering happens client-side (markdown -> HTML -> sanitize -> rewrite img
-- through the image proxy) so the worker doesn't need a markdown/sanitizer dep.
-- profile_readme_updated_at lets the public profile send a stable cache hint.
--
-- profile_show_readme follows the same NULL-as-default convention as the other
-- per-section flags: NULL = follow site default, 0/1 = explicit user choice.
ALTER TABLE users ADD COLUMN profile_readme TEXT;
ALTER TABLE users ADD COLUMN profile_readme_updated_at INTEGER;
ALTER TABLE users ADD COLUMN profile_show_readme INTEGER;

-- Source selector: 'manual' (default) reads profile_readme verbatim;
-- 'github' resolves the source via github_readme_cache against the GitHub
-- login captured in profile_readme_source_meta.
ALTER TABLE users ADD COLUMN profile_readme_source TEXT NOT NULL DEFAULT 'manual';
-- JSON. For source='github': { "connection_id": "...", "github_login": "..." }
-- We snapshot the login at config time so a renamed/disconnected social
-- connection still has something to fall back on.
ALTER TABLE users ADD COLUMN profile_readme_source_meta TEXT;
ALTER TABLE users ADD COLUMN profile_readme_synced_at INTEGER;
-- Optional user-supplied GitHub PAT used when fetching that user's GitHub
-- README. Stored in plaintext like the social_connections.access_token column;
-- treat with the same care.
ALTER TABLE users ADD COLUMN github_readme_token TEXT;
-- Counter for consecutive HTTP 401 ("Bad credentials") responses against
-- this user's PAT. Rate-limit (403) responses do NOT increment — only true
-- auth failures. The token is auto-cleared once this hits 3 so a revoked or
-- mistyped PAT doesn't keep wasting fetch attempts. Reset to 0 on any
-- successful response or when the user replaces the token.
ALTER TABLE users ADD COLUMN github_readme_token_failures INTEGER NOT NULL DEFAULT 0;

-- Site-wide cache for GitHub profile READMEs. Keyed by GitHub login (case-
-- insensitive — we normalize on insert). Multiple Prism users syncing from
-- the same GitHub login share an entry.
--
-- We store the etag so refreshes can use a conditional GET, and a status code
-- so 404s/errors don't trigger a re-fetch storm. content is null for non-200
-- statuses.
CREATE TABLE IF NOT EXISTS github_readme_cache (
  github_login TEXT PRIMARY KEY,
  content TEXT,
  etag TEXT,
  status INTEGER NOT NULL DEFAULT 200,
  fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_github_readme_cache_fetched_at
  ON github_readme_cache(fetched_at);
