// Frontend rendering of the geo JSON snapshots the worker stores alongside
// request IPs (session_ips.geo, and the *_geo columns on audit events, login
// errors). Shape mirrors worker/lib/geo.ts GeoInfo.

export interface IpGeo {
  continent?: string | null;
  country?: string | null;
  isEUCountry?: boolean | null;
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
  org?: string | null;
}

export function parseIpGeo(json: string | null | undefined): IpGeo | null {
  if (!json) return null;
  try {
    const g = JSON.parse(json) as IpGeo;
    return g && typeof g === "object" ? g : null;
  } catch {
    return null;
  }
}

// "City, Region, Country" with blanks dropped and repeats de-duplicated
// (city-states report the same value for several fields). Returns "" when
// nothing is known.
export function formatLocation(
  city: string | null | undefined,
  region: string | null | undefined,
  country: string | null | undefined,
): string {
  const parts = [city, region, country].filter(
    (p): p is string => !!p && p.trim().length > 0,
  );
  const seen = new Set<string>();
  const unique = parts.filter((p) => {
    const key = p.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.join(", ");
}

// Convenience: parse a geo JSON string straight to a compact location label
// (used by the tables / tooltips that only show location).
export function formatIpGeo(json: string | null | undefined): string {
  const g = parseIpGeo(json);
  if (!g) return "";
  return formatLocation(g.city, g.region, g.country);
}

// "AS<number> · <org>" for the network the IP belongs to. Returns "" when
// neither field is known.
export function formatNetwork(
  asn: number | null | undefined,
  org: string | null | undefined,
): string {
  const asnPart = asn ? `AS${asn}` : "";
  const orgPart = org?.trim() ?? "";
  if (asnPart && orgPart) return `${asnPart} · ${orgPart}`;
  return asnPart || orgPart || "";
}

// The geo fields, in display order, paired with the i18n key for their label.
// Used by the session detail dialog to dump *everything* Cloudflare returned
// for an IP. `latitude`/`longitude` are folded into a single coordinate row by
// the caller, so they're intentionally excluded here.
export const GEO_FIELD_ORDER: {
  key: keyof IpGeo;
  labelKey: string;
}[] = [
  { key: "continent", labelKey: "security.geo.continent" },
  { key: "country", labelKey: "security.geo.country" },
  { key: "isEUCountry", labelKey: "security.geo.isEUCountry" },
  { key: "region", labelKey: "security.geo.region" },
  { key: "regionCode", labelKey: "security.geo.regionCode" },
  { key: "city", labelKey: "security.geo.city" },
  { key: "postalCode", labelKey: "security.geo.postalCode" },
  { key: "timezone", labelKey: "security.geo.timezone" },
  { key: "metroCode", labelKey: "security.geo.metroCode" },
  { key: "colo", labelKey: "security.geo.colo" },
  { key: "asn", labelKey: "security.geo.asn" },
  { key: "org", labelKey: "security.geo.org" },
];

// Build the ordered {label, value} rows for every field the snapshot actually
// has a value for, so the detail dialog shows all captured info and skips
// blanks. `t` is passed in to keep this file free of i18n / React imports.
export function geoDetailRows(
  geo: IpGeo | null,
  t: (key: string) => string,
): { label: string; value: string }[] {
  if (!geo) return [];
  const rows: { label: string; value: string }[] = [];
  for (const { key, labelKey } of GEO_FIELD_ORDER) {
    const raw = geo[key];
    if (raw === null || raw === undefined || raw === "") continue;
    let value: string;
    if (key === "isEUCountry") value = raw ? t("common.yes") : t("common.no");
    else if (key === "asn") value = `AS${raw}`;
    else value = String(raw);
    rows.push({ label: t(labelKey), value });
  }
  // Fold lat/long into one row when either is present.
  if (geo.latitude || geo.longitude) {
    rows.push({
      label: t("security.geo.coordinates"),
      value: `${geo.latitude ?? "?"}, ${geo.longitude ?? "?"}`,
    });
  }
  return rows;
}
