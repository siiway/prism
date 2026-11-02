// Cloudflare-derived geolocation for sessions and audit records.
//
// Cloudflare attaches an approximate geolocation to every request at the edge
// via `request.cf` (see the reference snippet at
// https://gist.github.com/wyf9/beeb6746fa7fda73f78380cbdda5461e). We capture
// the same full field set that gist's `/json` route exposes, so the session
// detail view can surface everything Cloudflare told us about an IP — not just
// the city/country used for the compact "IP location" column.
//
// Everything is best-effort: local development and any non-Cloudflare path
// have no `request.cf`, in which case every field is null and callers still
// record the bare IP.

import type { GeoInfo } from "../../shared/types";

const EMPTY_GEO: GeoInfo = {
  continent: null,
  country: null,
  isEUCountry: null,
  region: null,
  regionCode: null,
  city: null,
  postalCode: null,
  latitude: null,
  longitude: null,
  metroCode: null,
  timezone: null,
  colo: null,
  asn: null,
  org: null,
};

// The subset of IncomingRequestCfProperties we read. Typed loosely because the
// Hono Request wrapper does not surface `cf` in its type. Cloudflare reports
// isEUCountry as the string "1" when applicable.
interface CfLike {
  continent?: string | null;
  country?: string | null;
  isEUCountry?: string | null;
  region?: string | null;
  regionCode?: string | null;
  city?: string | null;
  postalCode?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  metroCode?: string | null;
  timezone?: string | null;
  colo?: string | null;
  asn?: number | null;
  asOrganization?: string | null;
}

// Accepts anything with `req.raw` — every Hono Context qualifies, and keeping
// the parameter structural avoids importing hono's Context type into a file
// that other libs (audit, logger) also lean on.
type HasRawRequest = { req: { raw: Request } };

const clean = (v: string | null | undefined): string | null =>
  v && v.trim().length > 0 ? v : null;

export function getGeo(c: HasRawRequest): GeoInfo {
  const cf = (c.req.raw as { cf?: CfLike }).cf;
  if (!cf) return { ...EMPTY_GEO };
  return {
    continent: clean(cf.continent),
    // "T1" / "XX" are Cloudflare placeholders for unknown/Tor; treat as null.
    country: cf.country && cf.country !== "T1" ? cf.country : null,
    isEUCountry:
      cf.isEUCountry === undefined || cf.isEUCountry === null
        ? null
        : cf.isEUCountry === "1",
    region: clean(cf.region),
    regionCode: clean(cf.regionCode),
    city: clean(cf.city),
    postalCode: clean(cf.postalCode),
    latitude: clean(cf.latitude),
    longitude: clean(cf.longitude),
    metroCode: clean(cf.metroCode),
    timezone: clean(cf.timezone),
    colo: clean(cf.colo),
    asn: typeof cf.asn === "number" ? cf.asn : null,
    org: clean(cf.asOrganization),
  };
}

function isEmptyGeo(g: GeoInfo): boolean {
  return (Object.values(g) as (string | number | boolean | null)[]).every(
    (v) => v === null,
  );
}

// Compact JSON snapshot of the request's geolocation, stored verbatim in
// session_ips.geo and the *_geo columns. Returns null when nothing is known so
// the column stays empty instead of holding an all-null object.
export function geoJson(c: HasRawRequest): string | null {
  const g = getGeo(c);
  return isEmptyGeo(g) ? null : JSON.stringify(g);
}

// Upsert the (session, ip) pair, bumping last_seen and refreshing the geo in
// case Cloudflare's answer changed. `geo` is the JSON string from geoJson().
// Callers should wrap this in `executionCtx.waitUntil` — a security audit
// trail must never delay or fail the request it is describing.
export async function recordSessionIp(
  db: D1Database,
  sessionId: string,
  ip: string,
  geo: string | null,
  now: number,
): Promise<void> {
  if (!ip || ip === "unknown") return;
  await db
    .prepare(
      `INSERT INTO session_ips (session_id, ip_address, geo, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id, ip_address) DO UPDATE SET
         last_seen = excluded.last_seen,
         geo = COALESCE(excluded.geo, session_ips.geo)`,
    )
    .bind(sessionId, ip, geo, now, now)
    .run();
}
