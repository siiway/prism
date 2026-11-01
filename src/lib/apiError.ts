// Turning an API failure into text for the person on the page.
//
// The API answers with a stable code (e.g. "scope_grant_not_found") and the
// client translates it from apiErrors.<code> when the request fails, so an
// ApiError's message is already in the reader's language.

import { ApiError } from "./api";

/** The error code, or null for something that isn't an API failure. */
export function apiErrorCode(err: unknown): string | null {
  return err instanceof ApiError ? err.code : null;
}

/** Text for a failed request: the API error, translated, or `fallback` for
 *  anything else (a network failure, a bug). */
export function apiErrorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}
