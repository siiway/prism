// The signed-in user as the client sees it: the profile shape returned by
// login, registration, `/user/me` and the SSR prefetch.

import type { AuthUser, UserRow } from "../types";
import { proxyImageUrl } from "./proxyImage";

export type SessionUser = AuthUser & { unproxied_avatar_url: string | null };

export async function toSessionUser(
  baseUrl: string,
  db: D1Database,
  user: UserRow,
): Promise<SessionUser> {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    display_name: user.display_name,
    avatar_url: await proxyImageUrl(baseUrl, db, user.avatar_url),
    unproxied_avatar_url: user.avatar_url,
    role: user.role,
    email_verified: user.email_verified === 1,
  };
}
