---
title: Social Login Setup
description: Configure OAuth sources in Prism — built-in providers (GitHub, Google, Microsoft, Discord, Telegram) and custom Generic OIDC / OAuth 2.0 providers.
---

# Social Login Setup

Prism supports social login through **OAuth Sources** — named, independently configured OAuth connections. You can have multiple sources of the same provider type (e.g. "GitHub (Work)" and "GitHub (Personal)") and add custom providers using the Generic OIDC or Generic OAuth 2 types.

OAuth Sources are managed in **Admin → OAuth Sources** (not in Settings). Each source has a unique **slug** that appears in its callback URL:

```
https://<your-prism-domain>/api/connections/<slug>/callback
```

> **Note:** Telegram's flow is different from standard OAuth — instead of a redirect callback URL, it uses a verified origin domain. The callback URL format above does not apply to Telegram. See the [Telegram section](#telegram) for details.

## Built-in Providers

### GitHub

#### 1. Create a GitHub OAuth App

1. Go to [GitHub Developer Settings → OAuth Apps](https://github.com/settings/developers) and click **New OAuth App**.
2. Fill in the form:

   | Field                      | Value                                                       |
   |----------------------------|-------------------------------------------------------------|
   | Application name           | Your site name                                              |
   | Homepage URL               | `https://your-prism-domain`                                 |
   | Authorization callback URL | `https://your-prism-domain/api/connections/<slug>/callback` |

3. Click **Register application**.
4. Copy the **Client ID**.
5. Click **Generate a new client secret** and copy the secret immediately — it is only shown once.

#### 2. Add the source in Prism

Go to **Admin → OAuth Sources → Add source**:

| Field         | Value                            |
|---------------|----------------------------------|
| Slug          | `github` (or any unique key)     |
| Provider      | **GitHub**                       |
| Display name  | `GitHub` (shown on login button) |
| Client ID     | Paste from GitHub                |
| Client Secret | Paste from GitHub                |

Save. The button appears on the login page immediately.

#### Notes

- Prism requests the `user:email` scope so the email is returned even if it is set to private.
- If a GitHub user has no public email and their email is private, GitHub returns a list — Prism picks the primary verified one.
- GitHub does not support OpenID Connect. Prism uses their REST API (`/user`, `/user/emails`).

### Google

#### 1. Create a Google OAuth 2.0 Client

1. Open the [Google Cloud Console](https://console.cloud.google.com) and select or create a project.
2. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
3. Configure the **OAuth consent screen** if prompted:
   - User type: **External**
   - Authorized domains: your Prism domain
   - Scopes: `openid`, `email`, `profile`
4. Fill in **Create OAuth client ID**:

   | Field                         | Value                                                       |
   |-------------------------------|-------------------------------------------------------------|
   | Application type              | **Web application**                                         |
   | Authorized JavaScript origins | `https://your-prism-domain`                                 |
   | Authorized redirect URIs      | `https://your-prism-domain/api/connections/<slug>/callback` |

5. Copy the **Client ID** and **Client Secret**.

#### 2. Add the source in Prism

Go to **Admin → OAuth Sources → Add source**, choose **Provider: Google**, set a slug (e.g. `google`), and paste the credentials.

#### Notes

- Google uses OpenID Connect. Prism requests `openid email profile`.
- New projects start in **testing** mode — publish the consent screen for public access.
- Unverified apps show a warning screen. Submit for verification for external users.

### Microsoft

#### 1. Register an Azure AD Application

1. Open [Azure Portal → App registrations](https://portal.azure.com/#blade/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/RegisteredApps) and click **New registration**.
2. Fill in the form:

   | Field                   | Value                                                                           |
   |-------------------------|---------------------------------------------------------------------------------|
   | Name                    | Your site name                                                                  |
   | Supported account types | **Accounts in any organizational directory and personal Microsoft accounts**    |
   | Redirect URI            | Platform: **Web** — `https://your-prism-domain/api/connections/<slug>/callback` |

3. Click **Register**.
4. Copy the **Application (client) ID** from the Overview page.
5. Go to **Certificates & secrets → New client secret** and copy the **Value**.

#### 2. Add the source in Prism

Go to **Admin → OAuth Sources → Add source**, choose **Provider: Microsoft**, set a slug (e.g. `microsoft`), and paste the credentials.

#### Notes

- Prism uses the `common` tenant endpoint so both personal (Outlook/Hotmail) and work/school (Azure AD) accounts can log in.
- Restrict to a single tenant via **Supported account types** if needed.
- Client secrets expire — rotate before expiry to avoid silent failures.

### Discord

#### 1. Create a Discord Application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. Go to **OAuth2 → General**:
   - Copy the **Client ID**.
   - Click **Reset Secret**, confirm, and copy the **Client Secret**.
   - Under **Redirects**, add:
     ```
     https://your-prism-domain/api/connections/<slug>/callback
     ```
3. Save changes.

#### 2. Add the source in Prism

Go to **Admin → OAuth Sources → Add source**, choose **Provider: Discord**, set a slug (e.g. `discord`), and paste the credentials.

#### Notes

- Prism requests `identify email`. `identify` gives username and avatar; `email` gives verified email.
- If a Discord user has no email set, Prism rejects the login with an error.
- Discord does not support OpenID Connect. Prism uses `/users/@me`.

### Telegram

Telegram uses a widget-based authentication flow instead of standard OAuth. There is no authorization code exchange — after the user confirms login in Telegram, their profile data is sent directly to the callback URL as query parameters signed with an HMAC derived from your bot token.

#### 1. Create a Telegram Bot

1. Open a chat with [@BotFather](https://t.me/BotFather) and run `/newbot`.
2. Follow the prompts to set a name and username for the bot.
3. BotFather will give you a **bot token** in the format `123456789:ABCdef-GHIjkl...`. Copy it — this is the **Client Secret** in Prism.
4. The **numeric part before the colon** (e.g. `123456789`) is the **Bot ID** — this is the **Client ID** in Prism.

#### 2. Whitelist your domain

Telegram requires the origin domain to be registered with BotFather before it allows logins:

1. In the same BotFather chat, run `/setdomain`.
2. Select your bot.
3. Enter your Prism domain (without path), e.g. `https://your-prism-domain`.

::: warning
You must set the domain in BotFather **before** attempting a Telegram login. Logins from unregistered origins will fail with an invalid signature error.
:::

#### 3. Add the source in Prism

Go to **Admin → OAuth Sources → Add source**:

| Field         | Value                                             |
|---------------|---------------------------------------------------|
| Slug          | `telegram` (or any unique key)                    |
| Provider      | **Telegram**                                      |
| Display name  | `Telegram` (shown on login button)                |
| Client ID     | Bot numeric ID (the number before `:` in the token) |
| Client Secret | Full bot token (`123456789:ABCdef...`)             |

Save. The button appears on the login page immediately.

#### Notes

- **Telegram does not provide an email address.** Users who register through Telegram will have a placeholder email (`telegram_<id>@prism.local`) and no email verification. They can add and verify a real email from their profile settings after registering.
- The auth data timestamp (`auth_date`) is verified server-side — sessions older than 24 hours are rejected.
- Unlike other providers, there is no redirect callback URL to register with the provider. Telegram routes via the whitelisted origin domain set in BotFather, not a registered redirect URI.
- Telegram does not support multiple account linking with the same bot by default. Each user's Telegram account can be linked to one Prism account per source slug.

## Generic OpenID Connect

Use **Provider: Generic OpenID Connect** to add any OIDC-compliant identity provider (Keycloak, Okta, Auth0, Authentik, Zitadel, etc.).

### OIDC Discovery (recommended)

When adding a Generic OIDC source, enter the **Issuer URL** and click **Discover**. Prism will fetch `{issuer}/.well-known/openid-configuration` and auto-fill the three endpoint URLs.

| Field        | Example                        |
|--------------|--------------------------------|
| Issuer URL   | `https://accounts.example.com` |
| Auth URL     | Auto-filled from discovery     |
| Token URL    | Auto-filled from discovery     |
| Userinfo URL | Auto-filled from discovery     |

### Manual configuration

If your provider does not publish a discovery document, fill in the three URLs directly:

| Field        | Example                                         |
|--------------|-------------------------------------------------|
| Auth URL     | `https://accounts.example.com/oauth2/authorize` |
| Token URL    | `https://accounts.example.com/oauth2/token`     |
| Userinfo URL | `https://accounts.example.com/oauth2/userinfo`  |

### Scopes

The **Scopes** field defaults to `openid email profile` if left empty. Set a custom space-separated scope list if your provider requires different scopes.

### Profile mapping

Prism maps the userinfo response using standard OIDC claims:

| Prism field  | OIDC claim                    |
|--------------|-------------------------------|
| Provider ID  | `sub`                         |
| Display name | `name` → `preferred_username` |
| Username     | `preferred_username` → `sub`  |
| Avatar       | `picture`                     |
| Email        | `email`                       |

### Callback URL

```
https://your-prism-domain/api/connections/<slug>/callback
```

Register this in your identity provider's allowed redirect URIs.

## Generic OAuth 2.0

Use **Provider: Generic OAuth 2** for providers that are OAuth 2.0 but not OIDC-compliant (e.g. GitLab with a custom userinfo path, Gitea, or internal services).

Unlike Generic OIDC, there is no discovery — all three endpoint URLs must be entered manually. Prism calls the userinfo endpoint with the access token and tries to map common fields (`sub`/`id`, `name`/`login`/`username`, `picture`/`avatar_url`, `email`).

## Multiple Sources of the Same Provider

Each source has an independent slug, client ID, and secret. You can add as many sources of the same provider type as needed:

| Slug           | Provider | Display name       |
|----------------|----------|--------------------|
| `github-work`  | GitHub   | GitHub (Work)      |
| `github-oss`   | GitHub   | GitHub (Personal)  |
| `google`       | Google   | Google             |
| `keycloak-dev` | OIDC     | Internal SSO (Dev) |

All enabled sources appear as separate buttons on the login and registration pages.

## Local Development

For local testing, register OAuth apps using `http://localhost:5173` as the domain. Use the slug you plan to use in production:

```
http://localhost:5173/api/connections/<slug>/callback
```

::: tip
Google and Microsoft require HTTPS for production redirect URIs but allow `http://localhost` for development. GitHub and Discord allow plain HTTP localhost URIs.
:::

::: warning Telegram and localhost
Telegram requires HTTPS origins and does not allow plain `http://localhost`. For local Telegram testing you need a public HTTPS URL — use a tunneling tool such as [cloudflared tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) or ngrok, and register that URL with BotFather (`/setdomain`).
:::

## Troubleshooting

**Redirect URI mismatch** — The callback URL registered with the provider must match exactly (slug included, no trailing slash difference, correct scheme). Check that the slug in the OAuth Source matches what you registered.

**User gets a new account on every login** — Social connections are matched by `(source_slug, provider_user_id)`. If the slug changed, old connections become orphaned. Use **Profile → Linked Accounts** to reconnect.

**Email already taken on first social login** — If an account with the same email exists from password registration, Prism rejects the social login with a conflict. The user must log in with their password first, then connect the provider from **Profile → Linked Accounts**.

**Telegram: invalid signature** — The HMAC check on the auth data failed. This usually means the **Client Secret** in Prism does not match the bot token, or the origin domain has not been registered with BotFather (`/setdomain`). Confirm both and try again.

**Telegram: auth expired** — The Telegram auth session is older than 24 hours. This can happen if the user left the auth tab open for a long time. Ask the user to start the login flow again.

**Generic OIDC discovery fails** — Ensure the issuer URL uses HTTPS and the provider publishes `{issuer}/.well-known/openid-configuration`. The worker fetches this server-side (no CORS issue), but an unreachable or slow provider will cause a timeout.
