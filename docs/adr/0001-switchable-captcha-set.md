# Switchable captcha provider set

## Context

Captcha was a single site-wide provider (`captcha_provider`) with one shared
site/secret key pair. We needed visitors to be able to switch to an alternate
provider when one fails or is unfriendly, and to add GeeTest v4 and Cap.

## Decision

The active configuration is an **ordered set**, `captcha_providers: CaptchaProvider[]`
— element 0 is the default, the rest are switchable alternates — and **each
provider carries its own credentials** (they can all be configured at once). A
submission names its `provider`; the server verifies against that provider and
rejects any not in the enabled set. The legacy `captcha_provider` + shared keys
are read once at load and migrated in memory into the new fields, so existing
deployments keep working until they next save the settings.

## Considered options

- **Primary + separate fallback list**, or a full per-provider transition map:
  rejected as more config surface than "the moderator picks an ordered set"
  needs.
- **Nested `captcha_config` blob** instead of flat per-provider keys: rejected to
  keep the existing encrypt-at-rest / redaction / allowlist machinery (which
  operates on flat `SiteConfig` keys) unchanged.

## Consequences

- Cap embedded mode uses `capjs-core` (Worker-compatible, unlike
  `@cap.js/server`, which needs a filesystem). `capjs-core` lazily imports
  `esbuild` / `javascript-obfuscator` for instrumentation obfuscation level ≥ 4;
  those are Node-native and unbundleable for Workers, so both are aliased to a
  stub in `wrangler.jsonc` and the embedded path pins the level ≤ 3.
- The legacy `pow` provider is retained (deprecated in favour of `cap`) so
  in-place upgrades don't break.
