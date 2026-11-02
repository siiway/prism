export function canManageTeamInvite(
  role: string,
  actorId: string,
  createdBy: string,
): boolean {
  return (
    role === "owner" ||
    role === "co-owner" ||
    (role === "admin" && actorId === createdBy)
  );
}

export function validateInviteMaxUses(
  value: unknown,
  uses: number,
  unlimitedValue: number | null = null,
): { ok: true; value: number } | { ok: false } {
  if (
    !Number.isSafeInteger(value) ||
    ((value as number) !== unlimitedValue && (value as number) < uses)
  )
    return { ok: false };
  return { ok: true, value: value as number };
}

export function isInviteEnabled(enabled: number | null | undefined): boolean {
  return enabled !== 0;
}

export interface InviteRow {
  token: string;
  team_id: string;
  role: string;
  created_by: string;
  email: string | null;
  max_uses: number;
  uses: number;
  expires_at: number;
  created_at: number;
  allows_registration: number;
  allow_existing_members: number;
  enabled: number;
}

export interface InviteGroupRow {
  invite_token: string;
  id: string;
  slug: string;
  name: string;
  color: string | null;
}

export async function loadInviteGroups(
  db: D1Database,
  inviteTokens: string[],
): Promise<Map<string, InviteGroupRow[]>> {
  const byInvite = new Map<string, InviteGroupRow[]>();
  if (inviteTokens.length === 0) return byInvite;
  const placeholders = inviteTokens.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT ig.invite_token, g.id, g.slug, g.name, g.color
       FROM team_invite_groups ig
       JOIN team_groups g ON g.id = ig.group_id
       JOIN teams t ON t.id = ig.team_id AND t.enable_groups = 1
        WHERE ig.invite_token IN (${placeholders})
        ORDER BY g.name ASC`,
    )
    .bind(...inviteTokens)
    .all<InviteGroupRow>();
  for (const row of results) {
    const list = byInvite.get(row.invite_token);
    if (list) list.push(row);
    else byInvite.set(row.invite_token, [row]);
  }
  return byInvite;
}
