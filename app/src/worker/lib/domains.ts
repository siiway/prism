// Domain records: the rows behind personal and team domains, and the steps
// shared by every place that adds, verifies, copies or re-verifies one.

import type { Context } from "hono";
import type { CodedError } from "./apiError";
import { getConfigValue } from "./config";
import {
  checkMethod,
  isVerificationMethod,
  methodInstructions,
  tryAnyMethod,
  type MethodInstructions,
  type VerificationMethod,
} from "./domainOwnership";
import { randomBase64url, randomId } from "./crypto";
import { getTeamAncestors } from "./teams";
import type { DomainRow } from "../types";

const DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

/**
 * Normalize a user-entered domain: tolerate a pasted URL
 * ("https://Example.COM/path" → "example.com"), stray path segments,
 * surrounding whitespace, uppercase, and a trailing DNS-root dot.
 */
function normalizeDomainInput(raw: string): string {
  let domain = raw.trim().toLowerCase();
  if (domain.includes("://")) {
    try {
      domain = new URL(domain).hostname;
    } catch {
      /* not a parseable URL — fall through with the raw value */
    }
  } else {
    // Strip any path/query the user pasted alongside the bare host
    domain = domain.split(/[/?#]/)[0];
  }
  return domain.replace(/\.+$/, "");
}

/** The normalized domain, or null when the input isn't a domain name. */
export function parseDomainInput(raw: string): string | null {
  const domain = normalizeDomainInput(raw);
  return DOMAIN_REGEX.test(domain) ? domain : null;
}

/** "a.b.example.com" → ["b.example.com", "example.com"]; never the bare TLD. */
function parentDomains(domain: string): string[] {
  const parts = domain.split(".");
  const out: string[] = [];
  for (let i = 1; i < parts.length - 1; i++) out.push(parts.slice(i).join("."));
  return out;
}

/** Who a domain row belongs to: a team, or a user's personal domains. */
export type DomainOwner = { teamId: string } | { userId: string };

export function domainOwner(row: Pick<DomainRow, "user_id" | "team_id">) {
  return row.team_id ? { teamId: row.team_id } : { userId: row.user_id };
}

/**
 * A verified parent of `domain` the owner already holds, which vouches for
 * it. A team also counts its ancestors' domains unless the
 * `inherit_team_domains` setting is off, matching the team domain list.
 */
export async function verifiedParentDomain(
  db: D1Database,
  owner: DomainOwner,
  domain: string,
): Promise<string | null> {
  let where: string;
  let args: string[];
  if ("teamId" in owner) {
    const teamIds = (await getConfigValue(db, "inherit_team_domains"))
      ? (await getTeamAncestors(db, owner.teamId)).map((a) => a.id)
      : [owner.teamId];
    if (!teamIds.length) return null;
    where = `team_id IN (${teamIds.map(() => "?").join(",")})`;
    args = teamIds;
  } else {
    where = "user_id = ? AND team_id IS NULL";
    args = [owner.userId];
  }
  for (const parent of parentDomains(domain)) {
    const row = await db
      .prepare(
        `SELECT domain FROM domains WHERE ${where} AND domain = ? AND verified = 1 LIMIT 1`,
      )
      .bind(...args, parent)
      .first<{ domain: string }>();
    if (row) return row.domain;
  }
  return null;
}

/** When a domain verified at `now` is next re-checked. */
export async function nextReverifyAt(
  db: D1Database,
  now: number,
): Promise<number> {
  const days = await getConfigValue(db, "domain_reverify_days");
  return now + days * 24 * 60 * 60;
}

/** Mark a domain verified, by `method` or (null) by a parent domain. */
async function markVerified(
  db: D1Database,
  id: string,
  method: VerificationMethod | null,
): Promise<{ verified_at: number; next_reverify_at: number }> {
  const now = Math.floor(Date.now() / 1000);
  const next = await nextReverifyAt(db, now);
  await db
    .prepare(
      "UPDATE domains SET verified = 1, verified_at = ?, next_reverify_at = ?, verification_method = ? WHERE id = ?",
    )
    .bind(now, next, method, id)
    .run();
  return { verified_at: now, next_reverify_at: next };
}

export type CreatedDomain = {
  id: string;
  domain: string;
  verification_token: string;
  verified: boolean;
  verified_by_parent?: string;
} & MethodInstructions;

/**
 * Add a domain the user typed in: normalize it, refuse one the owner already
 * has, then insert it as createDomain does.
 */
export async function addDomain(
  db: D1Database,
  input: {
    userId: string;
    teamId: string | null;
    domain: unknown;
    appId?: string | null;
  },
): Promise<
  | { ok: true; created: CreatedDomain }
  | { ok: false; status: 400 | 409; body: CodedError }
> {
  if (!input.domain)
    return {
      ok: false,
      status: 400,
      body: { error: "field_required", params: { field: "domain" } },
    };
  const domain =
    typeof input.domain === "string" ? parseDomainInput(input.domain) : null;
  if (!domain)
    return { ok: false, status: 400, body: { error: "domain_invalid" } };

  const existing = await (
    input.teamId
      ? db
          .prepare("SELECT id FROM domains WHERE team_id = ? AND domain = ?")
          .bind(input.teamId, domain)
      : db
          .prepare(
            "SELECT id FROM domains WHERE user_id = ? AND domain = ? AND team_id IS NULL",
          )
          .bind(input.userId, domain)
  ).first();
  if (existing)
    return { ok: false, status: 409, body: { error: "domain_exists" } };

  return { ok: true, created: await createDomain(db, { ...input, domain }) };
}

/**
 * Insert a domain for `owner`, added by `userId`. It is verified on the spot
 * when the owner already holds a verified parent domain.
 */
export async function createDomain(
  db: D1Database,
  input: {
    userId: string;
    teamId: string | null;
    domain: string;
    appId?: string | null;
  },
): Promise<CreatedDomain> {
  const { userId, teamId, domain } = input;
  const id = randomId();
  const token = randomBase64url(24);
  await db
    .prepare(
      "INSERT INTO domains (id, user_id, created_by, team_id, app_id, domain, verification_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id,
      userId,
      userId,
      teamId,
      input.appId ?? null,
      domain,
      token,
      Math.floor(Date.now() / 1000),
    )
    .run();

  const created: CreatedDomain = {
    id,
    domain,
    verification_token: token,
    ...methodInstructions(domain, token),
    verified: false,
  };
  const owner = teamId ? { teamId } : { userId };
  const parent = await verifiedParentDomain(db, owner, domain);
  if (parent) {
    await markVerified(db, id, null);
    created.verified = true;
    created.verified_by_parent = parent;
  }
  return created;
}

/**
 * Copy a domain to another owner, keeping its verification state. The copy
 * gets its own token, so the two rows re-verify independently.
 */
export async function copyDomain(
  db: D1Database,
  row: DomainRow,
  to: { userId: string; teamId: string | null },
): Promise<{ id: string; domain: string; verified: boolean }> {
  const id = randomId();
  await db
    .prepare(
      `INSERT INTO domains
        (id, user_id, created_by, team_id, domain, verification_token,
         verified, verified_at, next_reverify_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      to.userId,
      to.userId,
      to.teamId,
      row.domain,
      randomBase64url(24),
      row.verified,
      row.verified_at ?? null,
      row.next_reverify_at ?? null,
      Math.floor(Date.now() / 1000),
    )
    .run();
  return { id, domain: row.domain, verified: !!row.verified };
}

/**
 * The method named in a verify request's optional `{ method }` body: null to
 * try every method, or "invalid" for a value that isn't one.
 */
export async function readRequestedMethod(
  c: Context,
): Promise<VerificationMethod | null | "invalid"> {
  const body: unknown = await c.req.json().catch(() => ({}));
  const method =
    body && typeof body === "object"
      ? (body as { method?: unknown }).method
      : undefined;
  if (method === undefined) return null;
  return isVerificationMethod(method) ? method : "invalid";
}

export type VerifyOutcome =
  | {
      verified: true;
      verified_at: number;
      next_reverify_at: number;
      verified_by_parent: string;
    }
  | {
      verified: true;
      verified_at: number;
      next_reverify_at: number;
      verification_method: VerificationMethod;
    }
  | {
      verified: false;
      attempted_method: VerificationMethod | null;
      instructions: MethodInstructions;
    };

/**
 * Try to verify a domain: through a verified parent the owner holds, else by
 * `method`, else (null) by whichever method passes first.
 */
export async function verifyDomain(
  db: D1Database,
  row: DomainRow,
  method: VerificationMethod | null,
): Promise<VerifyOutcome> {
  const parent = await verifiedParentDomain(db, domainOwner(row), row.domain);
  if (parent) {
    return {
      verified: true,
      ...(await markVerified(db, row.id, null)),
      verified_by_parent: parent,
    };
  }

  const passed = method
    ? (await checkMethod(method, row.domain, row.verification_token))
      ? method
      : null
    : await tryAnyMethod(row.domain, row.verification_token);
  if (passed) {
    return {
      verified: true,
      ...(await markVerified(db, row.id, passed)),
      verification_method: passed,
    };
  }
  return {
    verified: false,
    attempted_method: method,
    instructions: methodInstructions(row.domain, row.verification_token),
  };
}
