---
title: 社交登录配置
description: 在 Prism 中配置 OAuth 来源——内置提供商（GitHub、Google、Microsoft、Discord）以及自定义通用 OIDC / OAuth 2.0 提供商。
---

# 社交登录配置

Prism 通过 **OAuth 来源**（OAuth Sources）支持社交登录——每个来源是一个独立命名的 OAuth 连接，拥有自己的 slug、凭据和显示名称。你可以添加同一提供商类型的多个来源（例如「GitHub（工作）」和「GitHub（个人）」），也可以使用通用 OIDC 或通用 OAuth 2 类型添加自定义提供商。

OAuth 来源在 **Admin → OAuth Sources** 中管理（不在 Settings 中）。每个来源有唯一的 **slug**，出现在其回调 URL 中：

```
https://<your-prism-domain>/api/connections/<slug>/callback
```

## 内置提供商

### GitHub

#### 1. 创建 GitHub OAuth 应用

1. 前往 [GitHub Developer Settings → OAuth Apps](https://github.com/settings/developers)，点击 **New OAuth App**。
2. 填写表单：

   | 字段                       | 值                                                          |
   |----------------------------|-------------------------------------------------------------|
   | Application name           | 你的站点名称                                                |
   | Homepage URL               | `https://your-prism-domain`                                 |
   | Authorization callback URL | `https://your-prism-domain/api/connections/<slug>/callback` |

3. 点击 **Register application**。
4. 复制 **Client ID**。
5. 点击 **Generate a new client secret** 并立即复制——密钥仅显示一次。

#### 2. 在 Prism 中添加来源

前往 **Admin → OAuth Sources → 添加来源**：

| 字段          | 值                         |
|---------------|----------------------------|
| Slug          | `github`（或任意唯一键）     |
| 提供商        | **GitHub**                 |
| 显示名称      | `GitHub`（显示在登录按钮上） |
| Client ID     | 从 GitHub 粘贴             |
| Client Secret | 从 GitHub 粘贴             |

保存后，登录和注册页面会立即出现该按钮。

#### 注意事项

- Prism 请求 `user:email` 权限范围，确保即使邮箱设为私密也能返回邮箱地址。
- 如果 GitHub 用户没有公开邮箱且邮箱为私密，GitHub 返回邮箱列表——Prism 选取主要的已验证邮箱。
- GitHub 不支持 OpenID Connect。Prism 使用其 REST API（`/user`、`/user/emails`）。

### Google

#### 1. 创建 Google OAuth 2.0 客户端

1. 打开 [Google Cloud Console](https://console.cloud.google.com)，选择或创建一个项目。
2. 前往 **APIs & Services → Credentials → Create Credentials → OAuth client ID**。
3. 如果需要，先配置 **OAuth 同意屏幕**：
   - 用户类型：**External**
   - 授权域名：你的 Prism 域名
   - 权限范围：`openid`、`email`、`profile`
4. 填写 **Create OAuth client ID**：

   | 字段                          | 值                                                          |
   |-------------------------------|-------------------------------------------------------------|
   | Application type              | **Web application**                                         |
   | Authorized JavaScript origins | `https://your-prism-domain`                                 |
   | Authorized redirect URIs      | `https://your-prism-domain/api/connections/<slug>/callback` |

5. 复制 **Client ID** 和 **Client Secret**。

#### 2. 在 Prism 中添加来源

前往 **Admin → OAuth Sources → 添加来源**，选择 **提供商：Google**，设置 slug（如 `google`），粘贴凭据。

#### 注意事项

- Google 使用 OpenID Connect，Prism 请求 `openid email profile`。
- 新项目同意屏幕默认处于**测试**模式，仅允许已添加的测试用户登录。发布同意屏幕后，任意 Google 账号均可登录。
- 未经验证的应用会显示警告屏幕，如预计有外部用户请提交验证。

### Microsoft

#### 1. 注册 Azure AD 应用程序

1. 打开 [Azure 门户 → 应用注册](https://portal.azure.com/#blade/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/RegisteredApps)，点击 **New registration**。
2. 填写表单：

   | 字段                    | 值                                                                             |
   |-------------------------|--------------------------------------------------------------------------------|
   | Name                    | 你的站点名称                                                                   |
   | Supported account types | **Accounts in any organizational directory and personal Microsoft accounts**   |
   | Redirect URI            | 平台选择 **Web** — `https://your-prism-domain/api/connections/<slug>/callback` |

3. 点击 **Register**。
4. 从 Overview 页面复制 **Application (client) ID**。
5. 前往 **Certificates & secrets → New client secret**，复制 **Value**（不是 Secret ID）。

#### 2. 在 Prism 中添加来源

前往 **Admin → OAuth Sources → 添加来源**，选择 **提供商：Microsoft**，设置 slug（如 `microsoft`），粘贴凭据。

#### 注意事项

- Prism 通过 `common` 租户端点请求 `openid email profile`，个人账号（Outlook/Hotmail）和工作/学校账号（Azure AD）均可登录。
- 如需限制特定租户，调整 Supported account types 即可。
- 客户端密钥会过期，请设置提醒在到期前轮换。

### Discord

#### 1. 创建 Discord 应用程序

1. 打开 [Discord Developer Portal](https://discord.com/developers/applications)，点击 **New Application**。
2. 前往 **OAuth2 → General**：
   - 复制 **Client ID**。
   - 点击 **Reset Secret**，确认后复制 **Client Secret**。
   - 在 **Redirects** 下添加：
     ```
     https://your-prism-domain/api/connections/<slug>/callback
     ```
3. 保存更改。

#### 2. 在 Prism 中添加来源

前往 **Admin → OAuth Sources → 添加来源**，选择 **提供商：Discord**，设置 slug（如 `discord`），粘贴凭据。

#### 注意事项

- Prism 请求 `identify email`。`identify` 授予用户名和头像访问权限，`email` 授予已验证邮箱。
- 如果 Discord 用户未设置邮箱，Prism 将拒绝登录。
- Discord 不支持 OpenID Connect，Prism 使用 `/users/@me`。

## 通用 OpenID Connect

使用**提供商：通用 OpenID Connect** 可接入任何符合 OIDC 标准的身份提供商（Keycloak、Okta、Auth0、Authentik、Zitadel 等）。

### OIDC 自动发现（推荐）

添加通用 OIDC 来源时，填写 **Issuer URL** 后点击**自动发现**按钮。Prism 会请求 `{issuer}/.well-known/openid-configuration` 并自动填充三个端点 URL。

| 字段         | 示例                           |
|--------------|--------------------------------|
| Issuer URL   | `https://accounts.example.com` |
| 授权 URL     | 自动填充                       |
| 令牌 URL     | 自动填充                       |
| 用户信息 URL | 自动填充                       |

### 手动配置

如果提供商不发布 discovery 文档，直接填写三个 URL：

| 字段         | 示例                                            |
|--------------|-------------------------------------------------|
| 授权 URL     | `https://accounts.example.com/oauth2/authorize` |
| 令牌 URL     | `https://accounts.example.com/oauth2/token`     |
| 用户信息 URL | `https://accounts.example.com/oauth2/userinfo`  |

### 权限范围

**Scopes** 字段留空时默认为 `openid email profile`。如提供商需要不同的权限范围，填写以空格分隔的自定义列表。

### 用户信息映射

Prism 使用标准 OIDC 声明映射用户信息：

| Prism 字段 | OIDC 声明                     |
|------------|-------------------------------|
| 提供商 ID  | `sub`                         |
| 显示名称   | `name` → `preferred_username` |
| 用户名     | `preferred_username` → `sub`  |
| 头像       | `picture`                     |
| 邮箱       | `email`                       |

### 回调 URL

```
https://your-prism-domain/api/connections/<slug>/callback
```

在身份提供商的配置中将此 URL 添加为允许的重定向 URI。

## 通用 OAuth 2.0

使用**提供商：通用 OAuth 2** 可接入符合 OAuth 2.0 但不完全符合 OIDC 标准的提供商（如 GitLab 自定义路径、Gitea、内部服务等）。

与通用 OIDC 不同，没有自动发现功能——三个端点 URL 均需手动填写。Prism 使用访问令牌调用用户信息端点，并尝试映射常见字段（`sub`/`id`、`name`/`login`/`username`、`picture`/`avatar_url`、`email`）。

## 同一提供商的多个来源

每个来源拥有独立的 slug、Client ID 和 Client Secret，可以添加任意数量同类型来源：

| Slug           | 提供商 | 显示名称       |
|----------------|--------|----------------|
| `github-work`  | GitHub | GitHub（工作）   |
| `github-oss`   | GitHub | GitHub（个人）   |
| `google`       | Google | Google         |
| `keycloak-dev` | OIDC   | 内部 SSO（开发） |

所有已启用的来源将作为独立按钮显示在登录和注册页面。

## 本地开发

本地测试时，使用 `http://localhost:8787` 作为域名注册 OAuth 应用，slug 与生产环境保持一致：

```
http://localhost:8787/api/connections/<slug>/callback
```

::: tip
Google 和 Microsoft 要求生产环境使用 HTTPS，但允许开发环境使用 `http://localhost`。GitHub 和 Discord 也允许使用纯 HTTP 的 localhost URI。
:::

## 常见问题

**重定向 URI 不匹配** — 在提供商处注册的回调 URL 必须与来源 slug 完全一致（包括大小写）。检查 slug 和 `APP_URL`（`wrangler.jsonc`）是否与注册时一致。

**每次登录都创建新账号** — 社交关联通过 `(source_slug, provider_user_id)` 匹配。如果 slug 改变，旧关联会成为孤立记录。使用**个人资料 → 关联账号**重新关联。

**首次社交登录时提示邮箱已被占用** — 如果已存在相同邮箱的账号（通过密码注册），Prism 会拒绝社交登录并报冲突错误。用户需先使用密码登录，然后在**个人资料 → 关联账号**中关联社交提供商。

**通用 OIDC 自动发现失败** — 确保 Issuer URL 使用 HTTPS，且提供商发布了 `{issuer}/.well-known/openid-configuration`。Worker 在服务端请求该文档（无 CORS 问题），但提供商不可达或响应慢会导致超时。
