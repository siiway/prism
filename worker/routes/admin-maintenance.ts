// Run the scheduled jobs on demand.
//
// Eight maintenance tasks run from the cron trigger every six hours. That is
// the right cadence for steady state and the wrong one for every moment an
// operator actually thinks about them: DNS was just fixed and the domain is
// still unverified; a dissolution is staged and the accounts are still there;
// mail was reconfigured and nothing has been polled since.
//
// Waiting up to six hours to find out whether a fix worked is a poor
// debugging loop, and the workaround — redeploying to force a tick, or
// reproducing the job's SQL by hand in the database console — is worse than
// the button.
//
// These are the same functions `scheduled()` calls, imported rather than
// reimplemented, so a job cannot behave differently depending on who started
// it. They are awaited rather than deferred to waitUntil: the caller pressed
// a button and is owed the outcome.
//
// Mounted under /api/admin, which already sits behind requireAdmin.

import { Hono } from "hono";
import { getIp } from "../lib/clientIp";
import { recordAudit, auditRequestMeta } from "../lib/audit";
import { runReverification } from "../cron/reverify";
import { sweepExpiredSessions } from "../cron/sessions";
import { reapPendingRegistrations, reapDissolvedTeams } from "../cron/restricted";
import { sweepExpiredPowUsed } from "../lib/pow";
import { purgeAppEventQueue } from "../lib/app-events";
import { sweepOrphanedImageProxyMappings } from "../lib/proxyImage";
import type { Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

/** One runnable job.
 *
 *  `run` returns whatever the underlying task reports — a count where the
 *  task keeps one, `null` where it does not. Reporting `null` honestly beats
 *  inventing a zero: "swept 0" and "this job doesn't count what it swept"
 *  are different answers, and only one of them means nothing was wrong. */
interface Job {
  key: string;
  /** True when the job changes data rather than only reading it. */
  writes: boolean;
  run: (
    env: Env,
    ctx: { waitUntil: (p: Promise<unknown>) => void },
  ) => Promise<number | null>;
}

const JOBS: Job[] = [
  {
    key: "reverify-domains",
    writes: true,
    run: async (env) => {
      await runReverification(env.DB);
      return null;
    },
  },
  {
    key: "imap-poll",
    writes: true,
    // Imported lazily. This one reaches `cloudflare:sockets` through the IMAP
    // client, and there is no reason for every admin request to carry that —
    // `auth.ts` defers it for the same reason.
    run: async (env) => {
      const { runImapPoll } = await import("../cron/imap-poll");
      await runImapPoll(env, env.KV_CACHE);
      return null;
    },
  },
  {
    key: "sweep-sessions",
    writes: true,
    run: async (env) => {
      await sweepExpiredSessions(env.DB);
      return null;
    },
  },
  {
    key: "sweep-pow",
    writes: true,
    run: async (env) => {
      await sweepExpiredPowUsed(env.DB);
      return null;
    },
  },
  {
    key: "purge-app-events",
    writes: true,
    run: async (env) => {
      await purgeAppEventQueue(env.DB);
      return null;
    },
  },
  {
    key: "sweep-image-proxy",
    writes: true,
    run: async (env) => (await sweepOrphanedImageProxyMappings(env.DB)).deleted,
  },
  {
    key: "reap-pending-registrations",
    writes: true,
    run: (env, ctx) => reapPendingRegistrations(env, ctx),
  },
  {
    key: "reap-dissolved-teams",
    writes: true,
    run: (env, ctx) => reapDissolvedTeams(env, ctx),
  },
];

app.get("/jobs", (c) =>
  c.json({
    jobs: JOBS.map((j) => ({ key: j.key, writes: j.writes })),
    // The cron expression these normally run on, so the page can say how long
    // the wait would otherwise have been.
    schedule: "0 */6 * * *",
  }),
);

app.post("/jobs/:key/run", async (c) => {
  const key = c.req.param("key");
  const job = JOBS.find((j) => j.key === key);
  if (!job) return c.json({ error: "Unknown job" }, 404);

  const admin = c.get("user");
  const meta = auditRequestMeta(c);
  const started = Date.now();

  let processed: number | null = null;
  let error: string | null = null;
  try {
    processed = await job.run(c.env, c.executionCtx);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const durationMs = Date.now() - started;

  // Audited whether it succeeded or not. A job an operator ran twenty minutes
  // before things went strange is exactly the kind of thing worth finding
  // afterwards, and a failed run is more interesting than a clean one.
  void recordAudit(c.env, c.executionCtx, {
    scope: "platform",
    scopeId: null,
    action: error ? "admin.maintenance.error" : "admin.maintenance.run",
    actorId: admin.id,
    actorName: admin.username,
    resourceType: "job",
    resourceId: job.key,
    resourceName: null,
    ip: meta.ip ?? getIp(c),
    userAgent: meta.userAgent,
    geo: meta.geo,
    metadata: { job: job.key, processed, duration_ms: durationMs, error },
  });

  if (error) return c.json({ error, job: job.key, duration_ms: durationMs }, 500);
  return c.json({
    message: "Job finished",
    job: job.key,
    // null means the task keeps no count, not that it did nothing.
    processed,
    duration_ms: durationMs,
  });
});

export default app;
