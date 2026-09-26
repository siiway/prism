// AgeKey start + completion.
//
// Start returns the AgeKey redirect URL. AgeKey sends the id_token back in
// the URL fragment (so it never hits a server log). The signed-in page at
// /agekey/callback posts that fragment here. The session cookie rides along
// because the POST is same-site, and the result is stored only when that
// session is the user who started the flow.

import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { getConfigValue } from "../lib/config";
import { recordAudit, auditRequestMeta } from "../lib/audit";
import {
  getUserSecurityState,
  teamsBlockingDowngrade,
} from "../lib/teamRequirements";
import {
  AGEKEY_USE_CLAIMS_JSON,
  AgeKeyVerifyError,
  agekeyCallbackUrl,
  agekeyEndpoints,
  beginAgeKeyFlow,
  buildAgeKeyAuthorizationUrl,
  consumeAgeKeyFlow,
  deleteAgeVerification,
  fetchAgeKeyJwks,
  newAgeKeyFlowSecrets,
  normalizeAgeKeyClientId,
  upsertAgeVerification,
  verifyAgeKeyToken,
  type VerifiedAgeKey,
} from "../lib/agekey";
import type { Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

async function verifyWithJwksRefresh(input: {
  token: string;
  clientId: string;
  nonce: string;
  claimsJson: string;
  now: number;
}): Promise<VerifiedAgeKey> {
  const jwksUrl = agekeyEndpoints(input.clientId).jwks;
  const attempt = (jwks: Awaited<ReturnType<typeof fetchAgeKeyJwks>>) =>
    verifyAgeKeyToken({ ...input, jwks });
  try {
    return await attempt(await fetchAgeKeyJwks(jwksUrl));
  } catch (err) {
    if (!(err instanceof AgeKeyVerifyError) || err.reason !== "unknown_kid")
      throw err;
    return await attempt(await fetchAgeKeyJwks(jwksUrl, true));
  }
}

app.post("/start", requireAuth, async (c) => {
  const configured = await getConfigValue(c.env.DB, "agekey_client_id");
  const clientId = normalizeAgeKeyClientId(
    typeof configured === "string" ? configured : "",
  );
  if (!clientId) return c.json({ error: "AgeKey is not configured" }, 400);

  const body = await c.req
    .json<{ language?: string; theme?: string }>()
    .catch(() => ({}) as { language?: string; theme?: string });

  const user = c.get("user");
  const now = Math.floor(Date.now() / 1000);
  const { state, nonce } = newAgeKeyFlowSecrets();
  await beginAgeKeyFlow(c.env.DB, {
    state,
    userId: user.id,
    nonce,
    claimsJson: AGEKEY_USE_CLAIMS_JSON,
    clientId,
    now,
  });

  const url = buildAgeKeyAuthorizationUrl({
    clientId,
    redirectUri: agekeyCallbackUrl(c.env.APP_URL),
    state,
    nonce,
    language: body.language,
    theme: body.theme,
  });
  return c.json({ url });
});

app.delete("/", requireAuth, async (c) => {
  const user = c.get("user");
  const state = await getUserSecurityState(c.env.DB, user.id);
  const blocking = (
    await teamsBlockingDowngrade(c.env.DB, user.id, {
      ...state,
      age_thresholds: {},
    })
  ).filter((team) => team.missing.includes("age"));
  if (blocking.length) {
    const names = blocking.map((team) => team.name).join(", ");
    return c.json(
      {
        error: `A team you belong to still requires this age check: ${names}`,
        teams: blocking,
      },
      409,
    );
  }
  await deleteAgeVerification(c.env.DB, user.id);
  void recordAudit(c.env, c.executionCtx, {
    scope: "user",
    scopeId: user.id,
    action: "user.age.clear",
    actorId: user.id,
    actorName: user.username,
    resourceType: "age_verification",
    resourceId: user.id,
    ...auditRequestMeta(c),
  });
  return c.json({ message: "Age verification removed" });
});

app.post("/complete", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req
    .json<{
      state?: string;
      id_token?: string;
      error?: string;
      create_requested?: string;
    }>()
    .catch(() => ({}) as {
      state?: string;
      id_token?: string;
      error?: string;
      create_requested?: string;
    });
  const now = Math.floor(Date.now() / 1000);
  const flow = body.state
    ? await consumeAgeKeyFlow(c.env.DB, body.state, now)
    : null;
  if (!flow || flow.userId !== user.id) return c.json({ result: "invalid" });

  if (body.error === "access_denied") return c.json({ result: "denied" });
  if (body.error) return c.json({ result: "invalid" });
  if (body.create_requested === "true")
    return c.json({ result: "create_requested" });
  if (!body.id_token) return c.json({ result: "invalid" });

  let verified: VerifiedAgeKey;
  try {
    verified = await verifyWithJwksRefresh({
      token: body.id_token,
      clientId: flow.clientId,
      nonce: flow.nonce,
      claimsJson: flow.claimsJson,
      now,
    });
  } catch {
    return c.json({ result: "invalid" });
  }

  const security = await getUserSecurityState(c.env.DB, user.id);
  const blocking = (
    await teamsBlockingDowngrade(c.env.DB, user.id, {
      ...security,
      age_thresholds: verified.thresholds,
    })
  ).filter((team) => team.missing.includes("age"));
  if (blocking.length) return c.json({ result: "downgrade" });

  await upsertAgeVerification(
    c.env.DB,
    user.id,
    verified.sessionId,
    verified.thresholds,
    now,
  );
  void recordAudit(c.env, c.executionCtx, {
    scope: "user",
    scopeId: user.id,
    action: "user.age.verify",
    actorId: user.id,
    actorName: user.username,
    resourceType: "age_verification",
    resourceId: user.id,
    metadata: {
      session_id: verified.sessionId,
      thresholds: verified.thresholds,
    },
    ...auditRequestMeta(c),
  });
  return c.json({ result: "ok" });
});

export default app;
