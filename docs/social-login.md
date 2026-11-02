---
title: Social Login Setup
description: Configure OAuth sources in Prism — built-in providers (GitHub, Google, Microsoft, Discord, Telegram, X, Cloudflare) and custom Generic OIDC / OAuth 2.0 providers.
---

# Social Login Setup

Prism supports social login through **OAuth sources** — named, independently configured connections. You can have several sources of the same provider (say "GitHub (Work)" and "GitHub (Personal)") and add your own providers with the Generic OIDC or Generic OAuth 2 types.

Sources are managed in **Admin → OAuth Sources**. Each has a unique **slug** that appears in its callback URL:

```
https://<your-prism-domain>/api/connections/<slug>/callback
```

> **Note:** Telegram doesn't use a callback URL. It uses a verified origin domain instead. See [Telegram](#telegram).

For every provider, the steps are the same: create an OAuth app at the provider with the callback URL above, then add a source in Prism with the client ID and secret. The button appears on the login page right away.

## Built-in Providers

### GitHub

1. Go to [GitHub Developer Settings → OAuth Apps](https://github.com/settings/developers) and click **New OAuth App**.
2. Set **Homepage URL** to `https://your-prism-domain` and **Authorization callback URL** to `https://your-prism-domain/api/connections/<slug>/callback`.
3. Register the app, copy the **Client ID**, then generate a client secret and copy it right away; it's shown once.
4. In Prism, go to **Admin → OAuth Sources → Add source**. Set **Provider** to **GitHub**, pick a slug (e.g. `github`), a display name, and paste the credentials.

Prism asks for the `user:email` scope so it can get the email even if it's private, and picks the primary verified one.

### Google

1. Open the [Google Cloud Console](https://console.cloud.google.com), select or create a project, then go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. If asked to configure the **OAuth consent screen**: user type **External**, authorized domain your Prism domain, scopes `openid`, `email`, `profile`.
3. Choose **Web application**. Add `https://your-prism-domain` as an authorized JavaScript origin and the callback URL as an authorized redirect URI.
4. Copy the **Client ID** and **Client Secret**.
5. In Prism, add a source with **Provider: Google**.

New Google projects start in testing mode. Publish the consent screen to let anyone sign in; unverified apps show a warning until Google verifies them.

### Microsoft

1. Open [Azure Portal → App registrations](https://portal.azure.com/#blade/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/RegisteredApps) and click **New registration**.
2. Set **Supported account types** to **Accounts in any organizational directory and personal Microsoft accounts**, and add a **Web** redirect URI with the callback URL.
3. Copy the **Application (client) ID**. Under **Certificates & secrets**, create a client secret and copy its **Value**.
4. In Prism, add a source with **Provider: Microsoft**.

Both personal (Outlook/Hotmail) and work/school accounts can sign in. Restrict it to one tenant through **Supported account types** if you need to. Client secrets expire, so rotate them before they do.

### Discord

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. Under **OAuth2 → General**, copy the **Client ID**, reset and copy the **Client Secret**, and add the callback URL under **Redirects**.
3. In Prism, add a source with **Provider: Discord**.

If a Discord user has no email on their account, the login is rejected.

### Telegram

Telegram uses a login widget rather than standard OAuth: after the user confirms in Telegram, their signed profile data goes straight to Prism.

1. Chat with [@BotFather](https://t.me/BotFather) and run `/newbot`. BotFather gives you a **bot token** like `123456789:ABCdef-GHIjkl...`. This is the **Client Secret** in Prism. The number before the colon is the bot ID, which is the **Client ID**.
2. Run `/setdomain`, select your bot, and enter your Prism domain (e.g. `https://your-prism-domain`).

::: warning
Set the domain in BotFather **before** the first Telegram login. Logins from unregistered origins fail with an invalid signature error.
:::

3. In Prism, add a source with **Provider: Telegram**, the bot ID as **Client ID** and the full bot token as **Client Secret**.

Notes:

- Telegram doesn't provide an email. Users who register this way get a placeholder address and an unverified email; they can add and verify a real one in their profile settings.
- A Telegram login older than 24 hours is rejected.
- The same bot token also delivers Telegram [notifications](notifications.md#telegram-setup).

### X (Twitter)

1. Open the [X Developer Portal](https://developer.x.com/en/portal/dashboard), pick or create a project, and create an **App**.
2. Under **User authentication settings**, click **Set up**. Choose **Read** permissions and the type **Web App, Automated App or Bot**. Set the **Callback URI** to the callback URL and the **Website URL** to your Prism domain.
3. On the **Keys and tokens** tab, copy the **OAuth 2.0 Client ID** and **Client Secret** (shown once).
4. In Prism, add a source with **Provider: X (Twitter)**.

X doesn't provide an email through its API, so these users also get a placeholder, unverified email. Prism asks for the `offline.access` scope so tokens can be refreshed.

### Cloudflare

**Sign in with Cloudflare** lets users sign in with their Cloudflare account. You don't enter any endpoint URLs.

::: warning Do not request `openid`
Cloudflare's OAuth clients can't request the `openid` scope; the authorize step fails with `invalid_scope`. Prism uses `user-details.read` instead.
:::

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/?to=/:account/oauth-clients), go to **Manage Account → OAuth clients → Create client**.
2. Set **Response type** to `code`, **Grant type** to `authorization_code` (add `refresh_token` to allow token refresh), **Token authentication method** to **Client secret post**, and **Redirect URLs** to the callback URL.
3. For scopes, select **User Details Read** (`user-details.read`), and add `offline_access` if you enabled `refresh_token`.
4. Create the client and copy the **Client ID** and **Client Secret** right away.
5. In Prism, add a source with **Provider: Cloudflare**.

Notes:

- Cloudflare doesn't say whether an email is verified, so Prism doesn't trust it. Users get a placeholder, unverified email and can add a real one later.
- A new OAuth client is **private**: only members of the Cloudflare account that created it can sign in. To let any Cloudflare user sign in, meet Cloudflare's requirements and make the client **public** (this can't be undone).

## Generic OpenID Connect

Choose **Provider: Generic OpenID Connect** to add any OIDC provider (Keycloak, Okta, Auth0, Authentik, Zitadel, …).

**With discovery (recommended):** enter the **Issuer URL**, e.g. `https://accounts.example.com`, and click **Discover**. Prism reads `{issuer}/.well-known/openid-configuration` and fills in the **Auth URL**, **Token URL** and **Userinfo URL**.

**Manually:** if your provider has no discovery document, fill in the three URLs yourself, e.g. `https://accounts.example.com/oauth2/authorize`, `/oauth2/token` and `/oauth2/userinfo`.

The **Scopes** field defaults to `openid email profile`; set your own space-separated list if the provider needs different scopes.

Prism maps the userinfo response like this:

| Prism field  | OIDC claim                    |
| ------------ | ----------------------------- |
| Provider ID  | `sub`                         |
| Display name | `name` → `preferred_username` |
| Username     | `preferred_username` → `sub`  |
| Avatar       | `picture`                     |
| Email        | `email`                       |

Register the callback URL in your provider's allowed redirect URIs.

## Generic OAuth 2.0

Choose **Provider: Generic OAuth 2** for providers that speak OAuth 2.0 but not OIDC (Gitea, a GitLab with a custom userinfo path, internal services). There's no discovery, so enter all three endpoint URLs by hand. Prism calls the userinfo endpoint and maps common fields (`sub`/`id`, `name`/`login`/`username`, `picture`/`avatar_url`, `email`).

## Multiple Sources of the Same Provider

Each source has its own slug and credentials, so you can add as many as you need:

| Slug           | Provider | Display name       |
| -------------- | -------- | ------------------ |
| `github-work`  | GitHub   | GitHub (Work)      |
| `github-oss`   | GitHub   | GitHub (Personal)  |
| `google`       | Google   | Google             |
| `keycloak-dev` | OIDC     | Internal SSO (Dev) |

Every enabled source gets its own button on the login and registration pages.

## Cookies

Social login needs cookies to be enabled for the Prism site. Finish a login in the same browser that started it; a callback URL copied into another browser or profile is rejected with `invalid_state`. If you see that, just start again.

## Local Development

For local testing, register OAuth apps with `http://localhost:5173` as the domain:

```
http://localhost:5173/api/connections/<slug>/callback
```

::: tip
Google and Microsoft allow `http://localhost` for development even though they require HTTPS in production. GitHub and Discord allow plain HTTP localhost URIs.
:::

::: warning Telegram and localhost
Telegram requires HTTPS and doesn't allow `http://localhost`. For local testing use a public HTTPS URL from a tunnel such as [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) or ngrok, and register it with BotFather (`/setdomain`).
:::

## Troubleshooting

**Redirect URI mismatch** — The callback URL registered with the provider must match exactly: slug, scheme and trailing slash included.

**User gets a new account on every login** — Connections are matched by source slug and the provider's user ID. If you changed the slug, old connections no longer match. Users can reconnect from **Profile → Linked Accounts**.

**Email already taken on first social login** — An account with that email already exists from password registration. The user must sign in with their password first, then connect the provider from **Profile → Linked Accounts**.

**Telegram: invalid signature** — The **Client Secret** doesn't match the bot token, or the domain isn't registered with BotFather (`/setdomain`). Check both.

**Telegram: auth expired** — The Telegram login is older than 24 hours. Start the login again.

**Generic OIDC discovery fails** — Make sure the issuer URL uses HTTPS and the provider publishes `{issuer}/.well-known/openid-configuration`, and that the provider is reachable.
