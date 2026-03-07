---
title: 社交登录配置
description: Prism 中 GitHub、Google、Microsoft 和 Discord OAuth 集成的分步配置指南。
---

# 社交登录配置

Prism 支持通过 GitHub、Google、Microsoft 和 Discord 进行社交登录。每个提供商需要在其开发者控制台注册一个 OAuth 应用，然后将凭据填入 **Admin → Settings → Social Login**。

所有回调 URL 遵循以下格式：

```
https://<your-prism-domain>/api/connections/<provider>/callback
```

## GitHub

### 1. 创建 GitHub OAuth 应用

1. 前往 [GitHub Developer Settings → OAuth Apps](https://github.com/settings/developers)，点击 **New OAuth App**。
2. 填写表单：

   | 字段                       | 值                                                          |
   | -------------------------- | ----------------------------------------------------------- |
   | Application name           | 你的站点名称                                                |
   | Homepage URL               | `https://your-prism-domain`                                 |
   | Authorization callback URL | `https://your-prism-domain/api/connections/github/callback` |

3. 点击 **Register application**。
4. 在应用页面复制 **Client ID**。
5. 点击 **Generate a new client secret** 并立即复制——密钥仅显示一次。

### 2. 在 Prism 中填写凭据

前往 **Admin → Settings → Social Login**，将 Client ID 和 Client Secret 粘贴到 GitHub 字段中，保存即可。

保存后，登录和注册页面会立即出现 GitHub 登录选项。

### 注意事项

- GitHub OAuth 应用默认授予公开个人资料信息和邮箱访问权限。Prism 请求 `user:email` 权限范围，确保即使邮箱设为私密也能返回邮箱地址。
- 如果 GitHub 用户没有公开邮箱且邮箱为私密状态，GitHub 会返回一个邮箱列表——Prism 会选取主要的已验证邮箱。
- GitHub 不支持 OpenID Connect。Prism 使用其 REST API（`/user`、`/user/emails`）获取个人资料。

## Google

### 1. 创建 Google OAuth 2.0 客户端

1. 打开 [Google Cloud Console](https://console.cloud.google.com)，选择或创建一个项目。
2. 前往 **APIs & Services → Credentials**，点击 **Create Credentials → OAuth client ID**。
3. 如果需要，先配置 **OAuth 同意屏幕**：
   - 用户类型：**External**（除非是 Google Workspace 内部应用）
   - 将你的域名添加到 **Authorized domains**
   - 添加权限范围：`openid`、`email`、`profile`
4. 返回 **Create OAuth client ID**：

   | 字段                          | 值                                                          |
   | ----------------------------- | ----------------------------------------------------------- |
   | Application type              | **Web application**                                         |
   | Authorized JavaScript origins | `https://your-prism-domain`                                 |
   | Authorized redirect URIs      | `https://your-prism-domain/api/connections/google/callback` |

5. 复制 **Client ID** 和 **Client Secret**。

### 2. 在 Prism 中填写凭据

前往 **Admin → Settings → Social Login**，粘贴到 Google 字段中，保存。

### 注意事项

- Google 使用 OpenID Connect。Prism 请求 `openid email profile` 权限范围。
- 新创建的 Google Cloud 项目同意屏幕默认处于**测试**模式，仅允许你明确添加的测试用户登录。发布同意屏幕后，任意 Google 账号都可以登录。
- 如果你的应用未经验证，Google 会显示警告屏幕。如果预计有外部用户，请提交验证申请。

## Microsoft

### 1. 注册 Azure AD 应用程序

1. 打开 [Azure 门户 → 应用注册](https://portal.azure.com/#blade/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/RegisteredApps)，点击 **New registration**。
2. 填写表单：

   | 字段                    | 值                                                                                                              |
   | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
   | Name                    | 你的站点名称                                                                                                    |
   | Supported account types | **Accounts in any organizational directory and personal Microsoft accounts**（兼容性最广）                      |
   | Redirect URI            | 平台选择 **Web** — `https://your-prism-domain/api/connections/microsoft/callback`                               |

3. 点击 **Register**。
4. 在 **Overview** 页面复制 **Application (client) ID**。
5. 前往 **Certificates & secrets → New client secret**，设置有效期，复制 **Value**（不是 Secret ID）。

### 2. 在 Prism 中填写凭据

前往 **Admin → Settings → Social Login**，粘贴到 Microsoft 字段中，保存。

### 注意事项

- Prism 通过 `common` 租户端点请求 `openid email profile` 权限范围，因此个人账号（Outlook/Hotmail）和工作/学校账号（Azure AD）均可登录。
- 如果将 **Supported account types** 限制为单一租户，则只有该 Azure AD 租户内的用户才能认证。
- 客户端密钥会过期。请设置日历提醒，在密钥过期前进行轮换——过期的密钥会导致 Microsoft 登录静默失败。

## Discord

### 1. 创建 Discord 应用程序

1. 打开 [Discord Developer Portal](https://discord.com/developers/applications)，点击 **New Application**。
2. 输入名称，点击 **Create**。
3. 前往 **OAuth2 → General**：
   - 复制 **Client ID**。
   - 点击 **Reset Secret**，确认后复制 **Client Secret**。
   - 在 **Redirects** 下点击 **Add Redirect**，填入：
     ```
     https://your-prism-domain/api/connections/discord/callback
     ```
4. 保存更改。

### 2. 在 Prism 中填写凭据

前往 **Admin → Settings → Social Login**，粘贴到 Discord 字段中，保存。

### 注意事项

- Prism 请求 `identify email` 权限范围。`identify` 授予用户名和头像访问权限，`email` 授予已验证邮箱访问权限。
- Discord 用户名是唯一的。如果 Discord 用户未设置邮箱（已验证账号很少见），Prism 将拒绝登录并提示用户在 Discord 账号中添加邮箱。
- Discord 不支持 OpenID Connect。Prism 使用其 REST API（`/users/@me`）获取个人资料。

## 本地开发

本地测试时，请为每个提供商单独注册一个 OAuth 应用，使用 `http://localhost:8787` 作为域名：

| 提供商    | 回调 URL                                                   |
| --------- | ---------------------------------------------------------- |
| GitHub    | `http://localhost:8787/api/connections/github/callback`    |
| Google    | `http://localhost:8787/api/connections/google/callback`    |
| Microsoft | `http://localhost:8787/api/connections/microsoft/callback` |
| Discord   | `http://localhost:8787/api/connections/discord/callback`   |

::: tip
部分提供商（Google、Microsoft）要求生产环境回调 URI 使用 HTTPS，但允许开发环境使用 `http://localhost`。GitHub 和 Discord 也允许使用纯 HTTP 的 localhost URI。
:::

在运行 `pnpm worker:dev` 时，通过 **Admin → Settings → Social Login** 填写开发凭据，或直接更新数据库：

```bash
wrangler d1 execute prism-db --local --command \
  "UPDATE site_config SET value = '\"your-dev-client-id\"' WHERE key = 'github_client_id'"
```

## 常见问题

**重定向 URI 不匹配** — 在提供商处注册的回调 URL 必须完全一致（包括末尾斜杠和 `http`/`https`）。检查 `wrangler.jsonc` 中的 `APP_URL` 是否与注册的域名一致。

**每次登录都创建新账号** — 社交关联通过 `(provider, provider_user_id)` 匹配。如果用户之前用其他 Prism 账号登录过，将会关联到那个账号。使用 **Profile → Connections** 将提供商关联到现有账号。

**首次社交登录时提示邮箱已被占用** — 如果已存在相同邮箱的账号（通过密码注册），Prism 会拒绝社交登录并报冲突错误。用户需先使用密码登录，然后在 **Profile → Connections** 中关联社交提供商。
