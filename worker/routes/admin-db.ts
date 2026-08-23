// Direct D1 access for site administrators.
//
// This is the escape hatch: a schema browser, a row editor and an
// unrestricted SQL console over the same D1 binding the rest of the worker
// uses. It exists because every admin screen is a curated view of the
// database, and curated views always end one column short of the thing you
// actually need at 3am.
//
// It is also, unavoidably, the most dangerous surface in the product — a
// single statement here can empty a table or hand out admin. Four things keep
// it honest rather than safe, because "safe" isn't on offer:
//
//   1. It is off unless an operator turned it on. `D1_CONSOLE` defaults to
//      off: a door this wide should not open because nobody said otherwise.
//   2. Writes must be asked for. A statement that changes anything is
//      refused unless the caller sets `allow_write`, so a mistyped console
//      session cannot destroy data it only meant to read.
//   3. The audit log is append-only here, at every setting. See
//      APPEND_ONLY_TABLES — this is the one rule no configuration relaxes.
//   4. Everything is audited, and identifiers are never interpolated from
//      user input. The browse and row-edit endpoints resolve table and column
//      names against the live schema first and quote them; only the console
//      takes raw SQL, and it takes it as one explicit, audited act.
//
// Mounted under /api/admin, which already sits behind requireAdmin.

import { Hono } from "hono";
import { getIp } from "../lib/clientIp";
import { recordAudit, auditRequestMeta } from "../lib/audit";
import { readPage } from "../lib/pagination";
import { d1ConsoleMode } from "../lib/consoleMode";
import type { Variables } from "../types";

type AppEnv = { Bindings: Env; Variables: Variables };
const app = new Hono<AppEnv>();

// ─── Availability ─────────────────────────────────────────────────────────────

/** What this instance allows. Answers even when the console is off, because
 *  the admin UI needs it to decide whether to render the tab at all — and a
 *  mode an administrator can already infer from the config file is not
 *  something to withhold from them. Registered above the gate so it survives
 *  it. */
app.get("/status", (c) =>
  c.json({
    mode: d1ConsoleMode(c.env),
    writable: d1ConsoleMode(c.env) === "full",
    /** Tables no setting will let this console write to. */
    append_only: [...APPEND_ONLY_TABLES],
  }),
);

// `off` hides the surface rather than 403-ing it: an operator who turned this
// off wants it gone, and a 404 is the honest answer to "is there a database
// console here". This is now the default — direct storage access is opt-in.
app.use("*", async (c, next) => {
  if (d1ConsoleMode(c.env) === "off")
    return c.json({ error: "Not found" }, 404);
  await next();
});

/** Refuse a mutating request when the console is in read-only mode. */
function readOnlyRefusal(c: import("hono").Context<AppEnv>) {
  if (d1ConsoleMode(c.env) !== "read-only") return null;
  return c.json(
    {
      error:
        "The database console is in read-only mode (D1_CONSOLE). Writes are disabled.",
      read_only: true,
    },
    403,
  );
}

/** Hard cap on rows returned by any one call. The console is a browser tab,
 *  not a data pipeline — a SELECT over a large table should truncate rather
 *  than try to serialize the lot into a JSON response. */
const MAX_ROWS = 500;

// ─── Append-only tables ───────────────────────────────────────────────────────

/** Tables this console will not write to, at any setting.
 *
 *  The audit log is what makes every other administrative power accountable:
 *  a site admin can reach into any team, reset anyone's credentials and read
 *  most of the database, and the answer to "who did that" is these tables. A
 *  console that could edit them would make that answer worth nothing, so it
 *  cannot — not in full mode, not with `allow_write`, not by an operator who
 *  really means it.
 *
 *  `sqlite_master` is on the list for the same reason at one remove: with
 *  `PRAGMA writable_schema` it is the way to rename or redefine a table out
 *  from under a guard that names it.
 *
 *  This is a guard on *this surface*, not a cryptographic guarantee. Anyone
 *  with the Cloudflare account can run SQL against D1 directly, and nothing
 *  here changes that. What it does is stop the product from offering the
 *  operation — so tampering requires leaving the product, which is a
 *  different act with a different trail. */
const APPEND_ONLY_TABLES = new Set([
  "audit_events",
  "audit_log",
  "sqlite_master",
  "sqlite_schema",
]);

function isAppendOnly(table: string): boolean {
  return APPEND_ONLY_TABLES.has(table.toLowerCase());
}

/** Does this statement write to a protected table?
 *
 *  Deliberately over-broad: any non-read statement that so much as names one
 *  is refused, including a write to a different table that mentions
 *  `audit_events` inside a string literal. The cost of that is a rejected
 *  query someone can rephrase; the cost of the opposite is an editable audit
 *  log, so the asymmetry decides it. */
function touchesAppendOnly(sql: string): string | null {
  for (const table of APPEND_ONLY_TABLES) {
    // Word-bounded so `audit_events` does not match `my_audit_events_copy`,
    // and quoted/bracketed forms are covered by the boundary either side.
    if (new RegExp(`\\b${table}\\b`, "i").test(sql)) return table;
  }
  // `PRAGMA writable_schema = ON` names no table but exists to make the
  // schema writable, which is the same intent by another route.
  if (/\bwritable_schema\b/i.test(sql)) return "sqlite_master";
  return null;
}

function appendOnlyRefusal(
  c: import("hono").Context<AppEnv>,
  table: string,
) {
  return c.json(
    {
      error: `${table} is append-only and cannot be modified from the console. The audit log is what makes every other admin action accountable; editing it here is not offered at any setting.`,
      append_only: true,
      table,
    },
    403,
  );
}

// ─── Schema ───────────────────────────────────────────────────────────────────

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

/** Quote an identifier for SQLite. Only ever called with a name that came
 *  back from the schema — the doubling is belt-and-braces for names that
 *  legitimately contain a quote. */
function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

/** Every table except SQLite's own bookkeeping, which is hidden from the
 *  browser (nothing there is usefully editable) but still reachable from the
 *  SQL console. */
async function listTableNames(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name`,
    )
    .all<{ name: string }>();
  return results.map((r) => r.name);
}

/** Resolve a caller-supplied table name to the real one, or null.
 *
 *  The comparison is against the live schema rather than a pattern, so the
 *  name that reaches a query string is always one SQLite gave us. */
async function resolveTable(
  db: D1Database,
  requested: string,
): Promise<string | null> {
  const names = await listTableNames(db);
  return names.find((n) => n === requested) ?? null;
}

async function tableColumns(
  db: D1Database,
  table: string,
): Promise<ColumnInfo[]> {
  const { results } = await db
    .prepare(`PRAGMA table_info(${quoteIdent(table)})`)
    .all<ColumnInfo>();
  return results;
}

function serializeColumns(columns: ColumnInfo[]) {
  return columns.map((col) => ({
    name: col.name,
    type: col.type,
    notnull: col.notnull === 1,
    default_value: col.dflt_value,
    pk: col.pk > 0,
  }));
}

/** Columns that identify a single row, best-effort.
 *
 *  The declared primary key if there is one; otherwise `rowid`, which every
 *  ordinary SQLite table has even though it never appears in `table_info`.
 *  A WITHOUT ROWID table with no primary key can't be addressed row-wise at
 *  all — those return null and the UI sends the caller to the console. */
async function rowKeyColumns(
  db: D1Database,
  table: string,
): Promise<{ columns: string[]; usesRowid: boolean } | null> {
  const cols = await tableColumns(db, table);
  const pk = cols
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
  if (pk.length) return { columns: pk, usesRowid: false };
  try {
    await db.prepare(`SELECT rowid FROM ${quoteIdent(table)} LIMIT 1`).all();
    return { columns: ["rowid"], usesRowid: true };
  } catch {
    return null;
  }
}

// ─── Statement classification ─────────────────────────────────────────────────

/** Strip leading comments so the first keyword can be read. */
function stripLeadingNoise(sql: string): string {
  let s = sql.trim();
  for (;;) {
    if (s.startsWith("--")) {
      const nl = s.indexOf("\n");
      if (nl === -1) return "";
      s = s.slice(nl + 1).trimStart();
      continue;
    }
    if (s.startsWith("/*")) {
      const end = s.indexOf("*/");
      if (end === -1) return "";
      s = s.slice(end + 2).trimStart();
      continue;
    }
    return s;
  }
}

const READ_ONLY_LEADERS = ["SELECT", "WITH", "PRAGMA", "EXPLAIN"];

const WRITE_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|TRUNCATE|ATTACH|DETACH|VACUUM|REINDEX)\b/;

/** True when the statement only reads.
 *
 *  `WITH` and `PRAGMA` are the awkward ones — both can write (`WITH … DELETE`,
 *  `PRAGMA journal_mode = …`). Rather than parse SQL, the whole statement
 *  also has to be free of write keywords, and a PRAGMA in its assignment form
 *  (`PRAGMA x = y`) is treated as a write even though it names none of them.
 *
 *  A read-only query that happens to contain the word "update" inside a
 *  string literal is misfiled as a write, which costs the caller one
 *  checkbox; guessing the other way costs data. */
function isReadOnlyStatement(sql: string): boolean {
  const s = stripLeadingNoise(sql).toUpperCase();
  if (!READ_ONLY_LEADERS.some((k) => s.startsWith(k))) return false;
  if (s.startsWith("PRAGMA") && s.includes("=")) return false;
  return !WRITE_KEYWORDS.test(s);
}

/** Split a script into statements on semicolons that sit outside string
 *  literals, quoted identifiers and comments. */
function splitStatements(script: string): string[] {
  const out: string[] = [];
  let current = "";
  let i = 0;
  while (i < script.length) {
    const ch = script[i];
    const next = script[i + 1];
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      current += ch;
      i++;
      while (i < script.length) {
        current += script[i];
        if (script[i] === quote) {
          // A doubled quote is an escaped quote, not the end of the literal.
          if (script[i + 1] === quote) {
            current += script[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "-" && next === "-") {
      const nl = script.indexOf("\n", i);
      if (nl === -1) break;
      current += script.slice(i, nl + 1);
      i = nl + 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = script.indexOf("*/", i + 2);
      if (end === -1) break;
      current += script.slice(i, end + 2);
      i = end + 2;
      continue;
    }
    if (ch === ";") {
      if (current.trim()) out.push(current.trim());
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

// ─── Audit ────────────────────────────────────────────────────────────────────

function auditDb(
  c: import("hono").Context<AppEnv>,
  action: string,
  metadata: Record<string, unknown>,
  resourceId?: string | null,
): void {
  const admin = c.get("user");
  const meta = auditRequestMeta(c);
  void recordAudit(c.env, c.executionCtx, {
    scope: "platform",
    scopeId: null,
    action,
    actorId: admin.id,
    actorName: admin.username,
    resourceType: "database",
    resourceId: resourceId ?? null,
    resourceName: null,
    ip: meta.ip ?? getIp(c),
    userAgent: meta.userAgent,
    geo: meta.geo,
    metadata,
  });
}

/** D1 hands back values as JS primitives, except BLOBs, which arrive as
 *  ArrayBuffer or number[]. Neither survives JSON usefully, so summarize. */
function serializeCell(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return `<blob ${value.byteLength} bytes>`;
  if (Array.isArray(value)) return `<blob ${value.length} bytes>`;
  return value;
}

function serializeRows(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) out[k] = serializeCell(v);
    return out;
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** Table list with row counts, columns, and the DDL that created each one. */
app.get("/tables", async (c) => {
  const names = await listTableNames(c.env.DB);
  const tables = await Promise.all(
    names.map(async (name) => {
      const [countRow, ddl, columns] = await Promise.all([
        c.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(name)}`)
          .first<{ n: number }>()
          .catch(() => null),
        c.env.DB.prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
          .bind(name)
          .first<{ sql: string | null }>(),
        tableColumns(c.env.DB, name),
      ]);
      return {
        name,
        row_count: countRow?.n ?? null,
        sql: ddl?.sql ?? null,
        columns: serializeColumns(columns),
      };
    }),
  );
  return c.json({ tables });
});

/** Page through one table. `order_by`, `dir` and `where` are optional.
 *
 *  `where` is raw SQL. That is no wider a door than the console sitting next
 *  to it, and it saves a trip through the console for the everyday "find the
 *  row I need to fix" case. */
app.get("/tables/:table/rows", async (c) => {
  const table = await resolveTable(c.env.DB, c.req.param("table"));
  if (!table) return c.json({ error: "Table not found" }, 404);

  const { page, limit, offset } = readPage(
    c.req.query("page"),
    c.req.query("limit"),
    50,
    MAX_ROWS,
  );

  const columns = await tableColumns(c.env.DB, table);
  const keys = await rowKeyColumns(c.env.DB, table);

  const orderRequested = c.req.query("order_by")?.trim();
  const orderColumn = columns.find((col) => col.name === orderRequested)?.name;
  const dir = c.req.query("dir")?.toLowerCase() === "asc" ? "ASC" : "DESC";
  const where = c.req.query("where")?.trim();

  // rowid comes back alongside the real columns so the row editor has a
  // handle on tables with no declared primary key.
  const selection = keys?.usesRowid ? 'rowid AS "rowid", *' : "*";
  const whereClause = where ? ` WHERE ${where}` : "";
  const orderClause = orderColumn
    ? ` ORDER BY ${quoteIdent(orderColumn)} ${dir}`
    : "";

  try {
    const [rows, countRow] = await Promise.all([
      c.env.DB.prepare(
        `SELECT ${selection} FROM ${quoteIdent(table)}${whereClause}${orderClause} LIMIT ? OFFSET ?`,
      )
        .bind(limit, offset)
        .all<Record<string, unknown>>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM ${quoteIdent(table)}${whereClause}`,
      ).first<{ n: number }>(),
    ]);

    return c.json({
      table,
      columns: serializeColumns(columns),
      key_columns: keys?.columns ?? [],
      editable: keys !== null,
      rows: serializeRows(rows.results),
      total: countRow?.n ?? 0,
      page,
      limit,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

/** Insert one row. `values` is a column → value map; columns left out take
 *  their schema default. */
app.post("/tables/:table/rows", async (c) => {
  const refusal = readOnlyRefusal(c);
  if (refusal) return refusal;
  const table = await resolveTable(c.env.DB, c.req.param("table"));
  if (!table) return c.json({ error: "Table not found" }, 404);
  if (isAppendOnly(table)) return appendOnlyRefusal(c, table);

  const body = await c.req.json<{ values: Record<string, unknown> }>();
  const columns = await tableColumns(c.env.DB, table);
  const known = new Set(columns.map((col) => col.name));

  const entries = Object.entries(body.values ?? {}).filter(([k]) =>
    known.has(k),
  );
  if (!entries.length)
    return c.json({ error: "No known columns in `values`" }, 400);

  const sql =
    `INSERT INTO ${quoteIdent(table)} ` +
    `(${entries.map(([k]) => quoteIdent(k)).join(", ")}) ` +
    `VALUES (${entries.map(() => "?").join(", ")})`;

  let result;
  try {
    result = await c.env.DB.prepare(sql)
      .bind(...entries.map(([, v]) => v as never))
      .run();
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  auditDb(
    c,
    "admin.db.row.insert",
    { table, columns: entries.map(([k]) => k) },
    table,
  );
  return c.json({ message: "Row inserted", meta: result.meta }, 201);
});

/** Update one row, addressed by its primary key (or rowid). */
app.patch("/tables/:table/rows", async (c) => {
  const refusal = readOnlyRefusal(c);
  if (refusal) return refusal;
  const table = await resolveTable(c.env.DB, c.req.param("table"));
  if (!table) return c.json({ error: "Table not found" }, 404);
  if (isAppendOnly(table)) return appendOnlyRefusal(c, table);

  const body = await c.req.json<{
    key: Record<string, unknown>;
    values: Record<string, unknown>;
  }>();
  const keys = await rowKeyColumns(c.env.DB, table);
  if (!keys)
    return c.json(
      { error: "This table has no primary key — edit it from the SQL console" },
      400,
    );

  const columns = await tableColumns(c.env.DB, table);
  const known = new Set(columns.map((col) => col.name));

  const sets = Object.entries(body.values ?? {}).filter(([k]) => known.has(k));
  if (!sets.length) return c.json({ error: "No columns to update" }, 400);

  const keyEntries = keys.columns.map((k) => [k, body.key?.[k]] as const);
  if (keyEntries.some(([, v]) => v === undefined))
    return c.json({ error: `key must include: ${keys.columns.join(", ")}` }, 400);

  const sql =
    `UPDATE ${quoteIdent(table)} SET ` +
    `${sets.map(([k]) => `${quoteIdent(k)} = ?`).join(", ")} WHERE ` +
    `${keyEntries.map(([k]) => `${quoteIdent(k)} = ?`).join(" AND ")}`;

  let result;
  try {
    result = await c.env.DB.prepare(sql)
      .bind(
        ...sets.map(([, v]) => v as never),
        ...keyEntries.map(([, v]) => v as never),
      )
      .run();
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  auditDb(
    c,
    "admin.db.row.update",
    {
      table,
      key: body.key,
      columns: sets.map(([k]) => k),
      rows_written: result.meta?.changes ?? null,
    },
    table,
  );
  return c.json({ message: "Row updated", meta: result.meta });
});

/** Delete one row, addressed by its primary key (or rowid). */
app.delete("/tables/:table/rows", async (c) => {
  const refusal = readOnlyRefusal(c);
  if (refusal) return refusal;
  const table = await resolveTable(c.env.DB, c.req.param("table"));
  if (!table) return c.json({ error: "Table not found" }, 404);
  if (isAppendOnly(table)) return appendOnlyRefusal(c, table);

  const body = await c.req.json<{ key: Record<string, unknown> }>();
  const keys = await rowKeyColumns(c.env.DB, table);
  if (!keys)
    return c.json(
      {
        error:
          "This table has no primary key — delete it from the SQL console",
      },
      400,
    );

  const keyEntries = keys.columns.map((k) => [k, body.key?.[k]] as const);
  if (keyEntries.some(([, v]) => v === undefined))
    return c.json({ error: `key must include: ${keys.columns.join(", ")}` }, 400);

  const sql =
    `DELETE FROM ${quoteIdent(table)} WHERE ` +
    `${keyEntries.map(([k]) => `${quoteIdent(k)} = ?`).join(" AND ")}`;

  let result;
  try {
    result = await c.env.DB.prepare(sql)
      .bind(...keyEntries.map(([, v]) => v as never))
      .run();
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  auditDb(
    c,
    "admin.db.row.delete",
    { table, key: body.key, rows_written: result.meta?.changes ?? null },
    table,
  );
  return c.json({ message: "Row deleted", meta: result.meta });
});

/** The console. Runs one or more statements against D1.
 *
 *  Multi-statement scripts go through `DB.batch`, which wraps them in a
 *  transaction — a script that fails halfway leaves nothing behind. */
app.post("/query", async (c) => {
  const body = await c.req.json<{
    sql: string;
    params?: unknown[];
    /** Required for anything that isn't a plain read. */
    allow_write?: boolean;
  }>();

  const script = (body.sql ?? "").trim();
  if (!script) return c.json({ error: "sql is required" }, 400);

  const statements = splitStatements(script);
  if (!statements.length) return c.json({ error: "No statement found" }, 400);
  if (statements.length > 1 && body.params?.length)
    return c.json(
      { error: "Bound parameters only apply to a single statement" },
      400,
    );

  const writes = statements.filter((s) => !isReadOnlyStatement(s));

  // Checked before read-only mode and before `allow_write`, because this is
  // not a setting anyone may trade against: the audit log stays append-only
  // whatever else the console is allowed to do.
  for (const statement of writes) {
    const table = touchesAppendOnly(statement);
    if (table) {
      auditDb(c, "admin.db.query.error", {
        sql: script.slice(0, 4000),
        error: `refused: ${table} is append-only`,
        write: true,
      });
      return appendOnlyRefusal(c, table);
    }
  }

  // Read-only mode outranks `allow_write` — the caller cannot opt back into
  // something the operator turned off.
  if (writes.length) {
    const refusal = readOnlyRefusal(c);
    if (refusal) {
      auditDb(c, "admin.db.query.error", {
        sql: script.slice(0, 4000),
        error: "read-only mode",
        write: true,
      });
      return refusal;
    }
  }
  if (writes.length && !body.allow_write) {
    return c.json(
      {
        error:
          "This statement can modify data. Re-run it with write mode enabled.",
        requires_write: true,
        statements: writes.length,
      },
      400,
    );
  }

  const started = Date.now();
  try {
    const prepared = statements.map((sql) => {
      const stmt = c.env.DB.prepare(sql);
      return statements.length === 1 && body.params?.length
        ? stmt.bind(...(body.params as never[]))
        : stmt;
    });
    // batch() is transactional. A single statement takes the same path so the
    // response shape doesn't depend on how many were sent.
    const results = await c.env.DB.batch<Record<string, unknown>>(prepared);

    const payload = results.map((res, i) => {
      const rows = res.results ?? [];
      return {
        sql: statements[i],
        columns: rows.length ? Object.keys(rows[0]) : [],
        rows: serializeRows(rows.slice(0, MAX_ROWS)),
        truncated: rows.length > MAX_ROWS,
        row_count: rows.length,
        rows_written: res.meta?.changes ?? 0,
        last_row_id: res.meta?.last_row_id ?? null,
        duration_ms: res.meta?.duration ?? null,
      };
    });

    auditDb(c, writes.length ? "admin.db.query.write" : "admin.db.query.read", {
      sql: script.slice(0, 4000),
      statements: statements.length,
      rows_written: payload.reduce((n, r) => n + (r.rows_written ?? 0), 0),
      rows_read: payload.reduce((n, r) => n + r.row_count, 0),
    });

    return c.json({ results: payload, duration_ms: Date.now() - started });
  } catch (err) {
    const message = (err as Error).message;
    // A failed write is worth recording too — a rejected `DROP TABLE users`
    // is exactly the kind of thing an operator wants to find afterwards.
    auditDb(c, "admin.db.query.error", {
      sql: script.slice(0, 4000),
      error: message,
      write: writes.length > 0,
    });
    return c.json({ error: message }, 400);
  }
});

export default app;
