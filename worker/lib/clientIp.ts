// Resolve the originating client IP for audit logs, rate limiting, and
// captcha verification.
//
// Cloudflare sets CF-Connecting-IP for direct edge traffic unless visitor-IP
// headers are removed by zone configuration. The X-Forwarded-For fallback
// covers local dev and explicitly trusted proxy paths where the edge header is
// absent. "unknown" is the last resort so callers always get a non-empty value.
export function getIp(c: {
  req: { header: (h: string) => string | undefined };
}): string {
  return (
    c.req.header("CF-Connecting-IP") ??
    c.req.header("X-Forwarded-For") ??
    "unknown"
  );
}
