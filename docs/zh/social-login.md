---
title: 社交登录配置
description: 在 Prism 中配置 OAuth 来源——内置提供商（GitHub、Google、Microsoft、Discord、Telegram、X、Cloudflare）以及自定义通用 OIDC / OAuth 2.0 提供商。
---

# 社交登录配置

Prism 通过 **OAuth 来源**支持社交登录——每个来源是一个独立命名的、单独配置的连接。你可以添加同一提供商的多个来源（比如「GitHub（工作）」和「GitHub（个人）」），也可以使用通用 OIDC 或通用 OAuth 2 类型添加自己的提供商。

来源在 **管理 → OAuth 来源** 中管理。每个来源有唯一的 **slug**，会出现在其回调 URL 中：

```
https://<your-prism-domain>/api/connections/<slug>/callback
```

> **注意：** Telegram 不使用回调 URL，而是使用已验证的来源域名。详见 [Telegram](#telegram)。

对所有提供商而言步骤都相同：在提供商处使用上面的回调 URL 创建 OAuth 应用，然后在 Prism 中填写 Client ID 和 Client Secret 添加来源。登录页面会立即出现该按钮。

## 内置提供商

### GitHub

1. 前往 [GitHub Developer Settings → OAuth Apps](https://github.com/settings/developers)，点击 **New OAuth App**。
2. 将 **Homepage URL** 设为 `https://your-prism-domain`，**Authorization callback URL** 设为 `https://your-prism-domain/api/connections/<slug>/callback`。
3. 注册应用，复制 **Client ID**，然后生成客户端密钥并立即复制——它只显示一次。
4. 在 Prism 中进入 **管理 → OAuth 来源 → 添加来源**。将**提供商**设为 **GitHub**，选择 slug（如 `github`）、显示名称，并粘贴凭据。

Prism 会请求 `user:email` 权限范围，以便即使邮箱为私密也能获取，并选取主要的已验证邮箱。

### Google

1. 打开 [Google Cloud Console](https://console.cloud.google.com)，选择或创建项目，然后进入 **APIs & Services → Credentials → Create Credentials → OAuth client ID**。
2. 如果要求配置 **OAuth 同意屏幕**：用户类型选 **External**，授权域名填你的 Prism 域名，权限范围 `openid`、`email`、`profile`。
3. 选择 **Web application**。将 `https://your-prism-domain` 添加为授权的 JavaScript 来源，将回调 URL 添加为授权的重定向 URI。
4. 复制 **Client ID** 和 **Client Secret**。
5. 在 Prism 中添加来源，**提供商：Google**。

新建的 Google 项目默认处于测试模式。发布同意屏幕后任何人才能登录；在 Google 完成验证之前，未经验证的应用会显示警告。

### Microsoft

1. 打开 [Azure Portal → App registrations](https://portal.azure.com/#blade/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/RegisteredApps)，点击 **New registration**。
2. 将 **Supported account types** 设为 **Accounts in any organizational directory and personal Microsoft accounts**，并添加 **Web** 重定向 URI（回调 URL）。
3. 复制 **Application (client) ID**。在 **Certificates & secrets** 下创建客户端密钥并复制其 **Value**。
4. 在 Prism 中添加来源，**提供商：Microsoft**。

个人账号（Outlook/Hotmail）与工作/学校账号均可登录。如需限制为单个租户，可通过 **Supported account types** 设置。客户端密钥会过期，请在到期前轮换。

### Discord

1. 打开 [Discord Developer Portal](https://discord.com/developers/applications)，点击 **New Application**。
2. 在 **OAuth2 → General** 下复制 **Client ID**，重置并复制 **Client Secret**，并在 **Redirects** 下添加回调 URL。
3. 在 Prism 中添加来源，**提供商：Discord**。

如果 Discord 用户账号没有邮箱，登录会被拒绝。

### Telegram

Telegram 使用登录小部件而非标准 OAuth：用户在 Telegram 中确认后，其签名资料数据会直接发送到 Prism。

1. 与 [@BotFather](https://t.me/BotFather) 对话并运行 `/newbot`。BotFather 会给你一个**机器人令牌**，形如 `123456789:ABCdef-GHIjkl...`。这就是 Prism 中的 **Client Secret**。冒号前的数字是机器人 ID，即 **Client ID**。
2. 运行 `/setdomain`，选择你的机器人，并输入你的 Prism 域名（如 `https://your-prism-domain`）。

::: warning
务必在首次 Telegram 登录**之前**在 BotFather 中设置域名。来自未注册来源的登录会因签名无效而失败。
:::

3. 在 Prism 中添加来源，**提供商：Telegram**，**Client ID** 填机器人 ID，**Client Secret** 填完整机器人令牌。

说明：

- Telegram 不提供邮箱。通过这种方式注册的用户会得到一个占位地址和未验证的邮箱；他们可以在个人资料设置中添加并验证真实邮箱。
- 超过 24 小时的 Telegram 登录会被拒绝。
- 同一机器人令牌也用于发送 Telegram [通知](notifications.md#telegram-配置)。

### X (Twitter)

1. 打开 [X Developer Portal](https://developer.x.com/en/portal/dashboard)，选择或创建项目，并创建一个 **App**。
2. 在 **User authentication settings** 下点击 **Set up**。选择 **Read** 权限和 **Web App, Automated App or Bot** 类型。将 **Callback URI** 设为回调 URL，**Website URL** 设为你的 Prism 域名。
3. 在 **Keys and tokens** 标签页复制 **OAuth 2.0 Client ID** 和 **Client Secret**（只显示一次）。
4. 在 Prism 中添加来源，**提供商：X (Twitter)**。

X 的 API 不提供邮箱，因此这些用户同样会得到一个占位、未验证的邮箱。Prism 会请求 `offline.access` 权限范围以便刷新令牌。

### Cloudflare

**使用 Cloudflare 登录**让用户以其 Cloudflare 账号登录。你无需填写任何端点 URL。

::: warning 不要请求 `openid`
Cloudflare 的 OAuth 客户端无法请求 `openid` 权限范围；授权步骤会以 `invalid_scope` 失败。Prism 改用 `user-details.read`。
:::

1. 在 [Cloudflare 控制台](https://dash.cloudflare.com/?to=/:account/oauth-clients)，进入 **Manage Account → OAuth clients → Create client**。
2. 将 **Response type** 设为 `code`，**Grant type** 设为 `authorization_code`（如需令牌刷新再加上 `refresh_token`），**Token authentication method** 设为 **Client secret post**，**Redirect URLs** 设为回调 URL。
3. 权限范围选择 **User Details Read**（`user-details.read`），如果启用了 `refresh_token` 再加上 `offline_access`。
4. 创建客户端并立即复制 **Client ID** 和 **Client Secret**。
5. 在 Prism 中添加来源，**提供商：Cloudflare**。

说明：

- Cloudflare 不会说明邮箱是否已验证，因此 Prism 不信任它。用户会得到占位、未验证的邮箱，之后可以添加真实邮箱。
- 新建的 OAuth 客户端是**私有**的：只有创建它的 Cloudflare 账号成员才能登录。要让任意 Cloudflare 用户登录，需满足 Cloudflare 的要求并将客户端改为**公开**（此操作不可撤销）。

## 通用 OpenID Connect

选择 **提供商：通用 OpenID Connect** 即可添加任意 OIDC 提供商（Keycloak、Okta、Auth0、Authentik、Zitadel……）。

**使用自动发现（推荐）：** 输入 **Issuer URL**（如 `https://accounts.example.com`），点击 **Discover**。Prism 会读取 `{issuer}/.well-known/openid-configuration` 并填充 **Auth URL**、**Token URL** 和 **Userinfo URL**。

**手动配置：** 如果提供商没有发现文档，自行填写三个 URL，例如 `https://accounts.example.com/oauth2/authorize`、`/oauth2/token` 和 `/oauth2/userinfo`。

**Scopes** 字段默认为 `openid email profile`；如果提供商需要不同的权限范围，填写你自己的以空格分隔的列表。

Prism 按如下方式映射 userinfo 响应：

| Prism 字段 | OIDC 声明                     |
| ---------- | ----------------------------- |
| 提供商 ID  | `sub`                         |
| 显示名称   | `name` → `preferred_username` |
| 用户名     | `preferred_username` → `sub`  |
| 头像       | `picture`                     |
| 邮箱       | `email`                       |

在你的提供商允许的重定向 URI 中注册回调 URL。

## 通用 OAuth 2.0

对于使用 OAuth 2.0 但不是 OIDC 的提供商（Gitea、自定义 userinfo 路径的 GitLab、内部服务），选择 **提供商：通用 OAuth 2**。没有自动发现，因此需要手动填写全部三个端点 URL。Prism 调用 userinfo 端点并映射常见字段（`sub`/`id`、`name`/`login`/`username`、`picture`/`avatar_url`、`email`）。

## 同一提供商的多个来源

每个来源有自己的 slug 和凭据，因此可以按需添加任意多个：

| Slug           | 提供商 | 显示名称         |
| -------------- | ------ | ---------------- |
| `github-work`  | GitHub | GitHub（工作）   |
| `github-oss`   | GitHub | GitHub（个人）   |
| `google`       | Google | Google           |
| `keycloak-dev` | OIDC   | 内部 SSO（开发） |

所有已启用的来源都会在登录和注册页面拥有各自的按钮。

## Cookie

社交登录要求为 Prism 站点启用 Cookie。请在发起登录的同一浏览器中完成登录；复制到其他浏览器或浏览器配置文件的回调 URL 会以 `invalid_state` 被拒绝。如果遇到这种情况，重新开始即可。

## 本地开发

本地测试时，使用 `http://localhost:5173` 作为域名注册 OAuth 应用：

```
http://localhost:5173/api/connections/<slug>/callback
```

::: tip
Google 和 Microsoft 在生产环境要求 HTTPS，但开发环境允许 `http://localhost`。GitHub 和 Discord 允许纯 HTTP 的 localhost URI。
:::

::: warning Telegram 与 localhost
Telegram 要求 HTTPS，不允许 `http://localhost`。本地测试请使用来自隧道（如 [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) 或 ngrok）的公网 HTTPS URL，并在 BotFather 中注册该地址（`/setdomain`）。
:::

## 常见问题

**重定向 URI 不匹配** — 在提供商处注册的回调 URL 必须完全一致：包括 slug、协议和末尾斜杠。

**每次登录都创建新账号** — 连接按来源 slug 和提供商的用户 ID 匹配。如果你更改了 slug，旧连接将不再匹配。用户可以从 **个人资料 → 关联账号** 重新连接。

**首次社交登录时提示邮箱已被占用** — 该邮箱的账号已通过密码注册存在。用户必须先使用密码登录，然后在 **个人资料 → 关联账号** 中连接该提供商。

**Telegram：签名无效** — **Client Secret** 与机器人令牌不匹配，或域名未在 BotFather 中注册（`/setdomain`）。请检查这两项。

**Telegram：认证已过期** — Telegram 登录已超过 24 小时。请重新开始登录。

**通用 OIDC 自动发现失败** — 确保 Issuer URL 使用 HTTPS，提供商发布了 `{issuer}/.well-known/openid-configuration`，且提供商可访问。
