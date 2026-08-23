// Catalog of audit event types / events for the webhook "pick events" popup,
// plus helpers to parse an event-filter string into a selection and back.
//
// A filter string is a comma-separated list of tokens, each one of:
//   *              — every event (including future / unknown ones)
//   <type>.*       — every event under a type (fnmatch, e.g. app.* )
//   <type>.<event> — a single event (e.g. app.create, team.member.add)

export type AuditScopeKey = "user" | "team" | "platform";

// type → list of event names (names may themselves contain dots).
export const AUDIT_EVENT_CATALOG: Record<
  AuditScopeKey,
  Record<string, string[]>
> = {
  user: {
    user: ["login", "profile.update"],
    app: ["create", "update", "delete", "authorized"],
    oauth: ["authorize", "revoke"],
    domain: ["add", "verify", "delete"],
    webhook: ["create", "update", "delete"],
    // Written into the user's own scope when a site administrator acts on
    // the account — the events an account holder most wants pushed at them.
    admin: [
      "user.password_set",
      "user.2fa_reset",
      "user.totp_removed",
      "user.passkey_removed",
      "user.token_revoked",
      "user.connection_removed",
      "user.gpg_key_removed",
      "user.email_verified",
      "user.primary_email_changed",
      "user.email_removed",
      "user.domain_removed",
      "user.authorization_revoked",
    ],
  },
  team: {
    team: [
      "create",
      "update",
      "delete",
      "member.add",
      "member.role_change",
      "member.leave",
      "member.remove",
      "ownership.transfer",
    ],
    app: ["create", "update", "delete", "authorized"],
    domain: ["add", "verify", "delete"],
    webhook: ["create", "update", "delete"],
  },
  platform: {
    admin: [
      "app.update",
      "config.update",
      "user.update",
      "user.delete",
      "team.delete",
      "image_proxy.delete",
      "sweep_image_proxy",
      "migrate_image_proxy",
      "migrate_teams_as_users",
      "secrets.migrate",
      "db.query.read",
      "db.query.write",
      "db.query.error",
      "db.row.insert",
      "db.row.update",
      "db.row.delete",
      "user.password_set",
      "user.2fa_reset",
      "user.totp_removed",
      "user.passkey_removed",
      "user.token_revoked",
      "user.connection_removed",
      "user.gpg_key_removed",
      "user.email_verified",
      "user.primary_email_changed",
      "user.email_removed",
      "user.domain_removed",
      "user.authorization_revoked",
      "user.converted",
      "user.notification_rulesets_cleared",
      "users.bulk_activate",
      "users.bulk_deactivate",
      "users.bulk_delete",
      "team_invite.revoke",
      "scope_grant.revoke",
      "session.revoke",
      "app.transfer",
      "domain.force_verify",
      "domain.unverify",
      "domain.delete",
      "revoke.all_sessions",
      "revoke.app",
      "revoke.user_grants",
      "maintenance.run",
      "maintenance.error",
      "notice.create",
      "notice.update",
      "notice.publish",
      "notice.unpublish",
      "notice.delete",
    ],
    invite: ["create", "revoke"],
    oauth_source: ["create", "update", "delete"],
    webhook: ["create", "update", "delete"],
  },
};

export function scopeKeyFromBase(base: string): AuditScopeKey {
  if (base === "platform") return "platform";
  if (base.startsWith("team")) return "team";
  return "user";
}

export interface EventSelection {
  all: boolean;
  // fully-qualified leaf keys, e.g. "app.create"
  leaves: Set<string>;
}

export type ParseResult =
  | { ok: true; selection: EventSelection }
  | { ok: false; reason: "format" | "unknown"; token: string };

const TYPE_TOKEN = /^[a-z_]+$/;

/** Parse a filter string into a checkbox selection, validating every token. */
export function parseEvents(raw: string, scope: AuditScopeKey): ParseResult {
  const catalog = AUDIT_EVENT_CATALOG[scope];
  const tokens = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const leaves = new Set<string>();
  let all = false;

  for (const token of tokens) {
    if (token === "*") {
      all = true;
      continue;
    }
    const dot = token.indexOf(".");
    if (dot <= 0) return { ok: false, reason: "format", token };
    const type = token.slice(0, dot);
    const event = token.slice(dot + 1);
    if (!TYPE_TOKEN.test(type) || !event)
      return { ok: false, reason: "format", token };
    if (!(type in catalog)) return { ok: false, reason: "unknown", token };
    if (event === "*") {
      for (const e of catalog[type]) leaves.add(`${type}.${e}`);
      continue;
    }
    if (!catalog[type].includes(event))
      return { ok: false, reason: "unknown", token };
    leaves.add(`${type}.${event}`);
  }

  return { ok: true, selection: { all, leaves } };
}

/** True when every event under `type` is present in the selection. */
export function isTypeFullySelected(
  selection: EventSelection,
  type: string,
  scope: AuditScopeKey,
): boolean {
  const events = AUDIT_EVENT_CATALOG[scope][type] ?? [];
  return (
    events.length > 0 &&
    events.every((e) => selection.leaves.has(`${type}.${e}`))
  );
}

/** True when some (but not necessarily all) events under `type` are selected. */
export function isTypePartiallySelected(
  selection: EventSelection,
  type: string,
  scope: AuditScopeKey,
): boolean {
  const events = AUDIT_EVENT_CATALOG[scope][type] ?? [];
  return events.some((e) => selection.leaves.has(`${type}.${e}`));
}

/** Collapse a selection back to the shortest set of filter tokens. */
export function selectionToEvents(
  selection: EventSelection,
  scope: AuditScopeKey,
): string[] {
  if (selection.all) return ["*"];
  const catalog = AUDIT_EVENT_CATALOG[scope];
  const out: string[] = [];
  for (const type of Object.keys(catalog)) {
    const events = catalog[type];
    const selected = events.filter((e) => selection.leaves.has(`${type}.${e}`));
    if (selected.length === 0) continue;
    if (selected.length === events.length) out.push(`${type}.*`);
    else for (const e of selected) out.push(`${type}.${e}`);
  }
  return out;
}

export function selectionToString(
  selection: EventSelection,
  scope: AuditScopeKey,
): string {
  return selectionToEvents(selection, scope).join(", ");
}
