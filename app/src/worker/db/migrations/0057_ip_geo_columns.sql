-- Cloudflare geolocation alongside every stored request IP.
--
-- The security review that added session_ips also asked for the *location* of
-- an IP everywhere an IP is recorded, not just on sessions. These three tables
-- each keep a request IP that is surfaced to a user or admin:
--
--   * audit_events  — the user-visible and admin-visible activity trail
--   * login_errors  — failed sign-in attempts (admin)
--   * request_logs  — the admin request log viewer
--
-- Rather than five discrete columns per table (as session_ips has, where the
-- data is queried and ordered), these log rows only ever display their
-- location, so a single JSON snapshot column is enough and keeps the inserts
-- cheap. Shape matches worker/lib/geo.ts GeoInfo:
--   {"country":"HK","region":"...","city":"...","asn":123,"org":"..."}
-- NULL when Cloudflare gave us nothing (local dev / non-CF path).
ALTER TABLE audit_events ADD COLUMN ip_geo TEXT;
ALTER TABLE login_errors ADD COLUMN ip_geo TEXT;
ALTER TABLE request_logs ADD COLUMN ip_geo TEXT;
