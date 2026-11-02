// Shared helpers for the scripts in this folder. They run under Bun on any OS:
//
//   bun run setup | build | deploy

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
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
 * `capture` is set, in which case stdout is returned. Exits on failure unless
 * `allowFail` is set.
 */
export function run(cmd: string, args: string[], opts: RunOptions = {}) {
  const shown = [cmd === process.execPath ? "bun" : cmd, ...args].join(" ");
  if (opts.dryRun) {
    info(dim(`would run: ${shown}`));
    return { ok: true, stdout: "" };
  }
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: opts.capture ? ["inherit", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
  });
  const success = res.status === 0;
  if (!success && !opts.allowFail) {
    fail(`command failed: ${shown}`);
  }
  return { ok: success, stdout: res.stdout ?? "" };
}

/** Run a dev-dependency binary (wrangler, tsc, vite) through `bun x`. */
export function bunx(bin: string, args: string[], opts: RunOptions = {}) {
  return run(process.execPath, ["x", bin, ...args], opts);
}

export function wrangler(args: string[], opts: RunOptions = {}) {
  return bunx("wrangler", args, opts);
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

let rl: ReturnType<typeof createInterface> | undefined;

/** Ask a question on the terminal. Returns `fallback` when the answer is empty. */
export async function ask(question: string, fallback = ""): Promise<string> {
  if (!process.stdin.isTTY) {
    fail(`no terminal to answer "${question}" on`);
  }
  rl ??= createInterface({ input: process.stdin, output: process.stdout });
  const hint = fallback ? dim(` [${fallback}]`) : "";
  const answer = (await rl.question(`    ${question}${hint} `)).trim();
  return answer || fallback;
}

export async function confirm(
  question: string,
  fallback: boolean,
): Promise<boolean> {
  const answer = await ask(`${question} ${fallback ? "[Y/n]" : "[y/N]"}`);
  if (!answer) return fallback;
  return /^y(es)?$/i.test(answer);
}

export function closePrompts() {
  rl?.close();
  rl = undefined;
}
