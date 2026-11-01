// Turning an API failure into text for the person on the page.
//
// Endpoints answer with a stable code in `error` (e.g. "scope_grant_not_found")
// and the UI translates it from `apiErrors.<code>`. Some older endpoints
// still answer with an English sentence; until they move to codes, that
// sentence is shown as it is, which is no worse than before.

import type { TFunction } from "i18next";
import { ApiError } from "./api";

const CODE = /^[a-z][a-z0-9_]*$/;

/** The error code, when the API sent one rather than a sentence. */
export function apiErrorCode(err: unknown): string | null {
  return err instanceof ApiError && CODE.test(err.message) ? err.message : null;
}

/** Text for a failed request: the translation of its code, the server's own
 *  sentence for endpoints that don't send codes yet, or `fallback`. */
export function apiErrorText(
  t: TFunction,
  err: unknown,
  fallback: string,
): string {
  const code = apiErrorCode(err);
  if (code) {
    const text = t(`apiErrors.${code}`, { defaultValue: "" });
    return text || fallback;
  }
  if (err instanceof ApiError && err.message) return err.message;
  return fallback;
}
