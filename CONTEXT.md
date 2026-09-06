# Prism

A self-hosted OAuth 2.0 / OpenID Connect identity platform on Cloudflare
Workers. This file is the project glossary: the canonical meaning of terms that
are specific to Prism's domain. It is not a spec and holds no implementation
details — when a term is ambiguous in conversation or code, this is the tie-break.

## Identity

**User**:
A real human identity — a row in `users` with `kind = "user"`. Can log in, hold
factors, own apps, and belong to teams.
_Avoid_: account, member (both are overloaded — see below).

**Team**:
A shared owner of OAuth apps and verified domains, with its own members, roles,
and optional public profile.

**Team-as-user**:
A synthetic `users` row (`kind = "team"`, id equal to the team's id) that exists
only so a team can own apps through the same owner column a user does. It has no
password, no session, and never logs in.
_Avoid_: team account.

**Restricted account**:
A user created through a team's invite-link registration. It is confined to its
origin team's subtree and is deactivated (then reaped) when that team dissolves,
until it is converted to a full account.
_Avoid_: limited user, guest.

**Origin team**:
The team whose invite minted a restricted account; it bounds the subtree that
account may act within.

## Team structure

**Sub-team**:
A team nested under a parent (`parent_team_id`). Membership and verified domains
cascade down the parent chain to it (subject to the inheritance switches).
_Avoid_: child team, group.

**Member group**:
A team-defined label attached to members *within a single team* — a
many-to-many tag, not a nested team. A member can hold several.
_Avoid_: role, team group, sub-team.

**Effective member / effective role**:
A user's standing on a team computed by walking up the parent chain and taking
the highest role held anywhere on it — as opposed to a **direct** membership row
on that exact team.

**Role**:
A member's standing within a team: `owner`, `co-owner`, `admin`, or `member`.

**Site floor**:
A site-wide *minimum* join requirement (2FA, verified email) that every team
must enforce. Teams may require more, never less.
_Avoid_: default requirement.

## Applications & providers

**OAuth app**:
A relying party registered by a user or team that obtains tokens from Prism.
_Avoid_: client (only use "client" for the OAuth-protocol role), integration.

**OAuth source**:
An external identity provider Prism federates *from* for social/federated login
(GitHub, Google, Microsoft, Discord, Telegram, X, Generic OIDC, Generic OAuth 2).
Multiple sources of the same kind may coexist.
_Avoid_: provider (reserved for captcha), connection.

**Social connection**:
A user's link to one specific OAuth source account.

**First-party app**:
An OAuth app flagged as run by the instance operator; it skips the consent
screen.

**Official app**:
An OAuth app the operator marks as officially endorsed (a trust badge). Distinct
from first-party: an app can be endorsed without being operator-run.

**Verified app**:
An OAuth app an admin has reviewed. Unverified external apps show a warning on
the consent screen.

**Trusted source**:
An OAuth source whose account emails are treated as already verified at
registration. Untrusted sources still force email verification afterwards.

**Public client**:
An OAuth app with no server to keep a secret — must use PKCE and has no client
secret. (This is the OAuth-protocol sense of "client".)
_Avoid_: browser app.

## Authentication & step-up

**Step-up 2FA**:
A server-initiated, one-time re-confirmation of a sensitive action via TOTP or
passkey. It grants no new access — the result is a one-time proof the user
re-confirmed.
_Avoid_: re-auth, MFA prompt.

**Action-pinned**:
The property that a step-up challenge's action text and redirect URI are fixed
at the server-to-server step, so an attacker who only controls a URL cannot
forge the confirmation prompt.

**Sudo mode**:
A grace window opened by a successful step-up during which further confirmations
for the same `(user, session, app)` skip the TOTP/passkey prompt.
_Avoid_: elevated session.

**Passkey**:
A WebAuthn / FIDO2 credential used as a login or step-up factor.

**Backup code**:
A single-use recovery code that substitutes for a 2FA factor.

## Scopes & tokens

**Platform scope**:
A scope from the fixed vocabulary in `shared/scopes.ts` (`openid`, `profile`,
`teams:read`, …).

**Bound team scope**:
A `team:<id>:…` scope validated against the one team a token is bound to — as
opposed to the aggregate `teams:*` family that spans every team the user is in.

**Cross-app scope**:
A named permission one app publishes for *other* apps to request through the
standard consent screen.
_Avoid_: exported permission (that's the code's internal term).

**Personal access token (PAT)**:
A long-lived, user-minted API token (prefix `prism_pat_`) carrying
user-grantable scopes.

## Invitations & registration

**Site invite**:
An admin-issued invite that lets someone register on an invite-only instance.

**Team invite**:
A team-issued invite to join an existing team. It may optionally also mint a new
account (see invite-link registration).

**Invite-link registration**:
Account creation through a team invite. It is what lets a team owner mint
accounts, and requires a per-team grant from the site admin; accounts so created
are restricted accounts.

## Domains

**Domain verification**:
Proving ownership of a domain via DNS TXT, HTML meta, or a `.well-known` file, so
the domain may back OAuth redirect URIs. The method chosen is reused on
re-verification.

## Bot protection (captcha)

**Captcha provider**:
A single bot-protection mechanism: `turnstile`, `hcaptcha`, `recaptcha`, `pow`
(built-in proof-of-work), `geetest` (GeeTest v4), or `cap`
([Cap](https://trycap.dev)). `none` is not a provider — it is the absence of one.
_Avoid_: source (reserved for OAuth).

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
`captcha_switch_timeout_seconds`. It never happens automatically — the visitor
chooses — and the choice is remembered in the browser.

**Cap mode**:
Where Cap runs: `embedded` (in-Worker via `capjs-core`, KV-backed) or `external`
(a self-hosted Cap Standalone server).

**Fail open / fail closed**:
The posture when a third-party captcha service (GeeTest) is unreachable: accept
the visitor (fail open) or reject them (fail closed). Prism defaults to fail
closed so an outage does not silently drop bot protection.

## Governance & communication

**Audit log (Transparent Control)**:
The append-only record of significant actions, scoped to a user, a team, or the
platform, and fanned out to scoped Discord / Telegram / general webhooks.
_Avoid_: request log (that is separate operational telemetry).

**Notice**:
An operator-authored announcement shown inside the product within a time window,
dismissible per reader.
_Avoid_: banner, alert, announcement.

**Notification ruleset**:
A named, ordered set of match / action / stop rules that route a user's
per-event email and Telegram notifications.
