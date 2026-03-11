---
title: 配置
description: 所有存储在 D1 中的运行时配置项，以及 Wrangler 环境变量和密钥。
---

# 配置

站点配置存储在 D1 的 `site_config` 表中，可通过 **Admin → Settings** 在运行时编辑。更改任何配置项均无需重新部署。

## 通用

| 键                           | 类型    | 默认值                          | 说明                                    |
|------------------------------|---------|---------------------------------|-----------------------------------------|
| `site_name`                  | string  | `"Prism"`                       | 显示在浏览器标题和邮件中                |
| `site_description`           | string  | `"Federated identity platform"` | 显示在登录页面                          |
| `site_icon_url`              | string? | `null`                          | 网站图标 / Logo 的 URL                  |
| `allow_registration`         | boolean | `true`                          | 允许新用户自助注册                      |
| `require_email_verification` | boolean | `false`                         | 要求用户完成邮箱验证后才能登录          |
| `accent_color`               | string  | `"#0078d4"`                     | 主题主色调（十六进制），驱动 FluentUI 主题 |
| `custom_css`                 | string  | `""`                            | 注入到每个页面的 `<style>` 块           |
| `initialized`                | boolean | `false`                         | 首次初始化后设为 `true`，请勿手动修改    |

## 会话与令牌

| 键                         | 类型   | 默认值 | 说明                       |
|----------------------------|--------|--------|----------------------------|
| `session_ttl_days`         | number | `30`   | 用户会话 JWT 的有效期（天）  |
| `access_token_ttl_minutes` | number | `60`   | OAuth 访问令牌有效期（分钟） |
| `refresh_token_ttl_days`   | number | `30`   | OAuth 刷新令牌有效期（天）   |

## 机器人防护（验证码）

同一时间只能启用一个提供商。

| 键                   | 类型   | 默认值   | 说明                                                        |
|----------------------|--------|----------|-------------------------------------------------------------|
| `captcha_provider`   | string | `"none"` | `none` \| `turnstile` \| `hcaptcha` \| `recaptcha` \| `pow` |
| `captcha_site_key`   | string | `""`     | 所选提供商的公开站点密钥                                    |
| `captcha_secret_key` | string | `""`     | 所选提供商的服务端密钥                                      |
| `pow_difficulty`     | number | `20`     | 工作量证明要求的前导零位数（越大越难）                        |

**工作量证明**无需第三方服务。难度 20 在大多数设备上需要约 0.1–2 秒。超过 24 时，低端移动设备可能会超时。

## 社交登录

所有字段默认为空（即对应提供商已禁用）。

| 键                        | 说明                                 |
|---------------------------|--------------------------------------|
| `github_client_id`        | GitHub OAuth 应用 Client ID          |
| `github_client_secret`    | GitHub OAuth 应用 Client Secret      |
| `google_client_id`        | Google Cloud OAuth 2.0 Client ID     |
| `google_client_secret`    | Google Cloud OAuth 2.0 Client Secret |
| `microsoft_client_id`     | Azure AD 应用程序（客户端）ID          |
| `microsoft_client_secret` | Azure AD 客户端密钥                  |
| `discord_client_id`       | Discord 应用程序 ID                  |
| `discord_client_secret`   | Discord 客户端密钥                   |

各提供商需要注册的回调 URL：

| 提供商    | 回调 URL                                                 |
|-----------|----------------------------------------------------------|
| GitHub    | `https://your-domain/api/connections/github/callback`    |
| Google    | `https://your-domain/api/connections/google/callback`    |
| Microsoft | `https://your-domain/api/connections/microsoft/callback` |
| Discord   | `https://your-domain/api/connections/discord/callback`   |

## 邮件 — 发送

| 键                     | 类型    | 默认值                  | 说明                                              |
|------------------------|---------|-------------------------|---------------------------------------------------|
| `email_provider`       | string  | `"none"`                | `none` \| `resend` \| `mailchannels` \| `smtp`    |
| `email_api_key`        | string  | `""`                    | Resend 或 Mailchannels 的 API 密钥                |
| `email_from`           | string  | `"noreply@example.com"` | 发件地址                                          |
| `smtp_host`            | string  | `""`                    | SMTP 服务器主机名（选择 `smtp` 时使用）            |
| `smtp_port`            | number  | `587`                   | SMTP 服务器端口                                    |
| `smtp_secure`          | boolean | `false`                 | 使用 SSL/TLS（true）或 STARTTLS（false）           |
| `smtp_user`            | string  | `""`                    | SMTP 用户名                                       |
| `smtp_password`        | string  | `""`                    | SMTP 密码                                         |

## 邮件 — 接收

| 键                       | 类型    | 默认值         | 说明                                                                              |
|--------------------------|---------|----------------|-----------------------------------------------------------------------------------|
| `email_verify_methods`   | string  | `"both"`       | `link`（系统发送邮件）\| `send`（用户发送邮件到验证地址）\| `both`（两种方式均可） |
| `email_receive_provider` | string  | `"cloudflare"` | `cloudflare`（Email Workers）\| `imap`（IMAP 轮询）\| `none`                      |
| `email_receive_host`     | string  | `""`           | 接收验证邮件的域名。留空则使用 `APP_URL` 的主机名                                 |
| `imap_host`              | string  | `""`           | IMAP 服务器主机名（接收方式为 `imap` 时使用）                                     |
| `imap_port`              | number  | `993`          | IMAP 服务器端口                                                                   |
| `imap_secure`            | boolean | `true`         | 使用隐式 TLS（true，端口 993）或 STARTTLS（false，端口 143）                       |
| `imap_user`              | string  | `""`           | IMAP 用户名                                                                       |
| `imap_password`          | string  | `""`           | IMAP 密码                                                                         |

## 域名验证

| 键                     | 类型   | 默认值 | 说明                                |
|------------------------|--------|--------|-------------------------------------|
| `domain_reverify_days` | number | `30`   | 自动重新验证域名 DNS 记录的间隔天数 |

## Wrangler 环境变量

以下变量在 `wrangler.jsonc` 的 `vars` 中设置，或通过 `wrangler secret put` 配置，无法在管理面板中编辑。

| 变量      | 是否必填 | 说明                                               |
|-----------|----------|----------------------------------------------------|
| `APP_URL` | 是       | 部署的完整来源地址，例如 `https://auth.example.com` |
