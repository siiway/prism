// Set Prism up in your Cloudflare account, then deploy it.
//
//   bun run setup [--dry-run]
//
// Signs in with wrangler, finds or creates the D1 database, the KV namespaces,
// an optional R2 bucket and the Secrets Store key, and writes their IDs, your
// URL and your account into wrangler.jsonc. Resources that already exist are
// reused, so it is safe to run again. --dry-run only reads from your account
// and prints what it would change.

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyEdits, modify, type JSONPath } from "jsonc-parser";
import {
  ROOT,
  WRANGLER_CONFIG,
  ask,
  bold,
  bunx,
  cloudflareApi,
  confirm,
  dim,
  fail,
  info,
  lastJson,
  ok,
  parseArgs,
  readWranglerConfig,
  run,
  step,
  warn,
  wrangler,
} from "./lib.ts";

const USAGE = `Usage: bun run setup [options]

  --dry-run    Read from your account, but create nothing and leave
               wrangler.jsonc as it is
  -h, --help   Show this help`;

const { flags } = parseArgs(
  process.argv.slice(2),
  { flags: ["--dry-run"] },
  USAGE,
);
const dryRun = flags.has("--dry-run");
const SECRET_NAME = "prism-secrets-key";

if (!process.stdin.isTTY) fail("setup asks questions, so it needs a terminal");

const config = readWranglerConfig();
const edits: { path: JSONPath; value: unknown; label: string }[] = [];
const change = (path: JSONPath, value: unknown, label: string) =>
  edits.push({ path, value, label });

// ── Sign in ───────────────────────────────────────────────────────────────────
step("Signing in to Cloudflare");

type Account = { id: string; name: string };
const whoami = () => {
  const res = wrangler(["whoami", "--json"], {
    capture: true,
    allowFail: true,
  });
  return res.ok
    ? (lastJson(res.stdout) as { email?: string; accounts: Account[] })
    : null;
};
let user = whoami();
if (!user) {
  if (dryRun) fail("not signed in; run `bun x wrangler login` first");
  wrangler(["login"]);
  user = whoami() ?? fail("still not signed in");
}
info(`signed in as ${user.email ?? "an API token"}`);

let account = user.accounts.find((a) => a.id === config.account_id);
if (!account && user.accounts.length === 1) account = user.accounts[0];
if (!account) {
  if (user.accounts.length === 0) fail("this login has no Cloudflare accounts");
  user.accounts.forEach((a, i) => info(`${i + 1}. ${a.name} ${dim(a.id)}`));
  const pick = Number(ask("Which account?", "1"));
  account = user.accounts[pick - 1] ?? fail("no such account");
}
ok(`account: ${account.name}`);
if (config.account_id !== account.id)
  change(["account_id"], account.id, "account");

const client = cloudflareApi();

// ── Worker name and URL ───────────────────────────────────────────────────────
step("Naming the Worker");
let name: string;
for (;;) {
  name = ask("Worker name:", config.name ?? "prism");
  if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name)) break;
  warn("use lowercase letters, digits and dashes");
}
if (name !== config.name) change(["name"], name, "worker name");

// The workers.dev subdomain belongs to the account, so the Worker's address is
// known before its first deploy. New accounts may not have one yet.
const subdomainRes = await request("GET", "/workers/subdomain");
const subdomain = subdomainRes.json?.success
  ? (subdomainRes.json.result as { subdomain: string }).subdomain
  : undefined;
const workersDevUrl = (sub: string) => `https://${name}.${sub}.workers.dev`;

// A custom domain must be on a zone in this account. null when the
// credentials may not list zones, such as an API token without Zone:Read.
type Zone = { name: string; status: string };
const zones = await listZones();
if (!zones) warn("can't list this account's zones, so domains aren't checked");
const zoneOf = (host: string) =>
  zones
    ?.filter((z) => host === z.name || host.endsWith(`.${z.name}`))
    .sort((a, b) => b.name.length - a.name.length)[0];

type Target = { appUrl: string; host: string; subdomain?: string };
/** Check an entered URL; returns what is wrong with it as a string. */
function parseTarget(entered: string): Target | string {
  if (!entered) return "enter the public URL";
  let url: URL;
  try {
    const withScheme = entered.includes("://") ? entered : `https://${entered}`;
    url = new URL(withScheme.replace(/\/+$/, ""));
  } catch {
    return `not an https:// origin: ${entered}`;
  }
  // Only a bare origin: APP_URL gets paths appended for OAuth callbacks and
  // issuer metadata, so a path, query, fragment or credentials would break
  // them.
  if (url.protocol !== "https:" || url.href !== `${url.origin}/`) {
    return `not an https:// origin: ${entered}`;
  }
  const host = url.hostname;
  if (host.endsWith(".workers.dev")) {
    const [, worker, sub] =
      host.match(/^([^.]+)\.([^.]+)\.workers\.dev$/) ?? [];
    if (worker !== name || !sub || (subdomain && sub !== subdomain)) {
      return `this Worker's workers.dev URL is ${workersDevUrl(subdomain ?? "<subdomain>")}`;
    }
    return { appUrl: url.origin, host, subdomain: sub };
  }
  if (zones && !zoneOf(host)) {
    return `${host} is not on a domain in this Cloudflare account`;
  }
  return { appUrl: url.origin, host };
}

info("The public URL is where people will reach Prism: a domain on this");
info("account, such as auth.example.com, or a workers.dev address.");
if (subdomain) {
  info(
    `This Worker's workers.dev address is ${bold(workersDevUrl(subdomain))}.`,
  );
} else {
  info("This account has no workers.dev subdomain yet. To use workers.dev,");
  info(`enter ${workersDevUrl("<subdomain>")} and setup registers it.`);
}
if (zones?.length) {
  const shown = zones.slice(0, 10).map((z) => z.name);
  if (zones.length > shown.length) shown.push(`${zones.length - 10} more`);
  info(`Domains on this account: ${shown.join(", ")}`);
}
// Suggest the saved URL only if it still fits this account and Worker name.
const saved = config.vars?.APP_URL ? parseTarget(config.vars.APP_URL) : "";
const suggestedUrl =
  typeof saved === "object"
    ? saved.appUrl
    : subdomain
      ? workersDevUrl(subdomain)
      : undefined;
let target: Target;
for (;;) {
  const result = parseTarget(ask("Public URL:", suggestedUrl));
  if (typeof result === "object") {
    target = result;
    break;
  }
  warn(result);
}
const { appUrl, host } = target;
const isWorkersDev = !!target.subdomain;
if (target.subdomain && !subdomain) {
  const sub = target.subdomain;
  await create("workers.dev subdomain", sub, () =>
    cf("PUT", "/workers/subdomain", { subdomain: sub }),
  );
}
const zone = zoneOf(host);
if (zone && zone.status !== "active") {
  warn(`${zone.name} is ${zone.status}; ${host} works once the zone is active`);
}
if (appUrl !== config.vars?.APP_URL)
  change(["vars", "APP_URL"], appUrl, "APP_URL");
const routes = isWorkersDev
  ? undefined
  : [{ pattern: host, custom_domain: true }];
if (JSON.stringify(routes) !== JSON.stringify(config.routes)) {
  change(
    ["routes"],
    routes,
    routes ? `custom domain ${host}` : "no custom domain",
  );
}

// ── D1 ────────────────────────────────────────────────────────────────────────
step("D1 database");
for (const [i, db] of (config.d1_databases ?? []).entries()) {
  let id =
    db.database_id && (await exists(`/d1/database/${db.database_id}`))
      ? db.database_id
      : undefined;
  if (id) {
    ok(`${db.binding}: ${db.database_name} ${dim(id)}`);
    continue;
  }
  const found = (
    await cf<{ uuid: string; name: string }[]>(
      "GET",
      `/d1/database?name=${encodeURIComponent(db.database_name)}`,
    )
  ).find((d) => d.name === db.database_name);
  id =
    found?.uuid ??
    (await create(
      "D1 database",
      db.database_name,
      async () =>
        (
          await cf<{ uuid: string }>("POST", "/d1/database", {
            name: db.database_name,
          })
        ).uuid,
    ));
  change(["d1_databases", i, "database_id"], id, `${db.binding} database`);
}

// ── KV ────────────────────────────────────────────────────────────────────────
step("KV namespaces");
const namespaces: { id: string; title: string }[] = [];
for (let page = 1; ; page++) {
  const batch = await cf<{ id: string; title: string }[]>(
    "GET",
    `/storage/kv/namespaces?per_page=100&page=${page}`,
  );
  namespaces.push(...batch);
  if (batch.length < 100) break;
}
for (const [i, kv] of (config.kv_namespaces ?? []).entries()) {
  if (kv.id && namespaces.some((n) => n.id === kv.id)) {
    ok(`${kv.binding} ${dim(kv.id)}`);
    continue;
  }
  const title = `${name}-${kv.binding}`;
  const id =
    namespaces.find((n) => n.title === title)?.id ??
    (await create(
      "KV namespace",
      title,
      async () =>
        (await cf<{ id: string }>("POST", "/storage/kv/namespaces", { title }))
          .id,
    ));
  change(["kv_namespaces", i, "id"], id, `${kv.binding} namespace`);
}

// ── R2 (optional) ─────────────────────────────────────────────────────────────
step("R2 bucket (optional)");
let addedR2 = false;
if (config.r2_buckets?.length) {
  for (const bucket of config.r2_buckets) {
    if (await exists(`/r2/buckets/${bucket.bucket_name}`)) {
      ok(`${bucket.binding}: ${bucket.bucket_name}`);
    } else {
      await create("R2 bucket", bucket.bucket_name, () =>
        cf("POST", "/r2/buckets", { name: bucket.bucket_name }),
      );
    }
  }
} else {
  info(
    "R2 holds uploaded avatars and app icons too big to keep in the database.",
  );
  info("Without it, uploads are limited to small images.");
  if (confirm("Use an R2 bucket?", false)) {
    const bucketName = `${name}-assets`;
    if (await exists(`/r2/buckets/${bucketName}`)) {
      ok(`found ${bucketName}`);
    } else {
      await create("R2 bucket", bucketName, () =>
        cf("POST", "/r2/buckets", { name: bucketName }),
      );
    }
    change(
      ["r2_buckets"],
      [{ binding: "R2_ASSETS", bucket_name: bucketName }],
      "R2 bucket",
    );
    addedR2 = true;
  } else {
    info("skipped; run setup again to add it later");
  }
}

// ── Secrets Store ─────────────────────────────────────────────────────────────
step("Secrets Store key (recommended)");
type Store = { id: string; name: string };
const stores = await cf<Store[]>("GET", "/secrets_store/stores");
const bound = config.secrets_store_secrets?.[0];
let store = stores.find((s) => s.id === bound?.store_id);
const secretName = bound?.secret_name ?? SECRET_NAME;
const hasSecret = async (s: Store) =>
  (
    await cf<{ name: string }[]>(
      "GET",
      `/secrets_store/stores/${s.id}/secrets?per_page=100`,
    )
  ).some((secret) => secret.name === secretName);

if (store && (await hasSecret(store))) {
  ok(`${secretName} in store ${store.name}`);
} else {
  info("A key in a Secrets Store encrypts OAuth client secrets, captcha and");
  info("mail passwords, and lets Prism store tokens as keyed hashes.");
  if (confirm("Create the key?", true)) {
    store ??= stores[0];
    if (store) {
      ok(`using store ${store.name}`);
    } else {
      const created = await create("Secrets Store", "default", () =>
        cf<Store>("POST", "/secrets_store/stores", { name: "default" }),
      );
      store = {
        id: typeof created === "string" ? created : created.id,
        name: "default",
      };
    }
    // Never replace an existing key: everything encrypted with it would be lost.
    const storeIsNew = store.id.startsWith("<");
    if (!storeIsNew && (await hasSecret(store))) {
      ok(`found ${secretName}`);
    } else {
      await create("secret", secretName, () =>
        cf("POST", `/secrets_store/stores/${store!.id}/secrets`, [
          {
            name: secretName,
            value: randomBytes(32).toString("base64url"),
            scopes: ["workers"],
            comment: "Prism encryption key. Never change or delete it.",
          },
        ]),
      );
    }
    change(
      ["secrets_store_secrets"],
      [{ binding: "SECRETS_KEY", store_id: store.id, secret_name: secretName }],
      "Secrets Store key",
    );
  } else if (bound) {
    change(["secrets_store_secrets"], undefined, "no Secrets Store key");
  }
}

// ── wrangler.jsonc ────────────────────────────────────────────────────────────
step("Updating wrangler.jsonc");
if (edits.length === 0) {
  ok("already up to date");
} else {
  let text = readFileSync(WRANGLER_CONFIG, "utf8");
  if (addedR2) {
    // Drop the commented-out example block that the real one replaces.
    text = text.replace(
      /[ \t]*\/\/ R2 Bucket\r?\n[ \t]*\/\*[\s\S]*?\*\/\r?\n/,
      "",
    );
  }
  for (const { path, value, label } of edits) {
    info(
      `${label}: ${dim(JSON.stringify(path))} = ${JSON.stringify(value) ?? "(removed)"}`,
    );
    text = applyEdits(
      text,
      modify(text, path, value, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      }),
    );
  }
  if (dryRun) {
    info(dim("--dry-run: not written"));
  } else {
    writeFileSync(WRANGLER_CONFIG, text);
    // The edits drop trailing commas; keep the file as the format check wants.
    bunx("prettier", ["--write", WRANGLER_CONFIG], {
      capture: true,
      allowFail: true,
    });
    ok("written");
  }
}

// ── Deploy ────────────────────────────────────────────────────────────────────
step("Deploying");
const deploy = [join(ROOT, "scripts", "deploy.ts"), "--yes"];
if (dryRun) {
  run(process.execPath, deploy, { dryRun });
} else if (confirm("Build, migrate the database and deploy now?", true)) {
  run(process.execPath, deploy);
  console.log(`\n${bold("Done.")} Open ${appUrl} to create the admin account.`);
} else {
  info("Deploy later with: bun run deploy");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** All zones in the account, or null if these credentials can't list them. */
async function listZones(): Promise<Zone[] | null> {
  const all: Zone[] = [];
  for (let page = 1; ; page++) {
    const { json } = await client.request(
      "GET",
      `/zones?account.id=${account!.id}&per_page=50&page=${page}`,
    );
    if (!json?.success) return null;
    const batch = json.result as Zone[];
    all.push(...batch);
    if (batch.length < 50) return all;
  }
}

/** API requests relative to the account. */
function request(method: string, path: string, body?: unknown) {
  return client.request(method, `/accounts/${account!.id}${path}`, body);
}

function cf<T>(method: string, path: string, body?: unknown): Promise<T> {
  return client.call<T>(method, `/accounts/${account!.id}${path}`, body);
}

async function exists(path: string): Promise<boolean> {
  const { status, json } = await request("GET", path);
  return status === 200 && !!json?.success;
}

/** Create a resource, or under --dry-run say so and return a placeholder. */
async function create<T>(
  kind: string,
  label: string,
  make: () => Promise<T>,
): Promise<T | string> {
  if (dryRun) {
    info(`would create ${kind} ${bold(label)}`);
    return `<new ${kind}>`;
  }
  const result = await make();
  ok(`created ${kind} ${bold(label)}`);
  return result;
}
