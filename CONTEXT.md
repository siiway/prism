# Prism

A self-hosted OAuth 2.0 / OpenID Connect identity platform on Cloudflare
Workers. This glossary records project-specific terms whose meaning is not
obvious from the code.

## Captcha

**Captcha provider**:
A single bot-protection mechanism: `turnstile`, `hcaptcha`, `recaptcha`, `pow`
(built-in proof-of-work), `geetest` (GeeTest v4), or `cap` ([Cap](https://trycap.dev)).
`none` is not a provider — it is the absence of one.

**Enabled set**:
The ordered list of providers a site has turned on (`captcha_providers`). The
moderator chooses both membership and order. An empty set means captcha is off.
_Avoid_: provider list, captcha config.

**Default provider**:
Element 0 of the enabled set — the provider rendered first to a visitor.
_Avoid_: primary provider.

**Alternate**:
Any non-default member of the enabled set. A visitor may switch to it.
_Avoid_: fallback, secondary.

**Switch**:
A visitor swapping the rendered widget from the current provider to an alternate.
Offered manually, revealed on a verification failure, and revealed after
`captcha_switch_timeout_seconds`. A switch never happens automatically — the
visitor chooses — and the choice is remembered in the browser.

**Cap mode**:
Where Cap runs: `embedded` (in-Worker via `capjs-core`, KV-backed) or `external`
(a self-hosted Cap Standalone server).

**Fail open / fail closed**:
The posture when a third-party captcha service (GeeTest) is unreachable: accept
the visitor (fail open) or reject them (fail closed). Prism defaults to fail
closed so an outage does not silently drop bot protection.
