import { describe, expect, test } from "bun:test";
import { render } from "../src/entry-server";
import type { ApiFetcher, UserProfile } from "../src/lib/api";

const TEMPLATE = [
  "<!doctype html><html><head><!--app-head--></head>",
  '<body><div id="root"><!--app-html--></div>',
  "<!--app-state--></body></html>",
].join("");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function user(sentinel: string): UserProfile {
  return {
    id: `id-${sentinel}`,
    email: `${sentinel.toLowerCase()}@example.com`,
    username: sentinel.toLowerCase(),
    display_name: `AUTH_${sentinel}`,
    avatar_url: null,
    unproxied_avatar_url: null,
    role: "user",
    email_verified: true,
    alt_email_login: null,
    access_token_ttl_minutes: null,
    refresh_token_ttl_days: null,
    profile_is_public: false,
    profile_show_display_name: null,
    profile_show_avatar: null,
    profile_show_email: null,
    profile_show_joined_at: null,
    profile_show_gpg_keys: null,
    profile_show_authorized_apps: null,
    profile_show_owned_apps: null,
    profile_show_domains: null,
    profile_show_joined_teams: null,
    profile_show_readme: null,
    profile_readme: null,
    profile_readme_updated_at: null,
    profile_readme_source: "manual",
    profile_readme_source_meta: null,
    profile_readme_synced_at: null,
    github_readme_token_set: false,
  };
}

function requestHarness(sentinel: string) {
  const entered = deferred();
  const release = deferred();
  let blockedLoader = false;

  const fetcher: ApiFetcher = async (input, init) => {
    const url = new URL(input, "https://prism.test");

    // Pause the first loader fetch. Releasing A while B remains paused forces
    // A's component-discovered queries to run during B's in-flight render.
    if (url.pathname === "/api/apps" && !url.search && !blockedLoader) {
      blockedLoader = true;
      entered.resolve();
      await release.promise;
    }

    // SSR API calls authenticate through the request-bound cookie transport;
    // entry-server must never reconstruct a JavaScript-visible Bearer header.
    expect(new Headers(init?.headers).has("Authorization")).toBeFalse();

    let data: unknown;
    switch (url.pathname) {
      case "/api/apps":
        data = {
          apps: [],
          total: 0,
          page: 1,
          limit: 20,
          sentinel: `QUERY_${sentinel}`,
        };
        break;
      case "/api/user/me/restriction":
        data = { restricted: false, capabilities: {} };
        break;
      case "/api/notices":
        data = { notices: [] };
        break;
      default:
        data = {};
    }
    return Response.json(data);
  };

  return { entered, release, fetcher };
}

const site = {
  initialized: true,
  site_name: "Prism test",
  site_description: "",
  site_icon_url: null,
  allow_registration: true,
  invite_only: false,
  captcha_provider: "none",
  captcha_site_key: "",
  pow_difficulty: 1,
  require_email_verification: false,
  email_verify_methods: "link",
  accent_color: "#0078d4",
  custom_css: "",
};

function dehydratedQuery(body: string, queryKey: unknown[]): unknown {
  const prefix = "<script>window.__INITIAL__=";
  const start = body.indexOf(prefix);
  const end = body.indexOf("</script>", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  const payload = JSON.parse(body.slice(start + prefix.length, end)) as {
    queryState: {
      queries: Array<{ queryKey: unknown[]; state: { data: unknown } }>;
    };
  };
  return payload.queryState.queries.find(
    (query) => JSON.stringify(query.queryKey) === JSON.stringify(queryKey),
  )?.state.data;
}

async function waitUntilEntered(
  entered: Promise<void>,
  rendering: Promise<unknown>,
  label: string,
): Promise<void> {
  await Promise.race([
    entered,
    rendering.then(
      () => Promise.reject(new Error(`${label} completed before its barrier`)),
      (error: unknown) => Promise.reject(error),
    ),
  ]);
}

describe("SSR request isolation", () => {
  test("concurrent renders cannot exchange API or auth state", async () => {
    const a = requestHarness("A");
    const b = requestHarness("B");
    const renders: Promise<unknown>[] = [];

    try {
      const renderA = render(
        new Request("https://prism.test/apps", {
          headers: { Cookie: "__Host-prism_session=token-A" },
        }),
        {
          template: TEMPLATE,
          auth: { user: user("A") },
          colorScheme: "dark",
          prefetched: [{ queryKey: ["site"], data: site }],
          fetcher: a.fetcher,
        },
      );
      renders.push(renderA);

      await waitUntilEntered(a.entered.promise, renderA, "render A");
      const renderB = render(
        new Request("https://prism.test/apps", {
          headers: { Cookie: "__Host-prism_session=token-B" },
        }),
        {
          template: TEMPLATE,
          auth: { user: user("B") },
          colorScheme: "light",
          prefetched: [{ queryKey: ["site"], data: site }],
          fetcher: b.fetcher,
        },
      );
      renders.push(renderB);

      await waitUntilEntered(b.entered.promise, renderB, "render B");
      a.release.resolve();
      const resultA = await renderA;
      b.release.resolve();
      const resultB = await renderB;

      // This paginated key is discovered from AppList only after the blocked
      // route loader completes, so it specifically exercises async SSR query
      // prefetch rather than merely checking loader data.
      expect(dehydratedQuery(resultA.body, ["apps", 1, ""])).toEqual(
        expect.objectContaining({ sentinel: "QUERY_A" }),
      );
      expect(dehydratedQuery(resultB.body, ["apps", 1, ""])).toEqual(
        expect.objectContaining({ sentinel: "QUERY_B" }),
      );

      expect(resultA.body).toContain("QUERY_A");
      expect(resultA.body).toContain("AUTH_A");
      expect(resultA.body).not.toContain("token-A");
      expect(resultA.body).not.toContain("QUERY_B");
      expect(resultA.body).not.toContain("AUTH_B");
      expect(resultA.body).not.toContain("token-B");

      expect(resultB.body).toContain("QUERY_B");
      expect(resultB.body).toContain("AUTH_B");
      expect(resultB.body).not.toContain("token-B");
      expect(resultB.body).not.toContain("QUERY_A");
      expect(resultB.body).not.toContain("AUTH_A");
      expect(resultB.body).not.toContain("token-A");
    } finally {
      // Ensure a failed assertion never leaves either render suspended or an
      // unhandled rejection behind.
      a.release.resolve();
      b.release.resolve();
      await Promise.allSettled(renders);
    }
  });
});
