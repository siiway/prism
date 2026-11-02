// Shared helpers for the scripts in this folder. They run under Bun on any OS:
//
//   bun run setup | build | deploy

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "jsonc-parser";

export const ROOT = resolve(import.meta.dirname, "..");
export const WRANGLER_CONFIG = join(ROOT, "wrangler.jsonc");

const color = process.stdout.isTTY
  ? (code: string) => (text: string) => `\x1b[${code}m${text}\x1b[0m`
  : () => (text: string) => text;
export const bold = color("1");
export const dim = color("2");
const red = color("31");
const yellow = color("33");
const green = color("32");
const cyan = color("36");

export const step = (msg: string) =>
  console.log(`\n${cyan("==>")} ${bold(msg)}`);
export const info = (msg: string) => console.log(`    ${msg}`);
export const ok = (msg: string) => console.log(`    ${green("ok")} ${msg}`);
export const warn = (msg: string) =>
  console.error(`    ${yellow("warn")} ${msg}`);

export function fail(msg: string): never {
  console.error(`\n${red("error")} ${msg}`);
  process.exit(1);
}

/** True when a CI runner (GitHub Actions, GitLab, Workers Builds, ...) runs us. */
export const isCI = ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "WORKERS_CI"].some(
  (name) => !!process.env[name],
);

/** Whether `cmd` is on PATH. */
export function has(cmd: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which";
  return spawnSync(probe, [cmd], { stdio: "ignore" }).status === 0;
}

type RunOptions = { dryRun?: boolean; capture?: boolean; allowFail?: boolean };

/**
 * Run a program directly (no shell). Output goes to the terminal unless
 * `capture` is set: then stdout is returned and stderr (banners, warnings)
 * is shown only if the command fails. Exits on failure unless `allowFail`.
 */
export function run(cmd: string, args: string[], opts: RunOptions = {}) {
  const shown = [cmd === process.execPath ? "bun" : cmd, ...args].join(" ");
  if (opts.dryRun) {
    info(dim(`would run: ${shown}`));
    return { ok: true, stdout: "" };
  }
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: opts.capture ? ["inherit", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });
  // Ctrl+C while the child had the terminal stops us too, even if allowFail.
  // 0xC000013A is Windows' STATUS_CONTROL_C_EXIT.
  if (
    res.signal === "SIGINT" ||
    res.status === 130 ||
    res.status === 0xc000013a
  ) {
    process.exit(130);
  }
  const success = res.status === 0;
  if (!success && !opts.allowFail) {
    if (opts.capture && res.stderr) process.stderr.write(res.stderr);
    fail(`command failed: ${shown}`);
  }
  return { ok: success, stdout: res.stdout ?? "" };
}

/** Run a dev-dependency binary (wrangler, vite) through `bun x`. */
export function bunx(bin: string, args: string[], opts: RunOptions = {}) {
  return run(process.execPath, ["x", bin, ...args], opts);
}

// TypeScript 7 (the native compiler) is installed as `typescript7` next to
// TypeScript 6, which typescript-eslint and the scripts' own `import ts` still
// need. Both packages ship a `tsc` bin, so call 7's launcher by path.
const TSC = join(ROOT, "node_modules", "typescript7", "bin", "tsc");

/** Typecheck with TypeScript 7, e.g. `tsc(["-p", "src/web"])`. */
export function tsc(args: string[], opts: RunOptions = {}) {
  return run(process.execPath, [TSC, ...args], opts);
}

export function wrangler(args: string[], opts: RunOptions = {}) {
  return bunx("wrangler", args, opts);
}

/** wrangler may print warnings before its JSON; parse from the first brace. */
export function lastJson(stdout: string): unknown {
  const start = stdout.indexOf("{");
  if (start < 0) fail(`expected JSON from wrangler, got: ${stdout}`);
  return JSON.parse(stdout.slice(start));
}

type ApiResponse = {
  success?: boolean;
  result?: unknown;
  errors?: { code: number; message: string }[];
} | null;

/**
 * A Cloudflare API client signed in with wrangler's credentials: its OAuth
 * login, or CLOUDFLARE_API_TOKEN in CI. Paths are relative to /client/v4.
 */
export function cloudflareApi() {
  const res = wrangler(["auth", "token", "--json"], { capture: true });
  const cred = lastJson(res.stdout) as {
    token?: string;
    key?: string;
    email?: string;
  };
  const auth: Record<string, string> = cred.token
    ? { Authorization: `Bearer ${cred.token}` }
    : cred.key && cred.email
      ? { "X-Auth-Key": cred.key, "X-Auth-Email": cred.email }
      : fail("could not read wrangler's credentials");

  async function request(method: string, path: string, body?: unknown) {
    let res: Response;
    try {
      res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
        method,
        headers: { ...auth, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        // D1 stops a query after 30 s, so this only trips on a stalled
        // connection.
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      const e = err as Error;
      fail(
        `${method} ${path}: ${e.name === "TimeoutError" ? "no response from Cloudflare in 60 s" : e.message}`,
      );
    }
    const json = (await res.json().catch(() => null)) as ApiResponse;
    return { status: res.status, json };
  }

  /** The errors in a failed response, as one line. */
  const why = (status: number, json: ApiResponse) =>
    json?.errors?.map((e) => `${e.message} (${e.code})`).join("; ") ||
    `HTTP ${status}`;

  /** Like request, but exits with the API's errors unless it succeeds. */
  async function call<T>(method: string, path: string, body?: unknown) {
    const { status, json } = await request(method, path, body);
    if (!json?.success) fail(`${method} ${path}: ${why(status, json)}`);
    return json.result as T;
  }

  return { request, call, why };
}

/** A one-line progress bar on a terminal; one line per item otherwise. */
export function progress(total: number) {
  const tty = process.stdout.isTTY;
  const width = 24;
  return {
    update(done: number, label: string) {
      if (!tty) {
        if (label) info(label);
        return;
      }
      const filled = Math.round((width * done) / total);
      const bar = "█".repeat(filled) + dim("░".repeat(width - filled));
      const head = `    ${bar} ${String(done).padStart(String(total).length)}/${total} `;
      // Keep it on one line, or \r can't redraw it.
      const room = (process.stdout.columns || 80) - (head.length - 8) - 1;
      const text = label.length > room ? `${label.slice(0, room - 1)}…` : label;
      process.stdout.write(`\r\x1b[K${head}${dim(text)}`);
    },
    done() {
      if (tty) process.stdout.write("\r\x1b[K");
    },
  };
}

export type WranglerConfig = {
  name?: string;
  account_id?: string;
  vars?: Record<string, string>;
  routes?: { pattern: string; custom_domain?: boolean }[];
  d1_databases?: {
    binding: string;
    database_name: string;
    database_id?: string;
    migrations_dir?: string;
    migrations_table?: string;
  }[];
  kv_namespaces?: { binding: string; id?: string }[];
  r2_buckets?: { binding: string; bucket_name: string }[];
  secrets_store_secrets?: {
    binding: string;
    store_id: string;
    secret_name: string;
  }[];
};

export function readWranglerConfig(): WranglerConfig {
  if (!existsSync(WRANGLER_CONFIG)) fail("wrangler.jsonc not found");
  return parse(readFileSync(WRANGLER_CONFIG, "utf8")) as WranglerConfig;
}

/** Parse --flag, --flag=value and --flag value arguments. */
export function parseArgs(
  argv: string[],
  spec: {
    flags: string[];
    options?: string[];
    aliases?: Record<string, string>;
  },
  usage: string,
) {
  const flags = new Set<string>();
  const options = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    arg = spec.aliases?.[arg] ?? arg;
    if (arg === "-h" || arg === "--help") {
      console.log(usage);
      process.exit(0);
    }
    const [name, inline] = arg.split(/=(.*)/s, 2);
    if (spec.flags.includes(name) && inline === undefined) {
      flags.add(name);
    } else if (spec.options?.includes(name)) {
      const value = inline ?? argv[++i];
      if (value === undefined) fail(`${name} needs a value\n\n${usage}`);
      options.set(name, value);
    } else {
      fail(`unknown option: ${arg}\n\n${usage}`);
    }
  }
  return { flags, options };
}

// Prompts read stdin synchronously, one byte at a time, and never open a
// stream on it. A stream (readline) keeps taking keystrokes after it is
// closed on Windows, so wrangler's own prompts in a child process would get
// no input. Bun's prompt() can't tell Ctrl+C from an empty answer.
function readLine(): string {
  const bytes: number[] = [];
  const byte = Buffer.alloc(1);
  for (;;) {
    let n: number;
    try {
      n = readSync(0, byte, 0, 1, null);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EAGAIN") continue;
      throw err;
    }
    // Nothing read: Ctrl+C (Windows) or Ctrl+D.
    if (n === 0) {
      console.log();
      process.exit(130);
    }
    if (byte[0] === 0x0a) break;
    bytes.push(byte[0]);
  }
  return Buffer.from(bytes).toString("utf8").replace(/\r$/, "");
}

/** Ask a question on the terminal. Returns `fallback` when the answer is empty. */
export function ask(question: string, fallback = ""): string {
  if (!process.stdin.isTTY) {
    fail(`no terminal to answer "${question}" on`);
  }
  const hint = fallback ? dim(` [${fallback}]`) : "";
  process.stdout.write(`    ${question}${hint} `);
  return readLine().trim() || fallback;
}

export function confirm(question: string, fallback: boolean): boolean {
  const answer = ask(`${question} ${fallback ? "[Y/n]" : "[y/N]"}`);
  if (!answer) return fallback;
  return /^y(es)?$/i.test(answer);
}
