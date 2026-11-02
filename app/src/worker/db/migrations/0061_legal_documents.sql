-- Operator-authored legal pages: Privacy Policy and Terms of Service.
--
-- These live in their own table rather than in `site_config` for one concrete
-- reason: getConfig() loads EVERY site_config row into memory on essentially
-- every request (the /site payload alone runs on each page load). A policy is
-- a long document — capped here at 256 KiB — and paying to read two of them on
-- the hot path, when the vast majority of requests never render either page,
-- is the wrong trade. A dedicated table is read only by the two endpoints that
-- actually need it, and a lightweight `content != ''` probe is all the footer
-- needs to decide whether to show each link.
--
-- Keyed by a stable slug ('privacy' | 'terms') rather than a surrogate id: the
-- set of documents is fixed and small, each is a singleton, and the slug is
-- exactly what the /legal/:doc route and the /privacy, /terms pages address.
CREATE TABLE legal_documents (
  slug TEXT PRIMARY KEY,
  -- Markdown, rendered client-side through the same sanitizer as profile
  -- READMEs. Empty string = unpublished: the page shows a "not published"
  -- state and the footer link is hidden.
  content TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  -- Who last edited it, for the audit trail. SET NULL rather than CASCADE so
  -- deleting the admin who wrote a policy does not delete the policy.
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
