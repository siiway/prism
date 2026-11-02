// Personal access token permissions: each resource has access levels, and a
// level stands for a fixed set of scopes (each including the ones before).
// Built from USER_GRANTABLE_SCOPES, the list the server validates against,
// so a scope dropped there disappears here too.

import { USER_GRANTABLE_SCOPES } from "../../shared/scopes";

const GRANTABLE = new Set(USER_GRANTABLE_SCOPES);

export type LevelId = "none" | "on" | "read" | "write" | "full";

export type ResourceId =
  | "identity"
  | "email"
  | "profile"
  | "apps"
  | "teams"
  | "domains"
  | "gpg"
  | "social"
  | "adminUsers"
  | "adminConfig"
  | "adminInvites";

export interface Resource {
  id: ResourceId;
  group: "account" | "resources" | "admin";
  /** Each level's scopes include the levels before it. */
  levels: { id: LevelId; scopes: string[] }[];
}

const rw = (name: string, extra: string[] = []): Resource["levels"] => {
  const read = [`${name}:read`];
  const write = [...read, `${name}:write`];
  return [
    { id: "none", scopes: [] },
    { id: "read", scopes: read },
    { id: "write", scopes: write },
    ...(extra.length
      ? [{ id: "full" as const, scopes: [...write, ...extra] }]
      : []),
  ];
};

const ALL_RESOURCES: Resource[] = [
  {
    id: "identity",
    group: "account",
    levels: [
      { id: "none", scopes: [] },
      { id: "on", scopes: ["openid"] },
    ],
  },
  {
    id: "email",
    group: "account",
    levels: [
      { id: "none", scopes: [] },
      { id: "on", scopes: ["email"] },
    ],
  },
  {
    id: "profile",
    group: "account",
    levels: [
      { id: "none", scopes: [] },
      { id: "read", scopes: ["profile"] },
      { id: "write", scopes: ["profile", "profile:write"] },
    ],
  },
  { id: "apps", group: "resources", levels: rw("apps") },
  {
    id: "teams",
    group: "resources",
    levels: rw("teams", ["teams:create", "teams:delete"]),
  },
  { id: "domains", group: "resources", levels: rw("domains") },
  { id: "gpg", group: "resources", levels: rw("gpg") },
  { id: "social", group: "resources", levels: rw("social") },
  {
    id: "adminUsers",
    group: "admin",
    levels: rw("admin:users", ["admin:users:delete"]),
  },
  { id: "adminConfig", group: "admin", levels: rw("admin:config") },
  {
    id: "adminInvites",
    group: "admin",
    levels: [
      { id: "none", scopes: [] },
      { id: "read", scopes: ["admin:invites:read"] },
      {
        id: "full",
        scopes: [
          "admin:invites:read",
          "admin:invites:create",
          "admin:invites:delete",
        ],
      },
    ],
  },
];

// Keep only what the server accepts; drop resources left with nothing.
export const RESOURCES: Resource[] = ALL_RESOURCES.map((r) => ({
  ...r,
  levels: r.levels.filter(
    (l) => l.id === "none" || l.scopes.every((s) => GRANTABLE.has(s)),
  ),
})).filter((r) => r.levels.length > 1);

export type ScopeLevels = Record<string, LevelId>;

/** A sensible starting point: who you are, your email, read your profile. */
export const DEFAULT_SCOPE_LEVELS: ScopeLevels = {
  identity: "on",
  email: "on",
  profile: "read",
};

export function scopesFor(levels: ScopeLevels): string[] {
  const out = new Set<string>();
  for (const r of RESOURCES) {
    const level = r.levels.find((l) => l.id === (levels[r.id] ?? "none"));
    for (const s of level?.scopes ?? []) out.add(s);
  }
  return USER_GRANTABLE_SCOPES.filter((s) => out.has(s));
}
