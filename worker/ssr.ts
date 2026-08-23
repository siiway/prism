// Worker-side glue between an incoming Request and src/entry-server.tsx.
//
// Responsibilities:
//   1. Pull the prebuilt index.html template from the ASSETS binding (so
//      Vite-injected hashed asset URLs resolve correctly in production).
//   2. Read the session cookie and, if present, prefetch the authenticated
//      user so the SSR pass renders the dashboard instead of a flash of
//      "loading…" before the client hydrates.
//   3. Hand the request off to entry-server.render.

import type { Context } from "hono";
// The SSR entry is JSX. The worker tsconfig doesn't compile JSX (adding it
// drags in DOM types and breaks existing crypto code), so we suppress the
// type-resolution here. Vite resolves the module at bundle time, and the
// runtime contract is documented inline below.
// @ts-expect-error -- JSX module bundled by Vite, not type-checked here.
import { render as _render } from "../src/entry-server";

interface RenderOptions {
  template: string;
  auth?: { token: string | null; user: unknown | null } | null;
  locale?: string | null;
  colorScheme?: "dark" | "light";
  prefetched?: Array<{ queryKey: unknown[]; data: unknown }>;
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
}
interface RenderResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}
const render = _render as (
  request: Request,
  opts: RenderOptions,
) => Promise<RenderResult>;

import { readSessionCookie } from "./lib/cookies";
import { verifyJWT } from "./lib/jwt";
import { getConfigValue, getJwtSecret } from "./lib/config";
import { proxyImageUrl } from "./lib/proxyImage";
import siteRoutes from "./routes/site";
import type { UserRow, Variables } from "./types";

type AppEnv = { Bindings: Env; Variables: Variables };

async function loadAuth(c: Context<AppEnv>) {
  const token = readSessionCookie(c);
  if (!token) return null;

  try {
    const secret = await getJwtSecret(c.env.KV_SESSIONS);
    const payload = await verifyJWT(token, secret);
    const session = await c.env.DB.prepare(
      "SELECT s.id, u.is_active FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ? AND u.kind = 'user'",
    )
      .bind(payload.sessionId)
      .first<{ id: string; is_active: number }>();
    if (!session || !session.is_active) return null;

    const row = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
      .bind(payload.sub)
      .first<UserRow>();
    if (!row) return null;

    return {
      token,
      user: {
        id: row.id,
        email: row.email,
        username: row.username,
        display_name: row.display_name,
        avatar_url: await proxyImageUrl(
          c.env.APP_URL,
          c.env.DB,
          row.avatar_url,
        ),
        unproxied_avatar_url: row.avatar_url,
        role: row.role,
        email_verified: row.email_verified === 1,
      },
    };
  } catch {
    return null;
  }
}

async function loadTemplate(c: Context<AppEnv>): Promise<string | null> {
  if (!c.env.ASSETS) return null;
  // ASSETS is keyed by request URL path; ask it for "/index.html" specifically.
  const url = new URL(c.req.url);
  url.pathname = "/index.html";
  const res = await c.env.ASSETS.fetch(new Request(url.toString()));
  if (!res.ok) return null;
  return await res.text();
}

type AppFetch = (
  req: Request,
  env: Env,
  ctx: Context<AppEnv>["executionCtx"],
) => Response | Promise<Response>;

export async function ssrHandler(
  c: Context<AppEnv>,
  appFetch: AppFetch,
): Promise<Response> {
  const template = await loadTemplate(c);
  if (!template) {
    return new Response("SSR template missing", { status: 500 });
  }

  // Admin kill switch: serve the bare client template and let the bundle
  // hydrate on its own. Mirrors the catch-block fallback further down.
  if (await getConfigValue(c.env.DB, "disable_ssr")) {
    return new Response(
      template
        .replace("<!--app-head-->", "")
        .replace("<!--app-html-->", "")
        .replace("<!--app-state-->", ""),
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  // In-process fetcher passed into the SSR pass so route loaders' api.X()
  // calls (which target relative `/api/...` URLs) dispatch through the
  // same Hono app instead of a network round trip. We forward the original
  // request's cookie header so the auth middleware sees prism_session.
  const origin = new URL(c.req.url).origin;
  const cookieHeader = c.req.header("Cookie") ?? "";
  const fetcher = async (
    input: string,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = /^https?:/i.test(input)
      ? input
      : new URL(input, origin).toString();
    const headers = new Headers(init?.headers ?? {});
    if (cookieHeader && !headers.has("Cookie"))
      headers.set("Cookie", cookieHeader);
    return appFetch(
      new Request(url, { ...init, headers }),
      c.env,
      c.executionCtx,
    );
  };

  const auth = await loadAuth(c);

  // Prefetch the global ["site"] query. Almost every page uses
  // useQuery({ queryKey: ["site"] }) for theming and gating; populating it
  // server-side means the rendered HTML matches what the client would
  // produce after fetching, removing the post-hydration flash.
  const prefetched: Array<{ queryKey: unknown[]; data: unknown }> = [];
  try {
    const siteUrl = new URL(c.req.url);
    siteUrl.pathname = "/site";
    const siteRes = await siteRoutes.fetch(
      new Request(siteUrl.toString(), { headers: c.req.raw.headers }),
      c.env,
      c.executionCtx,
    );
    if (siteRes.ok) {
      const data = await siteRes.json();
      prefetched.push({ queryKey: ["site"], data });
    }
  } catch (err) {
    console.error("SSR site prefetch failed:", err);
  }

  // Pick a locale from the i18nextLng cookie (set by the browser-side
  // detector) or fall back to Accept-Language. Phase 9 wires this through
  // to a per-request i18next instance; for now we just pass it along.
  const readCookie = (name: string): string | null => {
    const raw = c.req.header("Cookie");
    if (!raw) return null;
    for (const part of raw.split(";")) {
      const [n, ...rest] = part.trim().split("=");
      if (n === name) return rest.join("=") || null;
    }
    return null;
  };
  const cookieLocale = readCookie("i18nextLng");
  const acceptLang = c.req.header("Accept-Language");
  const locale =
    cookieLocale ?? acceptLang?.split(",")[0]?.split("-")[0] ?? "en";

  // Resolve color scheme so the SSR pass renders FluentProvider with the
  // same theme the client will hydrate to — otherwise users see a light→
  // dark flash on every page load. The cookie is written by the FOUC shim
  // on first visit (and by ThemeProvider on change); the client hint
  // covers Chromium browsers' first request before the cookie exists.
  const cookieScheme = readCookie("prism_color_scheme");
  const chScheme = c.req.header("Sec-CH-Prefers-Color-Scheme");
  const colorScheme: "dark" | "light" =
    cookieScheme === "dark" || cookieScheme === "light"
      ? cookieScheme
      : chScheme === "dark"
        ? "dark"
        : "light";

  try {
    const result = await render(c.req.raw, {
      template,
      auth: auth ?? undefined,
      locale,
      colorScheme,
      prefetched,
      fetcher,
    });
    return new Response(result.body, {
      status: result.status,
      headers: {
        ...result.headers,
        // Ask Chromium browsers to send the color-scheme client hint on
        // future requests so a cookie-less first visit can still SSR with
        // the right theme. Vary on the inputs that affect the response.
        "Accept-CH": "Sec-CH-Prefers-Color-Scheme",
        Vary: "Cookie, Sec-CH-Prefers-Color-Scheme, Accept-Language",
      },
    });
  } catch (err) {
    console.error("SSR error:", err);
    // Last-ditch: return the un-rendered template so the client can still
    // hydrate. Better than a blank 500.
    return new Response(
      template
        .replace("<!--app-head-->", "")
        .replace("<!--app-html-->", "")
        .replace("<!--app-state-->", ""),
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}
