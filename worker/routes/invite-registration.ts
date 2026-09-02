// Team-invite registration — a second way onto the instance.
//
// A team the site admin has authorised can hand out invite links that create
// accounts rather than only admitting existing ones. Accounts minted here are
// restricted (see worker/lib/userCapabilities.ts).
//
// The flow is deliberately two-phase:
//
//   POST /api/auth/register-with-invite   → account exists, pending
//   ...user satisfies the team's join requirements inside Prism...
//   POST /api/auth/invite-join/complete   → membership row written
//
// It cannot be one-phase. Every endpoint that satisfies a requirement
// (`/auth/totp/setup`, `/auth/email-verify-code`, …) sits behind requireAuth,
// so the account has to exist before its requirements can be met. That is
// also how the ordinary flow already behaves whenever the site requires email
// verification, so pending accounts are not a new risk class — and with
// default-deny capabilities they can do strictly less than an ordinary
// unverified account.

import { Hono } from "hono";
import { randomId } from "../lib/crypto";
import { hashPassword } from "../lib/crypto";
import { hashLookupCandidate } from "../lib/secretCrypto";
import { requireAuth } from "../middleware/auth";
import { getConfig, getConfigValue } from "../lib/config";
import { turnstileEndpointFor, type TurnstileVariant } from "../lib/turnstile";
import { getIp } from "../lib/clientIp";
import { rateLimitIp } from "../middleware/rateLimit";
import { verifyCaptchaToken } from "../middleware/captcha";
import { proxyImageUrl } from "../lib/proxyImage";
import { recordAudit, auditRequestMeta } from "../lib/audit";
import {
  getSiteRequirementFloor,
  getUserSecurityState,
  mergeWithSiteFloor,
  unmetRequirements,
  type EffectiveTeamRequirements,
} from "../lib/teamRequirements";
import {
  parseInviteRegistrationExemptions,
  syntheticEmail,
} from "../lib/userCapabilities";
import type { TeamRow, UserRow, Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

/**
 * Load a team that is currently able to mint accounts, or null.
 *
 * Both doors must be open: the site master switch, and this team's own
 * grant plus its owner's switch. A team mid-dissolution is excluded — the
 * accounts it holds are already being wound down.
 */
async function loadRegistrationTeam(
  db: D1Database,
  teamId: string,
): Promise<TeamRow | null> {
  const enabled = await getConfigValue(db, "enable_team_invite_registration");
  if (!enabled) return null;
  const team = await db
    .prepare("SELECT * FROM teams WHERE id = ?")
    .bind(teamId)
    .first<TeamRow>();
  if (!team) return null;
  if (team.invite_registration_granted !== 1) return null;
  if (team.invite_registration_enabled !== 1) return null;
  if (team.dissolving_at !== null) return null;
  return team;
}

interface InviteRow {
  token: string;
  team_id: string;
  role: string;
  email: string | null;
  max_uses: number;
  uses: number;
  expires_at: number;
  allows_registration: number;
}

/** Resolve an invite token in either raw or hashed-lookup form, mirroring
 *  how the existing team-join path looks invites up. */
async function findInvite(env: Env, token: string): Promise<InviteRow | null> {
  const lookup = await hashLookupCandidate(env, token);
  return env.DB.prepare(
    "SELECT * FROM team_invites WHERE token = ? OR token = ?",
  )
    .bind(token, lookup ?? token)
    .first<InviteRow>();
}

/**
 * The requirements a registrant must satisfy, after applying whatever the
 * site admin exempted for this team.
 *
 * Exemptions cover only email verification — the one check whose cost scales
 * linearly with registrations. Captcha, proof-of-work and every rate limit
 * are unexemptible and are enforced unconditionally below.
 */
async function effectiveRequirements(
  db: D1Database,
  team: TeamRow,
): Promise<EffectiveTeamRequirements> {
  const floor = await getSiteRequirementFloor(db);
  const merged = mergeWithSiteFloor(
    {
      require_2fa: team.require_2fa,
      require_verified_email: team.require_verified_email,
    },
    floor,
  );
  const exemptions = parseInviteRegistrationExemptions(
    team.invite_registration_exemptions,
  );
  if (!exemptions.email_verification) return merged;
  // An exemption overrides the site floor as well as the team's own flag —
  // that is precisely what a site admin is granting when they set it, since
  // the floor would otherwise reinstate the mail send they wanted to avoid.
  return {
    ...merged,
    require_verified_email: false,
    forced_by_site: { ...merged.forced_by_site, require_verified_email: false },
  };
}

// ─── Public: the standalone registration page's data ─────────────────────────

// GET /api/join/:teamId — everything the standalone page needs to render.
// Unauthenticated by design: this is the entry point for people who have no
// account yet. A team that is not currently accepting registrations 404s
// rather than revealing that it exists but is closed.
app.get("/join/:teamId", async (c) => {
  const teamId = c.req.param("teamId");
  const team = await loadRegistrationTeam(c.env.DB, teamId);
  if (!team) return c.json({ error: "Not found" }, 404);

  const requirements = await effectiveRequirements(c.env.DB, team);
  const config = await getConfig(c.env.DB);
  const exemptions = parseInviteRegistrationExemptions(
    team.invite_registration_exemptions,
  );

  const turnstile = await turnstileEndpointFor(c, config);

  return c.json({
    team: {
      id: team.id,
      name: team.name,
      description: team.description,
      avatar_url: await proxyImageUrl(c.env.APP_URL, c.env.DB, team.avatar_url),
    },
    requirements,
    // Whether the registrant will be asked for an address at all. When the
    // site's verification requirement is exempted we skip collecting one
    // entirely and synthesise a placeholder — an unverified real address
    // would let a typo permanently lock its true owner out of the instance,
    // since users.email is UNIQUE.
    collects_email: !exemptions.email_verification,
    captcha_provider: config.captcha_provider,
    captcha_site_key: config.captcha_site_key,
    turnstile_endpoint: turnstile.directive,
    turnstile_china_site_key: turnstile.chinaSiteKey,
    pow_difficulty: config.pow_difficulty,
    // Surfaced so the page can state it plainly before anyone signs up:
    // dissolving this team deletes the accounts it created.
    deletion_notice: true,
  });
});

// ─── Register ────────────────────────────────────────────────────────────────

app.post("/auth/register-with-invite", async (c) => {
  const ip = getIp(c);
  const config = await getConfig(c.env.DB);

  // Unexemptible defence #1: per-IP throttle, same budget as ordinary
  // registration.
  const rl = await rateLimitIp(
    c.env.DB,
    ip,
    "register",
    5,
    300,
    config.ipv6_rate_limit_prefix,
  );
  if (!rl.allowed) return c.json({ error: "Too many requests" }, 429);

  const body = await c.req.json<{
    team_id?: string;
    invite_token?: string;
    username?: string;
    password?: string;
    display_name?: string;
    email?: string;
    captcha_token?: string;
    captcha_variant?: TurnstileVariant;
    pow_challenge?: string;
    pow_nonce?: number;
  }>();

  const team = body.team_id
    ? await loadRegistrationTeam(c.env.DB, body.team_id)
    : null;
  if (!team) return c.json({ error: "Not found" }, 404);

  // Unexemptible defence #2: captcha / proof-of-work. Explicitly never
  // exemptible — the whole point of the exemption mechanism is to cut
  // outbound email, not to weaken bot resistance.
  const captchaOk = await verifyCaptchaToken(
    c.env.DB,
    body.captcha_token,
    body.pow_challenge,
    body.pow_nonce,
    ip,
    c.env,
    body.captcha_variant,
  );
  if (!captchaOk.success)
    return c.json({ error: captchaOk.error ?? "Captcha failed" }, 400);

  if (!body.invite_token)
    return c.json({ error: "invite_token is required" }, 400);
  if (!body.username || !body.password)
    return c.json({ error: "username and password are required" }, 400);
  if (body.password.length < 8)
    return c.json({ error: "Password must be at least 8 characters" }, 400);
  if (!/^[a-z0-9_.-]{2,32}$/i.test(body.username))
    return c.json(
      { error: "Username must be 2-32 alphanumeric characters" },
      400,
    );

  const invite = await findInvite(c.env, body.invite_token);
  const now = Math.floor(Date.now() / 1000);
  if (
    !invite ||
    invite.team_id !== team.id ||
    invite.allows_registration !== 1 ||
    invite.expires_at <= now
  )
    return c.json({ error: "Invalid or expired invite" }, 403);

  // Unexemptible defence #3: per-invite throttle. Per-IP limiting does
  // nothing against a link shared to thousands of people, each registering
  // once from their own address — this is what bounds the burst.
  const perHour = await getConfigValue(
    c.env.DB,
    "team_invite_registration_rate_per_hour",
  );
  const inviteRl = await rateLimitIp(
    c.env.DB,
    invite.token,
    "invite-register",
    perHour,
    3600,
    config.ipv6_rate_limit_prefix,
  );
  if (!inviteRl.allowed)
    return c.json(
      { error: "This invite is being used too quickly. Try again later." },
      429,
    );

  const exemptions = parseInviteRegistrationExemptions(
    team.invite_registration_exemptions,
  );
  const collectsEmail = !exemptions.email_verification;

  let email: string;
  if (collectsEmail) {
    if (!body.email) return c.json({ error: "email is required" }, 400);
    email = body.email.toLowerCase().trim();
    if (invite.email && invite.email.toLowerCase() !== email)
      return c.json({ error: "This invite is for a different email" }, 403);
  } else {
    // Placeholder for now; rewritten below once the id exists. The holder can
    // bind a real address whenever they like, and must before converting.
    email = "";
  }

  const userId = randomId();
  if (!collectsEmail) email = syntheticEmail(userId);

  // Unexemptible defence #4, and the only *hard* bound on total volume:
  // claim a seat atomically. Reading the count and then inserting would let
  // a hundred concurrent requests all observe the same free seat.
  //
  // The seat is spent here rather than at join time. A registrant who
  // abandons the flow burns one — accepted, because deferring the claim to
  // completion would leave this check racy again, and would also strand
  // people who enrolled 2FA only to be told the invite had filled up.
  const claim = await c.env.DB.prepare(
    `UPDATE team_invites
        SET uses = uses + 1
      WHERE token = ?
        AND allows_registration = 1
        AND expires_at > ?
        AND max_uses > 0
        AND uses < max_uses`,
  )
    .bind(invite.token, now)
    .run();
  if (!claim.meta.changes)
    return c.json({ error: "This invite has reached its limit" }, 403);

  const passwordHash = await hashPassword(body.password);
  try {
    await c.env.DB.prepare(
      `INSERT INTO users
         (id, email, username, password_hash, display_name, role, kind,
          email_verified, is_active, origin_team_id, origin_invite_token,
          origin_join_completed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'user', 'user', 0, 1, ?, ?, 0, ?, ?)`,
    )
      .bind(
        userId,
        email,
        body.username.toLowerCase().trim(),
        passwordHash,
        body.display_name ?? body.username,
        team.id,
        invite.token,
        now,
        now,
      )
      .run();
  } catch (err) {
    // Hand the seat back — the account that would have used it never existed.
    await c.env.DB.prepare(
      "UPDATE team_invites SET uses = uses - 1 WHERE token = ? AND uses > 0",
    )
      .bind(invite.token)
      .run()
      .catch(() => {});
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("UNIQUE"))
      return c.json({ error: "Email or username already taken" }, 409);
    throw err;
  }

  void recordAudit(c.env, c.executionCtx, {
    scope: "team",
    scopeId: team.id,
    action: "team.member.invite_register",
    actorId: userId,
    actorName: body.username,
    resourceType: "user",
    resourceId: userId,
    metadata: { pending: true },
    ...auditRequestMeta(c),
  });

  const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(userId)
    .first<UserRow>();
  if (!user) return c.json({ error: "User not found after creation" }, 500);

  const { issueSession, safeUser } = await import("./auth");
  const ttl = config.session_ttl_days * 24 * 60 * 60;
  await issueSession(c, user, ttl, ["pwd"]);

  const requirements = await effectiveRequirements(c.env.DB, team);
  return c.json(
    {
      // Same safe profile shape ordinary registration returns.
      user: await safeUser(c.env.APP_URL, c.env.DB, user),
      pending: true,
      requirements,
      synthetic_email: !collectsEmail,
    },
    201,
  );
});

// ─── Completion ──────────────────────────────────────────────────────────────

/** Shared: what is this pending account still missing? */
async function pendingStatus(
  env: Env,
  user: UserRow,
): Promise<
  | { ok: false; status: 400 | 404 | 409; error: string }
  | {
      ok: true;
      team: TeamRow;
      unmet: string[];
      requirements: EffectiveTeamRequirements;
    }
> {
  if (!user.origin_team_id)
    return {
      ok: false,
      status: 400,
      error: "Not an invite-registered account",
    };
  if (user.origin_join_completed === 1)
    return { ok: false, status: 409, error: "Already joined" };

  const team = await env.DB.prepare("SELECT * FROM teams WHERE id = ?")
    .bind(user.origin_team_id)
    .first<TeamRow>();
  if (!team) return { ok: false, status: 404, error: "Team no longer exists" };
  if (team.dissolving_at !== null)
    return { ok: false, status: 409, error: "This team is being dissolved" };

  // Read requirements now rather than trusting a snapshot from registration
  // time — the owner may have turned one on while this account was pending.
  const requirements = await effectiveRequirements(env.DB, team);
  const state = await getUserSecurityState(env.DB, user.id);
  // Pass the already-merged form so unmetRequirements does not re-apply the
  // site floor and undo the exemption.
  const unmet = unmetRequirements(requirements, state);
  return { ok: true, team, unmet, requirements };
}

app.get("/auth/invite-join/status", requireAuth, async (c) => {
  const authed = c.get("user");
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(authed.id)
    .first<UserRow>();
  if (!user) return c.json({ error: "Not found" }, 404);

  const status = await pendingStatus(c.env, user);
  if (!status.ok) return c.json({ error: status.error }, status.status);

  return c.json({
    team: {
      id: status.team.id,
      name: status.team.name,
      avatar_url: await proxyImageUrl(
        c.env.APP_URL,
        c.env.DB,
        status.team.avatar_url,
      ),
    },
    requirements: status.requirements,
    unmet: status.unmet,
    synthetic_email: user.email.endsWith("@users.invalid"),
  });
});

app.post("/auth/invite-join/complete", requireAuth, async (c) => {
  const authed = c.get("user");
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(authed.id)
    .first<UserRow>();
  if (!user) return c.json({ error: "Not found" }, 404);

  const status = await pendingStatus(c.env, user);
  if (!status.ok) return c.json({ error: status.error }, status.status);
  if (status.unmet.length)
    return c.json(
      {
        error: "Requirements not yet satisfied",
        unmet_requirements: status.unmet,
      },
      403,
    );

  const now = Math.floor(Date.now() / 1000);
  // Invites can only ever admit members here — a stranger arriving through a
  // link should never land straight into a role that can manage the team.
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT OR IGNORE INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)",
    ).bind(status.team.id, user.id, now),
    c.env.DB.prepare(
      "UPDATE users SET origin_join_completed = 1, updated_at = ? WHERE id = ?",
    ).bind(now, user.id),
  ]);

  void recordAudit(c.env, c.executionCtx, {
    scope: "team",
    scopeId: status.team.id,
    action: "team.member.add",
    actorId: user.id,
    actorName: user.username,
    resourceType: "user",
    resourceId: user.id,
    resourceName: `@${user.username}`,
    metadata: { role: "member", via: "invite_registration" },
    ...auditRequestMeta(c),
  });

  return c.json({ message: "Joined", team_id: status.team.id });
});

export default app;
