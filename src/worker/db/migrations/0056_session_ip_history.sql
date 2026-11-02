-- Per-session IP address history with Cloudflare-derived geolocation.
--
-- The sessions table keeps a single ip_address (the one the session was
-- created from). That is too coarse for a "where has this session been used
-- from?" security view: a laptop that roams between home, office, and mobile
-- tethering keeps the same session cookie but appears from several IPs over
-- its lifetime.
--
-- This table records every distinct IP a session has authenticated from,
-- together with the geolocation Cloudflare attaches to the request at the
-- edge (request.cf). One row per (session, ip); last_seen is bumped on each
-- authenticated request so the security page can order "most recent first".
--
-- `geo` is the full JSON snapshot produced by worker/lib/geo.ts (continent,
-- country, region, city, postalCode, lat/long, timezone, colo, asn, org, …).
-- A single JSON column rather than one column per field so the detail view can
-- surface everything Cloudflare returned and new fields never need a migration.
-- NULL when Cloudflare gave us nothing (local dev / non-CF path).
CREATE TABLE IF NOT EXISTS session_ips (
  session_id TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  geo TEXT,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (session_id, ip_address),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- The detail view fetches every IP for one session ordered by last_seen.
CREATE INDEX IF NOT EXISTS idx_session_ips_session ON session_ips(session_id, last_seen DESC);
