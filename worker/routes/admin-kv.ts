// Direct KV access for site administrators.
//
// The companion to the D1 console. Most of what makes an instance behave the
// way it does on a given day is not in the database at all — the debug
// switches, the in-flight OAuth states, the sudo grants, the pending site
// reset — it is in KV, where nothing renders it and no endpoint lists it.
//
// Two things differ from the D1 side.
//
// First, KV has no schema, so there is nothing to resolve a key against.
// Keys are opaque strings and are only ever passed to the KV binding, never
// interpolated into anything that parses them.
//
// Second, and the reason this file is more careful than its size suggests:
// KV_SESSIONS holds the JWT signing key. Reading it is equivalent to being
// able to mint a session for any account on the instance — which is the one
// power this admin surface deliberately does not offer, because a forged
// session launders an operator's actions into someone else's history and no
// amount of logging at the point of issue fixes what the rest of the system
// then records. So the values of key-material entries are withheld and
// writing to them is refused. Deleting one is allowed: that is rotation, it
// is loud, and the next request regenerates the key.
//
// Mounted under /api/admin, which already sits behind requireAdmin.

import { Hono } from "hono";
import { getIp } from "../lib/clientIp";
import { recordAudit, auditRequestMeta } from "../lib/audit";
import { kvConsoleMode } from "../lib/consoleMode";
import type { Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// ─── Availability ─────────────────────────────────────────────────────────────

// Registered above the gate so the admin UI can still ask whether this exists
// — it decides from the answer whether to render the tab at all. Off is the
// default, so this is the common case rather than an edge one.
app.get("/status", (c) => {
  const mode = kvConsoleMode(c.env);
  return c.json({
    mode,
    writable: mode === "full",
    namespaces: (Object.keys(NAMESPACES) as NamespaceKey[])
      .filter((key) => resolveNamespace(c.env, key) !== null)
      .map((key) => ({ key, description: NAMESPACES[key].description })),
  });
});

app.use("*", async (c, next) => {
  if (kvConsoleMode(c.env) === "off") return c.json({ error: "Not found" }, 404);
  await next();
});

function readOnlyRefusal(c: import("hono").Context<AppEnv>) {
  if (kvConsoleMode(c.env) !== "read-only") return null;
  return c.json(
    {
      error:
        "The storage console is in read-only mode (KV_CONSOLE / D1_CONSOLE). Writes are disabled.",
      read_only: true,
    },
    403,
  );
}

// ─── Namespaces ───────────────────────────────────────────────────────────────

const NAMESPACES = {
  sessions: {
    binding: "KV_SESSIONS",
    description: "Sessions, system flags, signing keys",
  },
  cache: { binding: "KV_CACHE", description: "Caches and short-lived state" },
} as const;

type NamespaceKey = keyof typeof NAMESPACES;

function resolveNamespace(
  env: Env,
  requested: string,
): { key: NamespaceKey; kv: KVNamespace } | null {
  if (!(requested in NAMESPACES)) return null;
  const key = requested as NamespaceKey;
  const kv = env[NAMESPACES[key].binding] as KVNamespace | undefined;
  return kv ? { key, kv } : null;
}

// ─── Key material ─────────────────────────────────────────────────────────────

/** Keys whose value is a secret the rest of the system's integrity rests on.
 *
 *  Matched exactly, not by prefix: a new `system:*` key should default to
 *  being readable, and anything that genuinely holds key material belongs on
 *  this list deliberately rather than by accident of naming. */
const PROTECTED_KEYS = new Set([
  "system:jwt_secret",
  "system:rsa_keypair",
  "system:mldsa_keypair",
]);

function isProtected(key: string): boolean {
  return PROTECTED_KEYS.has(key);
}

// ─── Audit ────────────────────────────────────────────────────────────────────

function auditKv(
  c: import("hono").Context<AppEnv>,
  action: string,
  metadata: Record<string, unknown>,
): void {
  const admin = c.get("user");
  const meta = auditRequestMeta(c);
  void recordAudit(c.env, c.executionCtx, {
    scope: "platform",
    scopeId: null,
    action,
    actorId: admin.id,
    actorName: admin.username,
    resourceType: "kv",
    resourceId: String(metadata.key ?? null),
    resourceName: null,
    ip: meta.ip ?? getIp(c),
    userAgent: meta.userAgent,
    geo: meta.geo,
    metadata,
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** List keys, optionally under a prefix.
 *
 *  KV paginates with an opaque cursor rather than an offset, so this passes
 *  the cursor straight through instead of pretending to be page-numbered. */
app.get("/:ns/keys", async (c) => {
  const ns = resolveNamespace(c.env, c.req.param("ns"));
  if (!ns) return c.json({ error: "Namespace not found" }, 404);

  const limit = Math.min(
    1000,
    Math.max(1, Number(c.req.query("limit")) || 100),
  );
  const listed = await ns.kv.list({
    prefix: c.req.query("prefix") || undefined,
    cursor: c.req.query("cursor") || undefined,
    limit,
  });

  return c.json({
    keys: listed.keys.map((k) => ({
      name: k.name,
      expiration: k.expiration ?? null,
      metadata: k.metadata ?? null,
      protected: isProtected(k.name),
    })),
    // `list_complete` is how KV says "that was the last page"; a cursor may
    // still be present alongside it, so the flag is what callers check.
    list_complete: listed.list_complete,
    cursor: listed.list_complete ? null : (listed.cursor ?? null),
  });
});

/** Read one value.
 *
 *  The key travels in the path, so it must be URL-encoded by the caller —
 *  KV keys routinely contain `:` and `/`. */
app.get("/:ns/keys/:key{.+}", async (c) => {
  const ns = resolveNamespace(c.env, c.req.param("ns"));
  if (!ns) return c.json({ error: "Namespace not found" }, 404);

  const key = decodeURIComponent(c.req.param("key"));
  if (isProtected(key)) {
    // Existence and shape, never the bytes. See the note at the top.
    const present = (await ns.kv.get(key)) !== null;
    return c.json({
      key,
      protected: true,
      exists: present,
      value: null,
      metadata: null,
      reason:
        "This key holds signing material. Its value is withheld because reading it would allow minting a session for any account. It can be deleted, which rotates it.",
    });
  }

  const res = await ns.kv.getWithMetadata(key, { type: "text" });
  if (res.value === null) return c.json({ error: "Key not found" }, 404);

  auditKv(c, "admin.kv.read", { namespace: ns.key, key });
  return c.json({
    key,
    protected: false,
    exists: true,
    value: res.value,
    metadata: res.metadata ?? null,
  });
});

/** Write one value. `expiration_ttl` is seconds; KV's own floor is 60. */
app.put("/:ns/keys/:key{.+}", async (c) => {
  const refusal = readOnlyRefusal(c);
  if (refusal) return refusal;

  const ns = resolveNamespace(c.env, c.req.param("ns"));
  if (!ns) return c.json({ error: "Namespace not found" }, 404);

  const key = decodeURIComponent(c.req.param("key"));
  if (isProtected(key))
    return c.json(
      {
        error:
          "This key holds signing material and cannot be set here — a chosen signing key is the same power as a stolen one. Delete it to rotate.",
      },
      403,
    );

  const body = await c.req.json<{
    value: string;
    expiration_ttl?: number | null;
  }>();
  if (typeof body.value !== "string")
    return c.json({ error: "value must be a string" }, 400);

  const ttl = body.expiration_ttl;
  if (ttl !== undefined && ttl !== null) {
    if (!Number.isInteger(ttl) || ttl < 60)
      return c.json(
        { error: "expiration_ttl must be an integer of at least 60 seconds" },
        400,
      );
  }

  await ns.kv.put(
    key,
    body.value,
    ttl ? { expirationTtl: ttl } : undefined,
  );
  auditKv(c, "admin.kv.write", {
    namespace: ns.key,
    key,
    bytes: new TextEncoder().encode(body.value).byteLength,
    expiration_ttl: ttl ?? null,
  });
  return c.json({ message: "Key written" });
});

app.delete("/:ns/keys/:key{.+}", async (c) => {
  const refusal = readOnlyRefusal(c);
  if (refusal) return refusal;

  const ns = resolveNamespace(c.env, c.req.param("ns"));
  if (!ns) return c.json({ error: "Namespace not found" }, 404);

  const key = decodeURIComponent(c.req.param("key"));
  await ns.kv.delete(key);
  auditKv(c, "admin.kv.delete", {
    namespace: ns.key,
    key,
    // Worth its own field: deleting one of these rotates a signing key and
    // invalidates every session or token that depended on it.
    rotated_key_material: isProtected(key),
  });
  return c.json({
    message: isProtected(key) ? "Key material rotated" : "Key deleted",
  });
});

/** Delete everything under a prefix.
 *
 *  Bounded per call and never prefix-free: `?prefix=` is required, because a
 *  bulk delete over an unbounded namespace is not an operation with a sensible
 *  outcome — it is just a slower version of losing the data. */
app.post("/:ns/purge", async (c) => {
  const refusal = readOnlyRefusal(c);
  if (refusal) return refusal;

  const ns = resolveNamespace(c.env, c.req.param("ns"));
  if (!ns) return c.json({ error: "Namespace not found" }, 404);

  const prefix = c.req.query("prefix")?.trim();
  if (!prefix) return c.json({ error: "prefix is required" }, 400);

  const listed = await ns.kv.list({ prefix, limit: 1000 });
  const deletable = listed.keys.filter((k) => !isProtected(k.name));
  await Promise.all(deletable.map((k) => ns.kv.delete(k.name)));

  auditKv(c, "admin.kv.purge", {
    namespace: ns.key,
    prefix,
    deleted: deletable.length,
    skipped_protected: listed.keys.length - deletable.length,
  });
  return c.json({
    message: "Prefix purged",
    deleted: deletable.length,
    skipped_protected: listed.keys.length - deletable.length,
    // KV lists lazily; a namespace with more than one page under this prefix
    // needs the call repeating, and saying so beats silently under-deleting.
    more: !listed.list_complete,
  });
});

export default app;
