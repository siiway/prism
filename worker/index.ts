// Prism — OAuth Account Platform
// Cloudflare Worker entry point using Hono

import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { Variables } from "./types";

import { requestLogger } from "./lib/logger";
import { runReverification } from "./cron/reverify";
import { runImapPoll } from "./cron/imap-poll";
import { sweepExpiredPowUsed } from "./lib/pow";
import { purgeAppEventQueue } from "./lib/app-events";
import { handleEmailWorker } from "./handlers/email";

import siteRoutes from "./routes/site";
import assetsRoutes from "./routes/assets";
import wellknownRoutes from "./routes/wellknown";
import publicRoutes from "./routes/public";
import initRoutes from "./routes/init";
import authRoutes from "./routes/auth";
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
import proxyRoutes from "./routes/proxy";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Must be registered before secureHeaders/cors so its post-next runs last,
// overriding the CORP and CORS headers those middlewares set globally.
app.use("/api/proxy/image", async (c, next) => {
  await next();
  c.res.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  c.res.headers.set("Access-Control-Allow-Origin", "*");
  c.res.headers.delete("Access-Control-Allow-Credentials");
  c.res.headers.delete("Vary");
});

app.use("*", secureHeaders());
app.use("*", requestLogger);
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

app.route("/api", siteRoutes);
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
app.route("/api/admin", adminRoutes);
app.route("/api/proxy/image", proxyRoutes);
app.route("/.well-known", wellknownRoutes);
app.route("/", publicRoutes);

app.notFound(async (c) => {
  if (c.req.path.startsWith("/api/"))
    return c.json({ error: "Not found" }, 404);
  if (c.env.ASSETS)
    return new Response(
      ...(await c.env.ASSETS.fetch(c.req.raw).then(
        (r) => [r.body, r] as const,
      )),
    );
  return new Response(null, { status: 404 });
});

app.onError((err, c) => {
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
  },

  email: handleEmailWorker,
};
