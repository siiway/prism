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
): { ok: true; value: number } | { ok: false } {
  if (!Number.isSafeInteger(value) || (value as number) < uses)
    return { ok: false };
  return { ok: true, value: value as number };
}

export function isInviteEnabled(enabled: number | null | undefined): boolean {
  return enabled !== 0;
}
