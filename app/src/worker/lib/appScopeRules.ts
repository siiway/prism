// Owner rules on cross-app scopes: an app can list another app's scopes
// (`app:<client_id>:<scope>`) only if that app's owner_allow / owner_deny
// rules let the person setting them do so. Checked on every path that sets
// an app's allowed scopes: the dashboard, team apps and client registration.

import type { CodedError } from "./apiError";
import { parseAppScope } from "./scopes";

/** Check access rules for target app before adding an app:* scope to allowed_scopes.
 *  Returns null if allowed, or the error if denied. */
export async function checkOwnerScopeAccess(
  db: D1Database,
  targetClientId: string,
  requestingUserId: string,
): Promise<CodedError | null> {
  const targetApp = await db
    .prepare("SELECT id FROM oauth_apps WHERE client_id = ? AND is_active = 1")
    .bind(targetClientId)
    .first<{ id: string }>();
  if (!targetApp)
    return {
      error: "app_scope_target_missing",
      params: { client_id: targetClientId },
    };

  const rules = await db
    .prepare(
      "SELECT rule_type, target_id FROM app_scope_access_rules WHERE app_id = ? AND rule_type IN ('owner_allow','owner_deny')",
    )
    .bind(targetApp.id)
    .all<{ rule_type: string; target_id: string }>();

  const allowList = rules.results
    .filter((r) => r.rule_type === "owner_allow")
    .map((r) => r.target_id);
  const denyList = rules.results
    .filter((r) => r.rule_type === "owner_deny")
    .map((r) => r.target_id);

  if (denyList.includes(requestingUserId)) return { error: "app_scope_denied" };
  if (allowList.length > 0 && !allowList.includes(requestingUserId))
    return { error: "app_scope_not_allowed" };

  return null;
}

/** The owner rules for the app:* scopes in `scopes` that aren't already in
 *  `existing`, checked for `userId`. Returns the first refusal, or null. */
export async function checkAppScopeOwnerRules(
  db: D1Database,
  scopes: string[],
  existing: string[],
  userId: string,
): Promise<CodedError | null> {
  const checked = new Set<string>();
  for (const s of scopes) {
    if (!s.startsWith("app:") || existing.includes(s)) continue;
    const parsed = parseAppScope(s);
    if (!parsed || checked.has(parsed.clientId)) continue;
    checked.add(parsed.clientId);
    const err = await checkOwnerScopeAccess(db, parsed.clientId, userId);
    if (err) return err;
  }
  return null;
}
