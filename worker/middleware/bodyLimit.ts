import type { MiddlewareHandler } from "hono";
import {
  BodySizeLimitError,
  cancelStream,
  declaredLengthExceedsLimit,
  limitStreamBytes,
} from "../lib/bodyLimit";

export const MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024;

/**
 * Reject declared oversized bodies before route middleware runs and wrap every
 * other request stream so a missing or false Content-Length cannot bypass the
 * same cap.
 */
export function bodySizeLimit(maxBytes: number): MiddlewareHandler {
  return async (c, next) => {
    const body = c.req.raw.body;
    if (!body) return next();

    if (
      declaredLengthExceedsLimit(
        c.req.raw.headers.get("content-length"),
        maxBytes,
      )
    ) {
      cancelStream(body, new BodySizeLimitError(maxBytes));
      return c.json({ error: "Request body too large" }, 413);
    }

    let exceeded = false;
    const requestInit: RequestInit & { duplex: "half" } = {
      body: limitStreamBytes(body, maxBytes, () => {
        exceeded = true;
      }),
      duplex: "half",
    };
    c.req.raw = new Request(c.req.raw, requestInit);
    await next();

    // Route-level JSON/form parsers sometimes translate all body read errors
    // into a 400. Preserve the global size-limit contract in that case.
    if (exceeded) {
      c.res = c.json({ error: "Request body too large" }, 413);
    }
  };
}

export const requestBodyLimit = bodySizeLimit(MAX_REQUEST_BODY_BYTES);
