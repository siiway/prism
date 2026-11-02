export function parseLockdownList(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function isUserLocked(env: Env, username: string): boolean {
  return parseLockdownList(env.LOCKDOWN_USERS).has(username);
}

export function isTeamLocked(env: Env, teamName: string): boolean {
  return parseLockdownList(env.LOCKDOWN_TEAMS).has(teamName);
}
