// RFC 9470 step-up authentication: the `acr` derived from a session's
// authentication methods, and the challenge a resource sends when it needs
// stronger authentication than the token carries.

import type { Context } from "hono";

/** Derive an `acr` value from the authentication methods: "mfa" when a second
 *  factor was used, otherwise "pwd". */
export function deriveAcr(amr: string[]): string {
  return amr.includes("mfa") || amr.includes("otp") ? "mfa" : "pwd";
}

/**
 * RFC 9470 §3: a resource that needs stronger authentication answers 401 with
 * `insufficient_user_authentication` and the `acr_values` (and/or `max_age`) it
 * wants, which the client feeds back into a fresh authorization request.
 */
export function challengeStepUp(
  c: Context,
  opts: { acrValues?: string; maxAge?: number },
): void {
  let value = `Bearer error="insufficient_user_authentication", error_description="stronger authentication required"`;
  if (opts.acrValues) value += `, acr_values="${opts.acrValues}"`;
  if (opts.maxAge != null) value += `, max_age="${opts.maxAge}"`;
  c.header("WWW-Authenticate", value);
}
