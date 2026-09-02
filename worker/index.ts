// Prism — OAuth Account Platform
// Cloudflare Worker entry point using Hono

import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { Variables } from "./types";

import { BodySizeLimitError } from "./lib/bodyLimit";
import { requestLogger } from "./lib/logger";
import { requestBodyLimit } from "./middleware/bodyLimit";
import { runReverification } from "./cron/reverify";
import { runImapPoll } from "./cron/imap-poll";
import { sweepExpiredSessions, sweepExpiredOAuthCodes } from "./cron/sessions";
import { sweepExpiredPowUsed } from "./lib/pow";
import { purgeAppEventQueue } from "./lib/app-events";
import { sweepOrphanedImageProxyMappings } from "./lib/proxyImage";
import { handleEmailWorker } from "./handlers/email";

import siteRoutes from "./routes/site";
import assetsRoutes from "./routes/assets";
import wellknownRoutes from "./routes/wellknown";
import publicRoutes from "./routes/public";
import initRoutes from "./routes/init";
import authRoutes from "./routes/auth";
import inviteRegistrationRoutes from "./routes/invite-registration";
import {
  reapDissolvedTeams,
  reapPendingRegistrations,
} from "./cron/restricted";
import oauthRoutes from "./routes/oauth";
import appsRoutes from "./routes/apps";
import teamsRoutes from "./routes/teams";
import domainsRoutes from "./routes/domains";
import connectionsRoutes from "./routes/connections";
import userRoutes from "./routes/user";
import usersRoutes from "./routes/users";
import publicTeamsRoutes from "./routes/public-teams";
import gpgRoutes from "./routes/gpg";
import adminRoutes from "./routes/admin";
import { readerRoutes as noticeRoutes } from "./routes/notices";
import { readerRoutes as legalRoutes } from "./routes/legal";
import auditRoutes from "./routes/audit";
import proxyRoutes from "./routes/proxy";
import { ssrHandler } from "./ssr";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Must be registered before secureHeaders/cors so its post-next runs last,
// overriding the CORP and CORS headers those middlewares set globally.
app.use("/api/proxy/image/*", async (c, next) => {
  await next();
  c.res.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  c.res.headers.set("Access-Control-Allow-Origin", "*");
  c.res.headers.delete("Access-Control-Allow-Credentials");
  c.res.headers.delete("Vary");
});

app.use("*", secureHeaders());
app.use(
  "/api/*",
  cors({
    origin: (origin, c) => {
      const appUrl = c.env.APP_URL;
      if (!origin || origin === appUrl) return appUrl;
      return null;
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Session-Token"],
  }),
);
app.use("*", requestLogger);
app.use("*", requestBodyLimit);

app.route("/api", siteRoutes);
// Mounted at /api because it spans two prefixes: the unauthenticated
// /api/join/:teamId page data and the /api/auth/invite-join/* completion
// steps. Registered before authRoutes so neither shadows the other.
app.route("/api", inviteRegistrationRoutes);
app.route("/api/assets", assetsRoutes);
app.route("/api/init", initRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/oauth", oauthRoutes);
app.route("/api/apps", appsRoutes);
app.route("/api/teams", teamsRoutes);
app.route("/api/domains", domainsRoutes);
app.route("/api/connections", connectionsRoutes);
app.route("/api/user", userRoutes);
app.route("/api/user/gpg", gpgRoutes);
app.route("/api/users", usersRoutes);
app.route("/api/public/teams", publicTeamsRoutes);
// Optional auth: the signed-out pages show `public` notices, which is the
// case a maintenance announcement most needs to reach.
app.route("/api/notices", noticeRoutes);
// Public: the /privacy and /terms pages are reachable without signing in.
app.route("/api/legal", legalRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/audit", auditRoutes);
app.route("/api/proxy/image", proxyRoutes);
app.route("/.well-known", wellknownRoutes);
app.route("/", publicRoutes);

app.notFound(async (c) => {
  if (c.req.path.startsWith("/api/"))
    return c.json({ error: "Not found" }, 404);
  if (c.req.path.startsWith("/.well-known/"))
    return new Response(null, { status: 404 });
  // Anything that wasn't an API route and didn't match a static asset is a
  // user-facing page — render it on the server. Pass app.fetch so the SSR
  // pass can dispatch its own /api/* sub-requests in-process (Cloudflare
  // Workers reject relative-URL fetches, so we can't let route loaders
  // round-trip through the network).
  return await ssrHandler(c, app.fetch.bind(app));
});

app.onError((err, c) => {
  if (err instanceof BodySizeLimitError) {
    return c.json({ error: "Request body too large" }, 413);
  }
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

export default {
  fetch: app.fetch.bind(app),

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runReverification(env.DB));
    ctx.waitUntil(runImapPoll(env, env.KV_CACHE));
    ctx.waitUntil(purgeAppEventQueue(env.DB).catch(() => {}));
    ctx.waitUntil(sweepExpiredPowUsed(env.DB).catch(() => {}));
    ctx.waitUntil(sweepExpiredSessions(env.DB).catch(() => {}));
    ctx.waitUntil(sweepExpiredOAuthCodes(env.DB).catch(() => {}));
    ctx.waitUntil(sweepOrphanedImageProxyMappings(env.DB).catch(() => {}));
    // Both of these do a bounded slice per tick and pick up where they left
    // off — a team with thousands of invite-registered accounts is cleared
    // over several runs rather than one request that would never finish.
    ctx.waitUntil(reapPendingRegistrations(env, ctx).catch(() => {}));
    ctx.waitUntil(reapDissolvedTeams(env, ctx).catch(() => {}));
  },

  email: handleEmailWorker,
};
