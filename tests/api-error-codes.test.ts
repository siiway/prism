// The API answers with stable error codes, never English sentences, and the
// client translates every code it can receive (src/web/i18n, apiErrors.<code>).
// See src/worker/lib/apiError.ts. These checks read the worker source, so a new
// `c.json({ error: "Something broke" })` fails here instead of reaching a
// Chinese-speaking user as English.
//
// Deliberately out of scope: OAuth/OIDC protocol `error_description` (for
// client developers, defined by the RFCs), email and notification content,
// and plain-text machine endpoints.

import { describe, expect, test } from "bun:test";
import en from "../src/web/i18n/en.json";
import zh from "../src/web/i18n/zh.json";
import { createApiClient, ApiError } from "../src/web/lib/api";
import {
  stripComments as code,
  workerErrorCodes,
  workerSources,
} from "../scripts/api-error-codes";

const CODE = /^[a-z][a-z0-9_]*$/;
const CODE_TEMPLATE = /^[a-z][a-z0-9_]*\$\{[^}]+\}$/;

const worker = workerSources();

describe("API errors are codes", () => {
  test("no `error:` literal is a sentence", () => {
    const bad: string[] = [];
    for (const { file, text } of worker) {
      const src = code(text);
      for (const m of src.matchAll(/\berror:\s*"((?:[^"\\]|\\.)*)"/g))
        if (!CODE.test(m[1])) bad.push(`${file}: "${m[1]}"`);
      for (const m of src.matchAll(/\berror:\s*`((?:[^`\\]|\\.)*)`/g))
        if (!CODE_TEMPLATE.test(m[1])) bad.push(`${file}: \`${m[1]}\``);
    }
    expect(bad).toEqual([]);
  });

  test("responses carry no English `message`", () => {
    const bad: string[] = [];
    for (const { file, text } of worker) {
      if (!/[\\/](routes|middleware)[\\/]|[\\/]index\.ts$/.test(file)) continue;
      for (const m of code(text).matchAll(
        /(?<![\w.])message:\s*["'`]([^"'`]*)/g,
      ))
        bad.push(`${file}: ${m[1].slice(0, 60)}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("every code has a translation", () => {
  const codes = workerErrorCodes(worker);

  test("finds the codes", () => {
    // Guard against the collector silently matching nothing.
    expect(codes.size).toBeGreaterThan(200);
    expect(codes.has("restricted_feature")).toBe(true);
    expect(codes.has("redirect_uri_scheme")).toBe(true);
  });

  for (const [lang, dict] of [
    ["en", en.apiErrors],
    ["zh", zh.apiErrors],
  ] as const) {
    test(lang, () => {
      const table = dict as Record<string, string>;
      expect([...codes].filter((c) => !table[c])).toEqual([]);
      expect(table.unknown).toBeTruthy();
      expect(table.http_error).toBeTruthy();
    });
  }
});

describe("ApiError", () => {
  const failing = (status: number, body: unknown) =>
    createApiClient({
      fetcher: async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      translate: (c, params) =>
        `T(${c}${params ? JSON.stringify(params) : ""})`,
    });

  test("translates the code and keeps it for comparisons", async () => {
    const api = failing(400, {
      error: "field_required",
      params: { field: "name" },
    });
    const err = await api.site().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("field_required");
    expect((err as ApiError).params).toEqual({ field: "name" });
    expect((err as ApiError).message).toBe('T(field_required{"field":"name"})');
  });

  test("a body without a code becomes http_error", async () => {
    const api = createApiClient({
      fetcher: async () => new Response("bad gateway", { status: 502 }),
      translate: (c, params) => `${c}:${params?.status}`,
    });
    const err = (await api.site().catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe("http_error");
    expect(err.message).toBe("http_error:502");
  });
});
