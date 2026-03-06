---
title: Social Login Setup
description: Step-by-step setup guides for GitHub, Google, Microsoft, and Discord OAuth integrations in Prism.
---

# Social Login Setup

Prism supports social login via GitHub, Google, Microsoft, and Discord. Each provider requires you to register an OAuth application in their developer console, then enter the credentials in **Admin → Settings → Social Login**.

All callback URLs follow this pattern:

```
https://<your-prism-domain>/api/connections/<provider>/callback
```

---

## GitHub

### 1. Create a GitHub OAuth App

1. Go to [GitHub Developer Settings → OAuth Apps](https://github.com/settings/developers) and click **New OAuth App**.
2. Fill in the form:

   | Field | Value |
   | --- | --- |
   | Application name | Your site name |
   | Homepage URL | `https://your-prism-domain` |
   | Authorization callback URL | `https://your-prism-domain/api/connections/github/callback` |

3. Click **Register application**.
4. On the app page, copy the **Client ID**.
5. Click **Generate a new client secret** and copy the secret immediately — it is only shown once.

### 2. Enter credentials in Prism

Go to **Admin → Settings → Social Login** and paste the Client ID and Client Secret into the GitHub fields. Save.

GitHub login will appear on the login and registration pages immediately.

### Notes

- GitHub OAuth Apps grant access to public profile info and email by default. Prism requests the `user:email` scope to ensure the email is always returned even if it is set to private.
- If a GitHub user has no public email and their email is private, GitHub returns a list of emails — Prism picks the primary verified one.
- GitHub does not support OpenID Connect. Prism uses their REST API (`/user`, `/user/emails`) to fetch the profile.

---

## Google

### 1. Create a Google OAuth 2.0 Client

1. Open the [Google Cloud Console](https://console.cloud.google.com) and select or create a project.
2. Go to **APIs & Services → Credentials** and click **Create Credentials → OAuth client ID**.
3. If prompted, configure the **OAuth consent screen** first:
   - User type: **External** (unless this is a Google Workspace internal app)
   - Add your domain to **Authorized domains**
   - Add scopes: `openid`, `email`, `profile`
4. Back in **Create OAuth client ID**:

   | Field | Value |
   | --- | --- |
   | Application type | **Web application** |
   | Authorized JavaScript origins | `https://your-prism-domain` |
   | Authorized redirect URIs | `https://your-prism-domain/api/connections/google/callback` |

5. Copy the **Client ID** and **Client Secret**.

### 2. Enter credentials in Prism

Go to **Admin → Settings → Social Login** and paste into the Google fields. Save.

### Notes

- Google uses OpenID Connect. Prism requests the `openid email profile` scopes.
- New Google Cloud projects start with the consent screen in **testing** mode, which limits login to test users you explicitly add. Publish the consent screen to allow any Google account to log in.
- If your app is unverified, Google shows a warning screen. Submit for verification if you expect external users.

---

## Microsoft

### 1. Register an Azure AD Application

1. Open the [Azure Portal → App registrations](https://portal.azure.com/#blade/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/RegisteredApps) and click **New registration**.
2. Fill in the form:

   | Field | Value |
   | --- | --- |
   | Name | Your site name |
   | Supported account types | **Accounts in any organizational directory and personal Microsoft accounts** (for broadest compatibility) |
   | Redirect URI | Platform: **Web** — `https://your-prism-domain/api/connections/microsoft/callback` |

3. Click **Register**.
4. On the **Overview** page, copy the **Application (client) ID**.
5. Go to **Certificates & secrets → New client secret**, set an expiry, and copy the **Value** (not the Secret ID).

### 2. Enter credentials in Prism

Go to **Admin → Settings → Social Login** and paste into the Microsoft fields. Save.

### Notes

- Prism requests the `openid email profile` scopes via the `common` tenant endpoint, so both personal (Outlook/Hotmail) and work/school (Azure AD) accounts can log in.
- If you restrict **Supported account types** to a single tenant, only users in that Azure AD tenant can authenticate.
- Client secrets expire. Set a calendar reminder to rotate the secret before it expires — an expired secret will break Microsoft login silently.

---

## Discord

### 1. Create a Discord Application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. Give it a name and click **Create**.
3. Go to **OAuth2 → General**:
   - Copy the **Client ID**.
   - Click **Reset Secret**, confirm, and copy the **Client Secret**.
   - Under **Redirects**, click **Add Redirect** and enter:
     ```
     https://your-prism-domain/api/connections/discord/callback
     ```
4. Save changes.

### 2. Enter credentials in Prism

Go to **Admin → Settings → Social Login** and paste into the Discord fields. Save.

### Notes

- Prism requests the `identify email` scopes. `identify` gives access to the user's username and avatar; `email` gives their verified email address.
- Discord usernames are unique. If a Discord user has no email set (rare for verified accounts), Prism will reject the login with an error asking the user to add an email to their Discord account.
- Discord does not support OpenID Connect. Prism uses their REST API (`/users/@me`) to fetch the profile.

---

## Local development

For local testing, register a separate OAuth app per provider using `http://localhost:8787` as the domain:

| Provider | Callback URL |
| --- | --- |
| GitHub | `http://localhost:8787/api/connections/github/callback` |
| Google | `http://localhost:8787/api/connections/google/callback` |
| Microsoft | `http://localhost:8787/api/connections/microsoft/callback` |
| Discord | `http://localhost:8787/api/connections/discord/callback` |

::: tip
Some providers (Google, Microsoft) require HTTPS for production redirect URIs but allow `http://localhost` for development. GitHub and Discord allow plain HTTP localhost URIs as well.
:::

Add the development credentials to your `.dev.vars` file by setting them through **Admin → Settings → Social Login** while running `pnpm worker:dev`, or set them directly in the database:

```bash
wrangler d1 execute prism-db --local --command \
  "UPDATE site_config SET value = '\"your-dev-client-id\"' WHERE key = 'github_client_id'"
```

---

## Troubleshooting

**Redirect URI mismatch** — The callback URL registered with the provider must match exactly (including trailing slashes and `http`/`https`). Check `APP_URL` in `wrangler.jsonc` matches the domain you registered.

**User gets a new account on every login** — Social connections are matched by `(provider, provider_user_id)`. If the user logged in with a different Prism account before, they will be connected to that account. Use **Profile → Connections** to link providers to an existing account.

**Email already taken on first social login** — If an account with the same email already exists (from password registration), Prism rejects the social login with a conflict error. The user must log in with their password first, then connect the social provider from **Profile → Connections**.
