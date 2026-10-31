// Command palette search. Nothing here lists pages or settings by hand:
//
// - Pages, settings cards and their field labels come from
//   virtual:search-index, extracted from the routes and page sources at
//   build time (vite/searchIndex.ts).
// - Admin pages come from the admin sidebar's own definitions.
// - Data (apps, teams, users, …) comes from GET /api/search, one request
//   that runs every lookup server-side (worker/routes/search.ts).
//
// Every built-in label is matched in all languages and shown in the
// current one, so "通行密钥" finds Passkeys in the English UI and vice versa.

import {
  AddRegular,
  AppsRegular,
  DocumentRegular,
  GlobeRegular,
  HomeRegular,
  KeyRegular,
  LockClosedRegular,
  PeopleRegular,
  PersonRegular,
  PlugConnectedRegular,
  SettingsRegular,
  type FluentIcon,
} from "@fluentui/react-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import searchIndex from "virtual:search-index";
import { useApi } from "./api-context";
import type { SearchHit } from "./api";
import { useAuthStore } from "../store/auth";
import { SUPPORTED_LNGS } from "../i18n/init";
import { buildAdminNav } from "../pages/admin/adminNav";

export type SearchGroup = "pages" | "settings" | "admin" | "results";

/** A label as shown (current language) and in every language, for matching. */
export interface Label {
  text: string;
  all: string[];
}

export interface SearchEntry {
  id: string;
  group: SearchGroup;
  title: Label;
  /** Where it lives, e.g. "Security", shown before the description. */
  context?: Label;
  description?: Label;
  keywords: Label[];
  to: string;
  icon: FluentIcon;
  /** Found by a server-side search (it may match fields not shown here). */
  remote?: boolean;
}

const plain = (text: string): Label => ({ text, all: [text] });

function pageIcon(path: string): FluentIcon {
  if (path === "/") return HomeRegular;
  if (path.endsWith("/new")) return AddRegular;
  return DocumentRegular;
}

/** Pages, settings cards and admin sections. */
export function useStaticEntries(): SearchEntry[] {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const isAdmin = useAuthStore((s) => s.user?.role === "admin");
  const lang = i18n.language;

  return useMemo(() => {
    const fixed = SUPPORTED_LNGS.map((l) => i18n.getFixedT(l));
    const label = (key: string): Label => ({
      text: t(key),
      all: fixed.map((f) => f(key)),
    });
    const entries: SearchEntry[] = [];

    // Admin sidebar, once per language so titles match across languages.
    // The storage-console flag is read from cache only: search makes no
    // admin requests of its own.
    const adminLabels = new Map<
      string,
      { title: Label; description: Label; icon: FluentIcon }
    >();
    if (isAdmin) {
      const db = qc.getQueryData<{ mode: string }>(["admin-db-status"]);
      const kv = qc.getQueryData<{ mode: string }>(["admin-kv-status"]);
      const storage =
        (!!db && db.mode !== "off") || (!!kv && kv.mode !== "off");
      const current = buildAdminNav(t, storage).flatMap((g) => g.items);
      const perLang = fixed.map((f) =>
        buildAdminNav(f, storage).flatMap((g) => g.items),
      );
      current.forEach((item, i) =>
        adminLabels.set(item.to, {
          title: { text: item.label, all: perLang.map((l) => l[i].label) },
          description: {
            text: item.description,
            all: perLang.map((l) => l[i].description),
          },
          icon: item.icon,
        }),
      );
    }

    for (const page of searchIndex) {
      const admin = page.path === "/admin" || page.path.startsWith("/admin/");
      if (admin && !isAdmin) continue;
      const nav = admin ? adminLabels.get(page.path) : undefined;
      const title = nav?.title ?? (page.title ? label(page.title) : undefined);
      if (!title) continue;

      entries.push({
        id: `page:${page.path}`,
        group: admin ? "admin" : "pages",
        title,
        context: admin ? label("nav.admin") : undefined,
        description:
          nav?.description ??
          (page.description ? label(page.description) : undefined),
        keywords: page.keywords.map(label),
        to: page.path,
        icon: nav?.icon ?? pageIcon(page.path),
      });
      for (const card of page.cards)
        entries.push({
          id: `card:${page.path}#${card.id}`,
          group: admin ? "admin" : "settings",
          title: label(card.title),
          context: title,
          description: card.description ? label(card.description) : undefined,
          keywords: card.keywords.map(label),
          to: `${page.path}#${card.id}`,
          icon: SettingsRegular,
        });
    }
    return entries;
    // lang: labels are re-resolved when the language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, i18n, qc, isAdmin, lang]);
}

// ── Data ─────────────────────────────────────────────────────────────────

const KIND_ICONS: Record<SearchHit["kind"], FluentIcon> = {
  app: AppsRegular,
  team: PeopleRegular,
  domain: GlobeRegular,
  token: KeyRegular,
  consent: LockClosedRegular,
  user: PersonRegular,
  oauth_source: PlugConnectedRegular,
};

// Where a result lives: the user's own list, or the admin list for
// site-wide results.
const KIND_CONTEXT: Record<SearchHit["kind"], [mine: string, admin: string]> = {
  app: ["nav.myApps", "admin.applicationsTab"],
  team: ["nav.teams", "admin.teamsTab"],
  domain: ["nav.domains", "admin.domainsTab"],
  token: ["nav.tokens", "nav.tokens"],
  consent: ["nav.connectedApps", "nav.connectedApps"],
  user: ["admin.usersTab", "admin.usersTab"],
  oauth_source: ["admin.connectionsTab", "admin.connectionsTab"],
};

/** Server-side matches for `query` (2+ characters), from GET /api/search:
 *  one request that looks up every kind of item the user can open. */
export function useRemoteEntries(query: string): {
  entries: SearchEntry[];
  loading: boolean;
} {
  const api = useApi();
  const { t } = useTranslation();
  const q = query.trim();
  const { data, isFetching } = useQuery({
    queryKey: ["search", q],
    queryFn: () => api.search(q),
    enabled: q.length >= 2,
    staleTime: 30_000,
    retry: false,
  });

  const entries = useMemo(
    () =>
      (data?.results ?? []).map((hit): SearchEntry => ({
        id: `${hit.kind}:${hit.admin ? "admin" : "mine"}:${hit.id}`,
        group: "results",
        title: plain(hit.title),
        context: plain(t(KIND_CONTEXT[hit.kind][hit.admin ? 1 : 0])),
        description: hit.subtitle ? plain(hit.subtitle) : undefined,
        keywords: [],
        to: hit.url,
        icon: KIND_ICONS[hit.kind],
        remote: true,
      })),
    [data, t],
  );
  return { entries, loading: q.length >= 2 && isFetching };
}

// ── Matching ─────────────────────────────────────────────────────────────

export interface SearchResult {
  entry: SearchEntry;
  /** The keyword that matched when the title didn't, to show why. */
  matchedKeyword?: string;
  score: number;
}

const GROUP_ORDER: SearchGroup[] = ["pages", "settings", "admin", "results"];
const norm = (s: string) => s.toLocaleLowerCase().normalize("NFKC");

/** Every query word must appear in the entry, in any language; titles rank
 *  first. Server-side results are kept even when they matched on a field
 *  not shown here. */
export function searchEntries(
  entries: SearchEntry[],
  query: string,
): SearchResult[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0)
    return entries
      .filter((e) => !e.id.startsWith("card:"))
      .map((entry) => ({ entry, score: 0 }));

  const phrase = words.join(" ");
  const results: SearchResult[] = [];
  for (const entry of entries) {
    const titles = entry.title.all.map(norm);
    const keywords = entry.keywords.map((k) => ({
      text: k.text,
      all: k.all.map(norm),
    }));
    const rest = [
      ...(entry.context?.all ?? []),
      ...(entry.description?.all ?? []),
    ].map(norm);
    const haystack = [
      ...titles,
      ...keywords.flatMap((k) => k.all),
      ...rest,
    ].join("\n");

    let score: number | null = null;
    let matchedKeyword: string | undefined;
    if (titles.some((s) => s.startsWith(phrase))) score = 0;
    else if (titles.some((s) => s.includes(phrase))) score = 1;
    else if (titles.some((s) => words.every((w) => s.includes(w)))) score = 2;
    else {
      const kw = keywords.find((k) =>
        k.all.some((s) => words.every((w) => s.includes(w))),
      );
      if (kw) {
        score = 3;
        matchedKeyword = kw.text;
      } else if (words.every((w) => haystack.includes(w))) score = 4;
      else if (entry.remote) score = 5;
    }
    if (score !== null) results.push({ entry, matchedKeyword, score });
  }
  return results.sort(
    (a, b) =>
      a.score - b.score ||
      GROUP_ORDER.indexOf(a.entry.group) - GROUP_ORDER.indexOf(b.entry.group),
  );
}

export { GROUP_ORDER as SEARCH_GROUPS };
