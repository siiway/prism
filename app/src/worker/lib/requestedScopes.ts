// The scopes an app gets out of the ones it asks for: its own platform
// scopes, and other apps' permissions (app:<client_id>:<inner_scope>) with
// what the consent screen shows for them. OAuth's authorization requests
// and SAML sign-in both resolve scopes here.

import { proxyImageUrl } from "./proxyImage";
import {
  REQUESTABLE_SCOPES,
  UNBOUND_TEAM_SCOPES,
  parseAppScope,
} from "./scopes";

/** Another app's permission as the consent screen shows it. */
export interface ResolvedAppScope {
  scope: string;
  client_id: string;
  inner_scope: string;
  app_name: string;
  app_icon_url: string | null;
  scope_title: string | null;
  scope_desc: string | null;
}

/** Why a requested scope was filtered out of the consent screen. Surfaced
 *  back to the user so they can see what an app asked for vs what was granted. */
export type RejectedScopeReason =
  /** Not registered in the app's `allowed_scopes` whitelist. */
  | "not_allowed"
  /** Unknown / malformed scope (not a platform scope, team scope, or `app:*` form). */
  | "unknown"
  /** Cross-app `app:*` scope, but the target app's owner has explicitly denied
   *  this requesting app via `app_deny` or omitted it from an `app_allow` list. */
  | "app_denied"
  /** Cross-app `app:*` scope, but the target app no longer exists / is inactive. */
  | "target_missing";

/**
 * Resolves requested scopes against what the app is allowed to request.
 * Regular platform scopes are checked against REQUESTABLE_SCOPES.
 * App-delegation scopes (app:<client_id>:<inner_scope>) are accepted when:
 *   - the inner scope is non-empty (it may be a platform scope OR an
 *     app-defined identifier registered in app_scope_definitions, e.g.
 *     `read_posts`)
 *   - the full scope string is listed in the app's allowed_scopes
 *   - the referenced target app exists and is active (DB check)
 *   - the target app's access rules permit the requesting client
 * Returns the granted scopes (app scopes included), the app scopes again
 * with the target app name/icon for the consent UI, and what was refused.
 */
export async function resolveRequestedScopes(
  db: D1Database,
  appUrl: string,
  requestedScopes: string[],
  allowedScopes: string[],
  requestingClientId: string,
): Promise<{
  scopes: string[];
  appScopes: ResolvedAppScope[];
  rejected: Array<{ scope: string; reason: RejectedScopeReason }>;
}> {
  const regular: string[] = [];
  const appScopeRequests: string[] = [];
  const rejected: Array<{ scope: string; reason: RejectedScopeReason }> = [];

  for (const s of requestedScopes) {
    const parsed = parseAppScope(s);
    if (parsed) {
      // Cross-app scope: inner part may be a platform scope OR an app-defined
      // identifier (registered via app_scope_definitions). parseAppScope
      // already enforces non-empty clientId and non-empty innerScope.
      if (!allowedScopes.includes(s)) {
        rejected.push({ scope: s, reason: "not_allowed" });
      } else {
        appScopeRequests.push(s);
      }
      continue;
    }
    if (REQUESTABLE_SCOPES.has(s) || UNBOUND_TEAM_SCOPES.has(s)) {
      if (!allowedScopes.includes(s)) {
        rejected.push({ scope: s, reason: "not_allowed" });
      } else {
        regular.push(s);
      }
    } else {
      rejected.push({ scope: s, reason: "unknown" });
    }
  }

  if (appScopeRequests.length === 0) {
    return { scopes: regular, appScopes: [], rejected };
  }

  // Batch-lookup unique target client_ids
  const targetClientIds = [
    ...new Set(appScopeRequests.map((s) => parseAppScope(s)!.clientId)),
  ];
  const targetApps = await Promise.all(
    targetClientIds.map((cid) =>
      db
        .prepare(
          "SELECT id, client_id, name, icon_url FROM oauth_apps WHERE client_id = ? AND is_active = 1",
        )
        .bind(cid)
        .first<{
          id: string;
          client_id: string;
          name: string;
          icon_url: string | null;
        }>(),
    ),
  );
  const appsMap = new Map(
    targetApps
      .filter(Boolean)
      .map((a) => [a!.client_id, a!] as [string, typeof a & {}]),
  );

  const appScopes: ResolvedAppScope[] = [];

  // Batch-lookup scope definitions and access rules per target app
  const targetAppIds = [...appsMap.values()].map((a) => a.id);
  const [scopeDefsResult, accessRulesResult] = await Promise.all([
    targetAppIds.length
      ? db
          .prepare(
            `SELECT app_id, scope, title, description FROM app_scope_definitions WHERE app_id IN (${targetAppIds.map(() => "?").join(",")})`,
          )
          .bind(...targetAppIds)
          .all<{
            app_id: string;
            scope: string;
            title: string;
            description: string;
          }>()
      : Promise.resolve({
          results: [] as {
            app_id: string;
            scope: string;
            title: string;
            description: string;
          }[],
        }),
    targetAppIds.length
      ? db
          .prepare(
            `SELECT app_id, rule_type, target_id FROM app_scope_access_rules WHERE app_id IN (${targetAppIds.map(() => "?").join(",")}) AND rule_type IN ('app_allow','app_deny')`,
          )
          .bind(...targetAppIds)
          .all<{ app_id: string; rule_type: string; target_id: string }>()
      : Promise.resolve({
          results: [] as {
            app_id: string;
            rule_type: string;
            target_id: string;
          }[],
        }),
  ]);

  // Build lookup maps
  const scopeDefsMap = new Map<
    string,
    Map<string, { title: string; description: string }>
  >();
  for (const d of scopeDefsResult.results) {
    if (!scopeDefsMap.has(d.app_id)) scopeDefsMap.set(d.app_id, new Map());
    scopeDefsMap
      .get(d.app_id)!
      .set(d.scope, { title: d.title, description: d.description });
  }

  const accessRulesMap = new Map<
    string,
    { allowList: string[]; denyList: string[] }
  >();
  for (const r of accessRulesResult.results) {
    if (!accessRulesMap.has(r.app_id))
      accessRulesMap.set(r.app_id, { allowList: [], denyList: [] });
    const entry = accessRulesMap.get(r.app_id)!;
    if (r.rule_type === "app_allow") entry.allowList.push(r.target_id);
    else if (r.rule_type === "app_deny") entry.denyList.push(r.target_id);
  }

  for (const s of appScopeRequests) {
    const parsed = parseAppScope(s)!;
    const target = appsMap.get(parsed.clientId);
    if (!target) {
      rejected.push({ scope: s, reason: "target_missing" });
      continue;
    }

    // Check app-level access rules (requesting app's client_id vs target app's rules)
    const rules = accessRulesMap.get(target.id);
    if (rules) {
      if (rules.denyList.includes(requestingClientId)) {
        rejected.push({ scope: s, reason: "app_denied" });
        continue;
      }
      if (
        rules.allowList.length > 0 &&
        !rules.allowList.includes(requestingClientId)
      ) {
        rejected.push({ scope: s, reason: "app_denied" });
        continue;
      }
    }

    const def = scopeDefsMap.get(target.id)?.get(parsed.innerScope);
    appScopes.push({
      scope: s,
      client_id: parsed.clientId,
      inner_scope: parsed.innerScope,
      app_name: target.name,
      app_icon_url: await proxyImageUrl(appUrl, db, target.icon_url),
      scope_title: def?.title ?? null,
      scope_desc: def?.description ?? null,
    });
  }

  return {
    scopes: [...regular, ...appScopes.map((a) => a.scope)],
    appScopes,
    rejected,
  };
}
