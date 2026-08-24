// Legal pages: Privacy Policy and Terms of Service.
//
// Two audiences, one feature. Anyone (signed in or not) reads the published
// documents; administrators author them. The read side is the public path that
// backs the /privacy and /terms pages, so it degrades to "not published"
// rather than 500 when the table is missing — a page load must survive an
// unapplied migration the same way the notice board does.
//
// Mounted twice: the reader at /api/legal with no auth, and the admin surface
// under /api/admin/legal, which inherits requireAdmin from the admin router.

import { Hono } from "hono";
import { getIp } from "../lib/clientIp";
import { recordAudit, auditRequestMeta } from "../lib/audit";
import { MIGRATIONS_PENDING, readWithFallback } from "../lib/schema";
import {
  LEGAL_SLUGS,
  LEGAL_MAX_BYTES,
  isLegalSlug,
  getLegalDocument,
  listLegalDocuments,
  upsertLegalDocument,
} from "../lib/legal";
import type { Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };

function serialize(slug: string, content: string, updated_at: number | null) {
  // The empty/unpublished case reports no timestamp: a "last updated" date on
  // a page that says "not published yet" would be nonsense.
  return { doc: slug, content, updated_at: content ? updated_at : null };
}

// ─── Reader (public) ──────────────────────────────────────────────────────────

export const readerRoutes = new Hono<AppEnv>();

/** One legal document. `content` is raw markdown ("" when unpublished); the
 *  client renders it through the profile-README sanitizer. Kept off the /site
 *  payload (which is prefetched everywhere) because a policy can be large —
 *  the reader pays for it only when they open the page. */
readerRoutes.get("/:doc", async (c) => {
  const doc = c.req.param("doc");
  if (!isLegalSlug(doc)) return c.json({ error: "Unknown document" }, 404);

  // A missing table reads as "not published", not a 500 on a public page.
  const row = await readWithFallback(
    () => getLegalDocument(c.env.DB, doc),
    null,
  );
  return c.json(serialize(doc, row?.content ?? "", row?.updated_at ?? null));
});

// ─── Admin (authoring) ────────────────────────────────────────────────────────

export const adminRoutes = new Hono<AppEnv>();

// Say so plainly rather than degrading: an admin who opens this page wants to
// write a policy, and a silently-empty editor would leave them composing into
// a table that does not exist. One indexed lookup against sqlite_master, only
// on the authoring routes.
adminRoutes.use("*", async (c, next) => {
  const present = await c.env.DB.prepare(
    "SELECT 1 AS n FROM sqlite_master WHERE type = 'table' AND name = 'legal_documents'",
  ).first<{ n: number }>();
  if (!present)
    return c.json({ error: MIGRATIONS_PENDING, migrations_pending: true }, 503);
  await next();
});

/** Both documents, published or not, so the editor can load and edit either.
 *  Missing rows come back as empty content rather than being absent, so the
 *  frontend always has both slugs to render. */
adminRoutes.get("/", async (c) => {
  const rows = await listLegalDocuments(c.env.DB);
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const documents = LEGAL_SLUGS.map((slug) => {
    const row = bySlug.get(slug);
    return {
      slug,
      content: row?.content ?? "",
      updated_at: row?.content ? (row?.updated_at ?? null) : null,
    };
  });
  return c.json({ documents });
});

adminRoutes.put("/:doc", async (c) => {
  const doc = c.req.param("doc");
  if (!isLegalSlug(doc)) return c.json({ error: "Unknown document" }, 404);

  const body = await c.req.json<{ content?: unknown }>();
  const content = body.content;
  if (typeof content !== "string")
    return c.json({ error: "content must be a string" }, 400);
  if (new TextEncoder().encode(content).byteLength > LEGAL_MAX_BYTES)
    return c.json(
      { error: `content exceeds the ${LEGAL_MAX_BYTES}-byte limit` },
      400,
    );

  const admin = c.get("user");

  // Read the prior state before writing so the audit entry can distinguish
  // publishing, editing, and clearing rather than logging a flat "update".
  const before = await getLegalDocument(c.env.DB, doc);
  const wasPublished = !!before?.content;

  await upsertLegalDocument(c.env.DB, doc, content, admin.id);

  const meta = auditRequestMeta(c);
  void recordAudit(c.env, c.executionCtx, {
    scope: "platform",
    scopeId: null,
    action: !content
      ? "admin.legal.unpublish"
      : wasPublished
        ? "admin.legal.update"
        : "admin.legal.publish",
    actorId: admin.id,
    actorName: admin.username,
    resourceType: "legal_document",
    resourceId: doc,
    resourceName: doc,
    ip: meta.ip ?? getIp(c),
    userAgent: meta.userAgent,
    geo: meta.geo,
    metadata: { bytes: new TextEncoder().encode(content).byteLength },
  });

  const row = await getLegalDocument(c.env.DB, doc);
  return c.json(serialize(doc, row?.content ?? "", row?.updated_at ?? null));
});
