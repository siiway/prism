// What people paste into the invite field: usually the whole link an admin
// sent (…/register?invite=CODE), sometimes just the code. Either way the
// server wants the code.

export function inviteCodeFrom(input: string): string {
  const value = input.trim();
  const match = /[?&]invite=([^&#\s]+)/.exec(value);
  if (!match) return value;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
