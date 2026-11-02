// Admin → reset everything: the guarded, two-step wipe of all instance data.

import { Hono } from "hono";
import { getConfig } from "../lib/config";
import { verifyAnyTotp } from "../lib/totp";
import { PRISM_INTERNAL_CLIENT_ID, grantSudo, isSudoActive } from "../lib/sudo";
import type { Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// ─── Reset everything ─────────────────────────────────────────────────────────
//
// Disabled by default — set ENABLE_RESET="true" in wrangler.jsonc to expose the
// admin UI button. Confirming a reset is a two-step process: an admin first
// "requests" a reset (proving 2FA), then must wait one full week before they
// can confirm. The cooldown can be skipped per-deployment with
// NO_RESET_COOLDOWN="true" — useful for staging / first-run setups.
//
// 2FA is handled via the existing sudo-mode primitive: Prism is treated as a
// synthetic OAuth client (PRISM_INTERNAL_CLIENT_ID) so a successful TOTP/backup
// proof grants a sudo window that confirm/cancel can ride on without
// re-prompting. Confirm always re-checks: either an active sudo grant or a
// fresh TOTP code is acceptable.

const RESET_COOLDOWN_SECONDS = 7 * 24 * 60 * 60;

function isFlagEnabled(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function resetRequestKvKey(): string {
  return "admin:reset-request";
}

interface PendingResetRecord {
  user_id: string;
  requested_at: number;
  eligible_at: number;
}

async function loadPendingReset(
  kv: KVNamespace,
): Promise<PendingResetRecord | null> {
  const raw = await kv.get(resetRequestKvKey());
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingResetRecord;
  } catch {
    return null;
  }
}

app.get("/reset/status", async (c) => {
  const enabled = isFlagEnabled(c.env.ENABLE_RESET);
  const cooldownRequired = !isFlagEnabled(c.env.NO_RESET_COOLDOWN);
  const pending = await loadPendingReset(c.env.KV_CACHE);
  const sessionId = c.get("sessionId");
  const user = c.get("user");
  const sudoActive =
    !!sessionId &&
    (await isSudoActive(
      c.env.KV_CACHE,
      user.id,
      sessionId,
      PRISM_INTERNAL_CLIENT_ID,
    ));

  return c.json({
    enabled,
    cooldown_required: cooldownRequired,
    cooldown_seconds: RESET_COOLDOWN_SECONDS,
    sudo_active: sudoActive,
    pending: pending
      ? {
          requested_at: pending.requested_at,
          eligible_at: pending.eligible_at,
          requested_by_self: pending.user_id === user.id,
        }
      : null,
  });
});

app.post("/reset/request", async (c) => {
  if (!isFlagEnabled(c.env.ENABLE_RESET)) {
    return c.json({ error: "reset_disabled" }, 403);
  }

  const user = c.get("user");
  const sessionId = c.get("sessionId");
  const body = await c.req
    .json<{ totp_code?: string }>()
    .catch(() => ({}) as { totp_code?: string });

  // Either an active sudo grant or a fresh TOTP code authorises requesting.
  const sudoActive =
    !!sessionId &&
    (await isSudoActive(
      c.env.KV_CACHE,
      user.id,
      sessionId,
      PRISM_INTERNAL_CLIENT_ID,
    ));
  if (!sudoActive) {
    if (!body.totp_code) {
      return c.json({ error: "totp_required" }, 400);
    }
    const ok = await verifyAnyTotp(c.env, user.id, body.totp_code);
    if (!ok) return c.json({ error: "invalid_totp" }, 400);
    if (sessionId) {
      const config = await getConfig(c.env.DB);
      const ttl = Math.max(0, config.sudo_mode_ttl_minutes);
      if (ttl > 0) {
        await grantSudo(
          c.env.KV_CACHE,
          user.id,
          sessionId,
          PRISM_INTERNAL_CLIENT_ID,
          ttl,
        );
      }
    }
  }

  const existing = await loadPendingReset(c.env.KV_CACHE);
  if (existing) {
    return c.json(
      {
        error: "already_pending",
        requested_at: existing.requested_at,
        eligible_at: existing.eligible_at,
      },
      409,
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const cooldownRequired = !isFlagEnabled(c.env.NO_RESET_COOLDOWN);
  const eligibleAt = now + (cooldownRequired ? RESET_COOLDOWN_SECONDS : 0);
  const record: PendingResetRecord = {
    user_id: user.id,
    requested_at: now,
    eligible_at: eligibleAt,
  };
  // KV expirationTtl rounds down on tiny values; pad for the no-cooldown case.
  await c.env.KV_CACHE.put(resetRequestKvKey(), JSON.stringify(record), {
    expirationTtl: Math.max(60, RESET_COOLDOWN_SECONDS + 86400),
  });

  return c.json({
    requested_at: now,
    eligible_at: eligibleAt,
  });
});

app.post("/reset/cancel", async (c) => {
  await c.env.KV_CACHE.delete(resetRequestKvKey());
  return c.json({ cancelled: true });
});

app.post("/reset/confirm", async (c) => {
  if (!isFlagEnabled(c.env.ENABLE_RESET)) {
    return c.json({ error: "reset_disabled" }, 403);
  }

  const user = c.get("user");
  const sessionId = c.get("sessionId");
  const body = await c.req
    .json<{ confirm?: string; totp_code?: string }>()
    .catch(() => ({}) as { confirm?: string; totp_code?: string });
  if (body.confirm !== "RESET_EVERYTHING") {
    return c.json({ error: "confirmation_required" }, 400);
  }

  const pending = await loadPendingReset(c.env.KV_CACHE);
  if (!pending) {
    return c.json({ error: "no_pending_request" }, 400);
  }
  const now = Math.floor(Date.now() / 1000);
  if (now < pending.eligible_at) {
    return c.json(
      {
        error: "cooldown_active",
        eligible_at: pending.eligible_at,
      },
      400,
    );
  }

  // Sudo or a fresh TOTP code each authorise confirmation.
  const sudoActive =
    !!sessionId &&
    (await isSudoActive(
      c.env.KV_CACHE,
      user.id,
      sessionId,
      PRISM_INTERNAL_CLIENT_ID,
    ));
  if (!sudoActive) {
    if (!body.totp_code) {
      return c.json({ error: "totp_required" }, 400);
    }
    const ok = await verifyAnyTotp(c.env, user.id, body.totp_code);
    if (!ok) return c.json({ error: "invalid_totp" }, 400);
  }

  // Delete all data in reverse dependency order (leaves first)
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM webhook_deliveries"),
    c.env.DB.prepare("DELETE FROM webhooks"),
    c.env.DB.prepare("DELETE FROM oauth_tokens"),
    c.env.DB.prepare("DELETE FROM oauth_codes"),
    c.env.DB.prepare("DELETE FROM oauth_2fa_codes"),
    c.env.DB.prepare("DELETE FROM oauth_2fa_challenges"),
    c.env.DB.prepare("DELETE FROM oauth_consents"),
    c.env.DB.prepare("DELETE FROM personal_access_tokens"),
    c.env.DB.prepare("DELETE FROM sessions"),
    c.env.DB.prepare("DELETE FROM totp_authenticators"),
    c.env.DB.prepare("DELETE FROM user_totp_recovery"),
    c.env.DB.prepare("DELETE FROM passkeys"),
    c.env.DB.prepare("DELETE FROM social_connections"),
    c.env.DB.prepare("DELETE FROM user_emails"),
    c.env.DB.prepare("DELETE FROM user_notification_prefs"),
    c.env.DB.prepare("DELETE FROM user_gpg_keys"),
    c.env.DB.prepare("DELETE FROM login_errors"),
    c.env.DB.prepare("DELETE FROM domains"),
    c.env.DB.prepare("DELETE FROM audit_log"),
    c.env.DB.prepare("DELETE FROM audit_events"),
    c.env.DB.prepare("DELETE FROM audit_webhooks"),
    c.env.DB.prepare("DELETE FROM team_invites"),
    c.env.DB.prepare("DELETE FROM team_members"),
    c.env.DB.prepare("DELETE FROM oauth_apps"),
    c.env.DB.prepare("DELETE FROM teams"),
    c.env.DB.prepare("DELETE FROM site_invites"),
    c.env.DB.prepare("DELETE FROM oauth_sources"),
    c.env.DB.prepare("DELETE FROM users"),
    c.env.DB.prepare("DELETE FROM site_config"),
  ]);

  // Flush both KV namespaces (paginated to handle > 1000 keys)
  const flushKv = async (kv: KVNamespace) => {
    let cursor: string | undefined;
    do {
      const result = await kv.list({ cursor });
      await Promise.all(result.keys.map((k) => kv.delete(k.name)));
      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);
  };
  await Promise.all([flushKv(c.env.KV_SESSIONS), flushKv(c.env.KV_CACHE)]);

  return c.json({ ok: true });
});

// Back-compat: legacy single-shot endpoint. 308 preserves the POST body so
// older clients that hit POST /admin/reset still land on the confirmation
// route and inherit the same gates (env flag, pending request, cooldown, 2FA).
app.post("/reset", (c) => {
  const url = new URL(c.req.url);
  url.pathname = url.pathname.replace(/\/reset$/, "/reset/confirm");
  return c.redirect(url.toString(), 308);
});

export default app;
