// Admin → secrets at rest: status and migration of sensitive values to
// SECRETS_KEY encryption (site config and OAuth credentials) and keyed
// hashes (bearer tokens and codes stored in D1).

import { Hono } from "hono";
import { configBag, getConfig, setConfigValues } from "../lib/config";
import {
  SENSITIVE_CONFIG_KEYS,
  encryptSecret,
  hashSecret,
  isEncryptedSecret,
  isHashedSecret,
  isSecretsKeyConfigured,
} from "../lib/secretCrypto";
import { auditAdmin } from "../lib/audit";
import type { Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// ─── Secret Store migration ──────────────────────────────────────────────────
//
// Encrypts every plaintext sensitive value at rest using the SECRETS_KEY
// binding. Idempotent: rows that are already encrypted are left alone, so
// the admin can run this repeatedly (after adding new OAuth sources, for
// example) without harm.
//
// Status endpoint returns counts so the UI can show progress before/after.

interface SecretsMigrateStatus {
  binding_configured: boolean;
  oauth_apps_total: number;
  oauth_apps_plaintext: number;
  oauth_sources_total: number;
  oauth_sources_plaintext: number;
  user_github_pats_total: number;
  user_github_pats_plaintext: number;
  config_sensitive_total: number;
  config_sensitive_plaintext: number;
}

app.get("/secrets/status", async (c) => {
  const status = await collectSecretsStatus(c.env);
  return c.json(status);
});

app.post("/secrets/migrate", async (c) => {
  if (!isSecretsKeyConfigured(c.env)) {
    return c.json(
      {
        error: "secrets_key_missing",
      },
      400,
    );
  }

  // Run a real encryption attempt first to surface any "wrong key length"
  // / "binding misconfigured" errors before we touch any rows.
  try {
    await encryptSecret(c.env, "smoke-test");
  } catch (err) {
    return c.json(
      {
        error: "secrets_key_rejected",
        params: { detail: err instanceof Error ? err.message : String(err) },
      },
      400,
    );
  }

  const before = await collectSecretsStatus(c.env);

  // ── oauth_apps.client_secret ────────────────────────────────────────────
  const apps = await c.env.DB.prepare(
    "SELECT id, client_secret FROM oauth_apps",
  ).all<{ id: string; client_secret: string | null }>();
  let appsEncrypted = 0;
  for (const row of apps.results) {
    if (!row.client_secret || isEncryptedSecret(row.client_secret)) continue;
    const ct = await encryptSecret(c.env, row.client_secret);
    await c.env.DB.prepare(
      "UPDATE oauth_apps SET client_secret = ? WHERE id = ?",
    )
      .bind(ct, row.id)
      .run();
    appsEncrypted++;
  }

  // ── oauth_sources.client_secret ─────────────────────────────────────────
  const sources = await c.env.DB.prepare(
    "SELECT id, client_secret FROM oauth_sources",
  ).all<{ id: string; client_secret: string | null }>();
  let sourcesEncrypted = 0;
  for (const row of sources.results) {
    if (!row.client_secret || isEncryptedSecret(row.client_secret)) continue;
    const ct = await encryptSecret(c.env, row.client_secret);
    await c.env.DB.prepare(
      "UPDATE oauth_sources SET client_secret = ? WHERE id = ?",
    )
      .bind(ct, row.id)
      .run();
    sourcesEncrypted++;
  }

  // ── users.github_readme_token ───────────────────────────────────────────
  const userPats = await c.env.DB.prepare(
    "SELECT id, github_readme_token FROM users WHERE github_readme_token IS NOT NULL AND github_readme_token != ''",
  ).all<{ id: string; github_readme_token: string }>();
  let userPatsEncrypted = 0;
  for (const row of userPats.results) {
    if (isEncryptedSecret(row.github_readme_token)) continue;
    const ct = await encryptSecret(c.env, row.github_readme_token);
    await c.env.DB.prepare(
      "UPDATE users SET github_readme_token = ? WHERE id = ?",
    )
      .bind(ct, row.id)
      .run();
    userPatsEncrypted++;
  }

  // ── site_config sensitive keys ──────────────────────────────────────────
  const cfg = await getConfig(c.env.DB);
  const cfgBag = configBag(cfg);
  const cfgUpdates: Partial<Record<string, unknown>> = {};
  for (const key of SENSITIVE_CONFIG_KEYS) {
    const v = cfgBag[key];
    if (typeof v !== "string" || v === "" || isEncryptedSecret(v)) continue;
    cfgUpdates[key] = await encryptSecret(c.env, v);
  }
  if (Object.keys(cfgUpdates).length > 0) {
    await setConfigValues(c.env.DB, cfgUpdates);
  }

  auditAdmin(c, "admin.secrets.migrate", "secrets", null, {
    apps_encrypted: appsEncrypted,
    sources_encrypted: sourcesEncrypted,
    user_pats_encrypted: userPatsEncrypted,
    config_keys_encrypted: Object.keys(cfgUpdates),
  });

  const after = await collectSecretsStatus(c.env);
  return c.json({
    encrypted: {
      oauth_apps: appsEncrypted,
      oauth_sources: sourcesEncrypted,
      user_github_pats: userPatsEncrypted,
      config_keys: Object.keys(cfgUpdates),
    },
    before,
    after,
  });
});

async function collectSecretsStatus(env: Env): Promise<SecretsMigrateStatus> {
  const [appsRow, appsPlain, sourcesRow, sourcesPlain, patsRow, patsPlain] =
    await Promise.all([
      env.DB.prepare(
        "SELECT COUNT(*) AS n FROM oauth_apps WHERE client_secret IS NOT NULL AND client_secret != ''",
      ).first<{ n: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM oauth_apps WHERE client_secret IS NOT NULL AND client_secret != '' AND substr(client_secret, 1, 10) != ?`,
      )
        .bind("__ENC_v1__")
        .first<{ n: number }>(),
      env.DB.prepare(
        "SELECT COUNT(*) AS n FROM oauth_sources WHERE client_secret IS NOT NULL AND client_secret != ''",
      ).first<{ n: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM oauth_sources WHERE client_secret IS NOT NULL AND client_secret != '' AND substr(client_secret, 1, 10) != ?`,
      )
        .bind("__ENC_v1__")
        .first<{ n: number }>(),
      env.DB.prepare(
        "SELECT COUNT(*) AS n FROM users WHERE github_readme_token IS NOT NULL AND github_readme_token != ''",
      ).first<{ n: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM users WHERE github_readme_token IS NOT NULL AND github_readme_token != '' AND substr(github_readme_token, 1, 10) != ?`,
      )
        .bind("__ENC_v1__")
        .first<{ n: number }>(),
    ]);

  // For site_config we just iterate the in-memory loaded config so we
  // don't have to enumerate keys server-side via a generic query.
  const cfg = await getConfig(env.DB);
  const cfgBag = configBag(cfg);
  let cfgTotal = 0;
  let cfgPlain = 0;
  for (const key of SENSITIVE_CONFIG_KEYS) {
    const v = cfgBag[key];
    if (typeof v !== "string" || v === "") continue;
    cfgTotal++;
    if (!isEncryptedSecret(v)) cfgPlain++;
  }

  return {
    binding_configured: isSecretsKeyConfigured(env),
    oauth_apps_total: appsRow?.n ?? 0,
    oauth_apps_plaintext: appsPlain?.n ?? 0,
    oauth_sources_total: sourcesRow?.n ?? 0,
    oauth_sources_plaintext: sourcesPlain?.n ?? 0,
    user_github_pats_total: patsRow?.n ?? 0,
    user_github_pats_plaintext: patsPlain?.n ?? 0,
    config_sensitive_total: cfgTotal,
    config_sensitive_plaintext: cfgPlain,
  };
}

// ─── D1 row-level secrets migration ──────────────────────────────────────────
//
// The first `/secrets/migrate` endpoint above only covers config-shaped
// secrets (oauth_apps.client_secret, oauth_sources.client_secret,
// site_config sensitive keys, users.github_readme_token). This second
// endpoint covers the bearer-style row data — PATs, OAuth tokens,
// OAuth codes, invite tokens, email-verify tokens, 2FA codes — which
// switch from plaintext to keyed-HMAC hash, plus the recoverable
// secrets (TOTP seeds, webhook signing secrets, social OAuth tokens)
// which switch to AES-GCM ciphertext.
//
// Idempotent: rows already in stored form are left alone. Safe to
// re-run after new plaintext rows accumulate (e.g. between deploys).

interface D1SecretsMigrateStatus {
  binding_configured: boolean;
  pat_total: number;
  pat_plaintext: number;
  oauth_tokens_total: number;
  oauth_tokens_access_plaintext: number;
  oauth_tokens_refresh_plaintext: number;
  oauth_codes_total: number;
  oauth_codes_plaintext: number;
  site_invites_total: number;
  site_invites_plaintext: number;
  team_invites_total: number;
  team_invites_plaintext: number;
  email_verify_users_total: number;
  email_verify_users_plaintext: number;
  user_emails_verify_total: number;
  user_emails_verify_plaintext: number;
  oauth_2fa_codes_total: number;
  oauth_2fa_codes_plaintext: number;
  totp_authenticators_total: number;
  totp_authenticators_plaintext: number;
  webhooks_total: number;
  webhooks_plaintext: number;
  app_webhooks_total: number;
  app_webhooks_plaintext: number;
  social_connections_access_total: number;
  social_connections_access_plaintext: number;
  social_connections_refresh_total: number;
  social_connections_refresh_plaintext: number;
}

const ENC = "__ENC_v1__";
const HASH = "__HASH_v1__";

async function countTotal(env: Env, sql: string): Promise<number> {
  return (await env.DB.prepare(sql).first<{ n: number }>())?.n ?? 0;
}

async function countPlaintextHashed(
  env: Env,
  table: string,
  col: string,
): Promise<{ total: number; plain: number }> {
  // Plaintext = NOT NULL AND NOT empty AND prefix is neither __HASH_v1__
  // nor __ENC_v1__. Tokens and codes never legitimately start with `__`,
  // so this prefix check is reliable.
  const total = await countTotal(
    env,
    `SELECT COUNT(*) AS n FROM ${table} WHERE ${col} IS NOT NULL AND ${col} != ''`,
  );
  const plain =
    (
      await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM ${table} WHERE ${col} IS NOT NULL AND ${col} != '' AND substr(${col}, 1, 11) != ? AND substr(${col}, 1, 10) != ?`,
      )
        .bind(HASH, ENC)
        .first<{ n: number }>()
    )?.n ?? 0;
  return { total, plain };
}

async function collectD1SecretsStatus(
  env: Env,
): Promise<D1SecretsMigrateStatus> {
  const [
    pat,
    otAccess,
    otRefresh,
    oc,
    si,
    ti,
    uVerifyTok,
    uVerifyCode,
    ueVerifyTok,
    ueVerifyCode,
    twoFa,
    totp,
    webhooks,
    appWebhooks,
    scAccess,
    scRefresh,
  ] = await Promise.all([
    countPlaintextHashed(env, "personal_access_tokens", "token"),
    countPlaintextHashed(env, "oauth_tokens", "access_token"),
    countPlaintextHashed(env, "oauth_tokens", "refresh_token"),
    countPlaintextHashed(env, "oauth_codes", "code"),
    countPlaintextHashed(env, "site_invites", "token"),
    countPlaintextHashed(env, "team_invites", "token"),
    countPlaintextHashed(env, "users", "email_verify_token"),
    countPlaintextHashed(env, "users", "email_verify_code"),
    countPlaintextHashed(env, "user_emails", "verify_token"),
    countPlaintextHashed(env, "user_emails", "verify_code"),
    countPlaintextHashed(env, "oauth_2fa_codes", "code"),
    countPlaintextHashed(env, "totp_authenticators", "secret"),
    countPlaintextHashed(env, "webhooks", "secret"),
    countPlaintextHashed(env, "app_webhooks", "secret"),
    countPlaintextHashed(env, "social_connections", "access_token"),
    countPlaintextHashed(env, "social_connections", "refresh_token"),
  ]);

  return {
    binding_configured: isSecretsKeyConfigured(env),
    pat_total: pat.total,
    pat_plaintext: pat.plain,
    oauth_tokens_total: otAccess.total,
    oauth_tokens_access_plaintext: otAccess.plain,
    oauth_tokens_refresh_plaintext: otRefresh.plain,
    oauth_codes_total: oc.total,
    oauth_codes_plaintext: oc.plain,
    site_invites_total: si.total,
    site_invites_plaintext: si.plain,
    team_invites_total: ti.total,
    team_invites_plaintext: ti.plain,
    email_verify_users_total: Math.max(uVerifyTok.total, uVerifyCode.total),
    email_verify_users_plaintext: uVerifyTok.plain + uVerifyCode.plain,
    user_emails_verify_total: Math.max(ueVerifyTok.total, ueVerifyCode.total),
    user_emails_verify_plaintext: ueVerifyTok.plain + ueVerifyCode.plain,
    oauth_2fa_codes_total: twoFa.total,
    oauth_2fa_codes_plaintext: twoFa.plain,
    totp_authenticators_total: totp.total,
    totp_authenticators_plaintext: totp.plain,
    webhooks_total: webhooks.total,
    webhooks_plaintext: webhooks.plain,
    app_webhooks_total: appWebhooks.total,
    app_webhooks_plaintext: appWebhooks.plain,
    social_connections_access_total: scAccess.total,
    social_connections_access_plaintext: scAccess.plain,
    social_connections_refresh_total: scRefresh.total,
    social_connections_refresh_plaintext: scRefresh.plain,
  };
}

app.get("/d1-secrets/status", async (c) => {
  return c.json(await collectD1SecretsStatus(c.env));
});

// Convert each plaintext column to its stored form (hash or ciphertext)
// using the SECRETS_KEY-backed helpers. Streams in batches so a single
// invocation doesn't exceed worker CPU limits on large tables.
async function migrateColumnHash(
  env: Env,
  table: string,
  pkCol: string,
  col: string,
): Promise<number> {
  let migrated = 0;
  // 200 rows per page keeps the worker well under CPU budget even when
  // every row needs an HMAC. Loop until we see a page with no rows
  // requiring conversion.
  while (true) {
    const { results } = await env.DB.prepare(
      `SELECT ${pkCol} AS pk, ${col} AS v FROM ${table}
         WHERE ${col} IS NOT NULL AND ${col} != ''
           AND substr(${col}, 1, 11) != ? AND substr(${col}, 1, 10) != ?
         LIMIT 200`,
    )
      .bind(HASH, ENC)
      .all<{ pk: string; v: string }>();
    if (results.length === 0) return migrated;
    for (const row of results) {
      const hashed = await hashSecret(env, row.v);
      if (!hashed || isHashedSecret(row.v)) continue;
      await env.DB.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${pkCol} = ?`)
        .bind(hashed, row.pk)
        .run();
      migrated++;
    }
  }
}

async function migrateColumnEncrypt(
  env: Env,
  table: string,
  pkCol: string,
  col: string,
): Promise<number> {
  let migrated = 0;
  while (true) {
    const { results } = await env.DB.prepare(
      `SELECT ${pkCol} AS pk, ${col} AS v FROM ${table}
         WHERE ${col} IS NOT NULL AND ${col} != ''
           AND substr(${col}, 1, 11) != ? AND substr(${col}, 1, 10) != ?
         LIMIT 200`,
    )
      .bind(HASH, ENC)
      .all<{ pk: string; v: string }>();
    if (results.length === 0) return migrated;
    for (const row of results) {
      const ct = await encryptSecret(env, row.v);
      if (!ct || isEncryptedSecret(row.v)) continue;
      await env.DB.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${pkCol} = ?`)
        .bind(ct, row.pk)
        .run();
      migrated++;
    }
  }
}

app.post("/d1-secrets/migrate", async (c) => {
  if (!isSecretsKeyConfigured(c.env)) {
    return c.json(
      {
        error: "secrets_key_missing",
      },
      400,
    );
  }

  // Smoke-test the binding before touching rows so a malformed
  // SECRETS_KEY doesn't half-migrate the database.
  try {
    await encryptSecret(c.env, "smoke-test");
    await hashSecret(c.env, "smoke-test");
  } catch (err) {
    return c.json(
      {
        error: "secrets_key_rejected",
        params: { detail: err instanceof Error ? err.message : String(err) },
      },
      400,
    );
  }

  const before = await collectD1SecretsStatus(c.env);

  // ── Hash-only columns (bearer-style verifiers) ──────────────────────────
  const patCount = await migrateColumnHash(
    c.env,
    "personal_access_tokens",
    "id",
    "token",
  );
  const oauthAccessCount = await migrateColumnHash(
    c.env,
    "oauth_tokens",
    "id",
    "access_token",
  );
  const oauthRefreshCount = await migrateColumnHash(
    c.env,
    "oauth_tokens",
    "id",
    "refresh_token",
  );
  // oauth_codes uses `code` as the natural primary key but the value
  // also IS the column we're rewriting, so we use rowid for the WHERE.
  const oauthCodesCount = await migrateColumnHash(
    c.env,
    "oauth_codes",
    "rowid",
    "code",
  );
  // Invite tokens remain plaintext so authorized managers can copy a link
  // after creation. Existing hashed invite rows remain valid but cannot be
  // recovered or copied.
  const siteInvitesCount = 0;
  const teamInvitesCount = 0;
  const usersTokenCount = await migrateColumnHash(
    c.env,
    "users",
    "id",
    "email_verify_token",
  );
  const usersCodeCount = await migrateColumnHash(
    c.env,
    "users",
    "id",
    "email_verify_code",
  );
  const userEmailsTokenCount = await migrateColumnHash(
    c.env,
    "user_emails",
    "id",
    "verify_token",
  );
  const userEmailsCodeCount = await migrateColumnHash(
    c.env,
    "user_emails",
    "id",
    "verify_code",
  );
  const twoFaCount = await migrateColumnHash(
    c.env,
    "oauth_2fa_codes",
    "rowid",
    "code",
  );

  // ── Encrypt-only columns (recoverable for outbound use) ─────────────────
  const totpCount = await migrateColumnEncrypt(
    c.env,
    "totp_authenticators",
    "id",
    "secret",
  );
  const webhooksCount = await migrateColumnEncrypt(
    c.env,
    "webhooks",
    "id",
    "secret",
  );
  const appWebhooksCount = await migrateColumnEncrypt(
    c.env,
    "app_webhooks",
    "id",
    "secret",
  );
  const scAccessCount = await migrateColumnEncrypt(
    c.env,
    "social_connections",
    "id",
    "access_token",
  );
  const scRefreshCount = await migrateColumnEncrypt(
    c.env,
    "social_connections",
    "id",
    "refresh_token",
  );

  auditAdmin(c, "admin.d1_secrets.migrate", "secrets", null, {
    pat: patCount,
    oauth_tokens_access: oauthAccessCount,
    oauth_tokens_refresh: oauthRefreshCount,
    oauth_codes: oauthCodesCount,
    site_invites: siteInvitesCount,
    team_invites: teamInvitesCount,
    users_email_verify_token: usersTokenCount,
    users_email_verify_code: usersCodeCount,
    user_emails_verify_token: userEmailsTokenCount,
    user_emails_verify_code: userEmailsCodeCount,
    oauth_2fa_codes: twoFaCount,
    totp_authenticators: totpCount,
    webhooks: webhooksCount,
    app_webhooks: appWebhooksCount,
    social_connections_access: scAccessCount,
    social_connections_refresh: scRefreshCount,
  });

  const after = await collectD1SecretsStatus(c.env);
  return c.json({
    migrated: {
      pat: patCount,
      oauth_tokens_access: oauthAccessCount,
      oauth_tokens_refresh: oauthRefreshCount,
      oauth_codes: oauthCodesCount,
      site_invites: siteInvitesCount,
      team_invites: teamInvitesCount,
      users_email_verify_token: usersTokenCount,
      users_email_verify_code: usersCodeCount,
      user_emails_verify_token: userEmailsTokenCount,
      user_emails_verify_code: userEmailsCodeCount,
      oauth_2fa_codes: twoFaCount,
      totp_authenticators: totpCount,
      webhooks: webhooksCount,
      app_webhooks: appWebhooksCount,
      social_connections_access: scAccessCount,
      social_connections_refresh: scRefreshCount,
    },
    before,
    after,
  });
});

export default app;
