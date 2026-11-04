// Who may sign in to an app: the app's access whitelist, shared by every
// protocol Prism signs people in with (OAuth / OIDC and SAML).

import { ROLE_RANK, listEffectiveTeamMemberships } from "./teams";
import type { AppAccessRuleRow, OAuthAppRow } from "../types";

/** Check if the given user is allowed by the app's access whitelist rules.
 *  Returns null if allowed, or an error message string if denied. */
export async function checkAccessWhitelist(
  db: D1Database,
  app: OAuthAppRow,
  userId: string,
): Promise<string | null> {
  if (!app.access_whitelist_enabled) return null;

  const { results } = await db
    .prepare(
      "SELECT rule_type, target_id, min_role FROM app_access_rules WHERE app_id = ?",
    )
    .bind(app.id)
    .all<AppAccessRuleRow>();

  if (results.length === 0) return "unauthorized_whitelist";

  const teamRules = results.filter((r) => r.rule_type === "team");
  const userRules = results.filter((r) => r.rule_type === "user");

  if (userRules.some((r) => r.target_id === userId)) return null;

  if (teamRules.length > 0) {
    const memberships = await listEffectiveTeamMemberships(db, userId);
    const membershipByTeam = new Map(
      memberships.map((m) => [m.team.id, m.role]),
    );
    for (const rule of teamRules) {
      const role = membershipByTeam.get(rule.target_id);
      if (!role) continue;
      const minRank = ROLE_RANK[rule.min_role ?? "member"] ?? 0;
      if ((ROLE_RANK[role] ?? 0) >= minRank) return null;
    }
  }

  return "unauthorized_whitelist";
}
