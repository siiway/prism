---
title: 配置
description: 运行时配置键，以及 Wrangler 绑定、环境变量和密钥。
---

# 配置

站点设置可在运行时于 **管理 → 设置** 中编辑，无需重新部署。本页先列出这些设置背后的键，然后列出在部署时设置的 Wrangler 绑定和变量。

当存在 [`SECRETS_KEY`](#secrets-key-配置) 绑定时，敏感值（验证码密钥、社交客户端密钥、SMTP/IMAP 密码、GitHub README 令牌、Discord bot 令牌）会静态加密，且配置 API 永远不会返回它们。

## 通用

| 键                           | 类型    | 默认值                          | 说明                                      |
| ---------------------------- | ------- | ------------------------------- | ----------------------------------------- |
| `site_name`                  | string  | `"Prism"`                       | 显示在浏览器标题和邮件中                  |
| `site_description`           | string  | `"Federated identity platform"` | 显示在登录页面                            |
| `site_icon_url`              | string? | `null`                          | 网站图标 / Logo 的 URL                    |
| `allow_registration`         | boolean | `true`                          | 允许自助注册                              |
| `invite_only`                | boolean | `false`                         | 注册时需要邀请令牌                        |
| `require_email_verification` | boolean | `false`                         | 在邮箱验证完成前阻止登录                  |
| `accent_color`               | string  | `"#0078d4"`                     | 主品牌色（十六进制）                      |
| `custom_css`                 | string  | `""`                            | 作为 `<style>` 块注入每个页面             |
| `show_powered_by`            | boolean | `true`                          | 在页脚显示“由 Prism 驱动”源代码链接       |
| `disable_user_create_team`   | boolean | `false`                         | 隐藏“新建团队”——仅管理员可创建团队        |
| `disable_user_create_app`    | boolean | `false`                         | 隐藏“新建应用”——仅管理员可创建 OAuth 应用 |
| `allow_alt_email_login`      | boolean | `true`                          | 允许用户使用任意已验证的次要邮箱登录      |
| `security_contact`           | string  | `""`                            | 用于漏洞报告的 `mailto:` 地址或 https URL |
| `security_policy_url`        | string  | `""`                            | 指向你的披露政策的链接                    |

当设置了 `security_contact` 时，Prism 会提供 `/.well-known/security.txt`。

## 法律页面

可使用 Markdown 编写隐私政策和服务条款，并在 **管理 → 设置 → 法律条款** 中发布。它们无需登录即可在 `/privacy` 和 `/terms` 访问，且每个页面都会显示页脚链接。每份文档限制为 256 KiB。将文档保存为空即可同时隐藏对应页面及其链接。

## 头像代理

来自其他站点的头像和图标通过 Prism 的图片代理提供。超过大小限制的响应会被拒绝。可选缓存（默认关闭，使用 KV 或 D1）及其 TTL 在 **管理 → 头像代理** 中设置。位图转换为 WebP 是可选项，需要 `IMAGES` Cloudflare Images 绑定。

## 会话与令牌

| 键                         | 类型   | 默认值 | 说明                 |
| -------------------------- | ------ | ------ | -------------------- |
| `session_ttl_days`         | number | `30`   | 会话有效期           |
| `access_token_ttl_minutes` | number | `60`   | OAuth 访问令牌有效期 |
| `refresh_token_ttl_days`   | number | `30`   | OAuth 刷新令牌有效期 |

管理员可以为单个用户覆盖访问令牌和刷新令牌的有效期。

## 机器人防护（验证码）

Prism 运行一组有序的提供商。第一个是默认项；其余是备用项，访客可在默认项失败或较慢时切换过去。每个提供商 都有自己的凭据，因此你可以全部配置。验证码会保护注册、登录、修改密码、重发邮箱验证、加入团队、邀请链接注册和加强 2FA。

| 键                               | 类型     | 默认值       | 说明                                                                |
| -------------------------------- | -------- | ------------ | ------------------------------------------------------------------- |
| `captcha_providers`              | string[] | `[]`         | 有序的启用集合。第一项为默认项。`[]` = 关闭                         |
| `captcha_switch_timeout_seconds` | number   | `15`         | “换一种验证方式”出现前的延迟秒数。`0` = 仅在失败后出现              |
| `turnstile_site_key`             | string   | `""`         | Turnstile site key                                                  |
| `turnstile_secret_key`           | string   | `""`         | Turnstile 密钥                                                      |
| `turnstile_endpoint_mode`        | string   | `"global"`   | 由哪个主机提供 Turnstile（见下文）                                  |
| `turnstile_china_site_key`       | string   | `""`         | `region: "china"` 组件的 site key                                   |
| `turnstile_china_secret_key`     | string   | `""`         | 该密钥对应的 secret                                                 |
| `hcaptcha_site_key`              | string   | `""`         | hCaptcha site key                                                   |
| `hcaptcha_secret_key`            | string   | `""`         | hCaptcha secret                                                     |
| `recaptcha_site_key`             | string   | `""`         | reCAPTCHA v3 site key                                               |
| `recaptcha_secret_key`           | string   | `""`         | reCAPTCHA v3 secret                                                 |
| `geetest_captcha_id`             | string   | `""`         | GeeTest v4 CAPTCHA ID                                               |
| `geetest_captcha_key`            | string   | `""`         | GeeTest v4 key                                                      |
| `geetest_fail_open`              | boolean  | `false`      | GeeTest 不可达时是否接受访客。`false` = 拒绝                        |
| `cap_mode`                       | string   | `"embedded"` | `embedded`（在 Prism 内运行）或 `external`（自托管 Cap Standalone） |
| `cap_api_endpoint`               | string   | `""`         | Cap Standalone 基础 URL（外部模式）                                 |
| `cap_site_key`                   | string   | `""`         | Cap Standalone site key（外部模式）                                 |
| `cap_secret_key`                 | string   | `""`         | Cap Standalone secret（外部模式）                                   |
| `cap_challenge_count`            | number   | `50`         | 每个 Cap 挑战的谜题数量（内嵌模式）                                 |
| `cap_challenge_difficulty`       | number   | `4`          | Cap 难度（内嵌模式）                                                |
| `cap_instrumentation`            | boolean  | `true`       | Cap 的反自动化脚本（内嵌模式）                                      |

提供商名称：`turnstile`、`hcaptcha`、`recaptcha`、`geetest` 和 `cap`（[Cap](https://trycap.dev)）。

### Turnstile 与中国大陆

Cloudflare 通过全球主机和中国大陆主机（`challenges.cloudflare-cn.com`）提供 Turnstile。组件只会在与其创建时指定的 region 匹配的主机上工作，因此使用中国主机意味着需要第二个以 `region: "china"` 创建的组件（这需要 Cloudflare China Network 权益）。将其密钥填入 `turnstile_china_site_key` 和 `turnstile_china_secret_key`。

`turnstile_endpoint_mode` 决定访客使用哪一组：

- `global` — 始终使用全球主机。
- `china` — 始终使用中国主机。
- `client_language` — 浏览器语言为中文时使用中国主机。
- `server_region` — 请求来自 `CN` 时使用中国主机。
- `client_region` — 浏览器时区位于中国大陆时使用中国主机。

如果 `turnstile_china_site_key` 为空，所有模式的行为都等同于 `global`，因此在没有权益的情况下选择中国模式不会有任何代价。Prism 还会在使用中国密钥前进行检查，如果它不可用则回退到全球。

## 加强 2FA

| 键                        | 类型    | 默认值  | 说明                                                                           |
| ------------------------- | ------- | ------- | ------------------------------------------------------------------------------ |
| `sudo_mode_ttl_minutes`   | number  | `5`     | 成功完成一次加强验证后，来自同一应用的后续挑战在该时长内跳过提示。`0` 表示禁用 |
| `require_captcha_for_2fa` | boolean | `false` | 每次加强验证确认都必须完成验证码                                               |

## 公开资料

公开资料默认关闭，直到用户（或团队所有者）主动启用。站点默认值仅适用于用户自己尚未设置的字段，并且绝不会让私密资料变为公开。

| 键                                       | 默认值  | 说明                                   |
| ---------------------------------------- | ------- | -------------------------------------- |
| `enable_public_profiles`                 | `true`  | 主开关。`false` = 所有资料页面返回 404 |
| `default_profile_show_display_name`      | `true`  |                                        |
| `default_profile_show_avatar`            | `true`  |                                        |
| `default_profile_show_email`             | `false` |                                        |
| `default_profile_show_joined_at`         | `true`  |                                        |
| `default_profile_show_gpg_keys`          | `true`  |                                        |
| `default_profile_show_authorized_apps`   | `false` |                                        |
| `default_profile_show_owned_apps`        | `true`  |                                        |
| `default_profile_show_domains`           | `true`  |                                        |
| `default_profile_show_joined_teams`      | `false` | 还控制是否出现在团队的公开成员列表中   |
| `default_profile_show_readme`            | `true`  |                                        |
| `profile_readme_max_bytes`               | `65536` | README 最大大小                        |
| `default_team_profile_show_description`  | `true`  | 团队资料默认值                         |
| `default_team_profile_show_avatar`       | `true`  |                                        |
| `default_team_profile_show_owner`        | `false` |                                        |
| `default_team_profile_show_member_count` | `true`  |                                        |
| `default_team_profile_show_apps`         | `true`  |                                        |
| `default_team_profile_show_domains`      | `true`  |                                        |
| `default_team_profile_show_members`      | `false` |                                        |
| `default_team_profile_show_sub_teams`    | `true`  |                                        |

## 团队

| 键                                    | 类型    | 默认值  | 说明                                                                |
| ------------------------------------- | ------- | ------- | ------------------------------------------------------------------- |
| `enable_sub_teams`                    | boolean | `true`  | [子团队](teams.md#子团队)的主开关                                   |
| `max_team_depth`                      | integer | `5`     | 最大嵌套深度（1–20）                                                |
| `inherit_team_membership`             | boolean | `true`  | 团队成员在其子团队上至少拥有相同角色                                |
| `inherit_team_domains`                | boolean | `true`  | 子团队可查看上级域名并据此自动验证                                  |
| `default_team_require_2fa`            | boolean | `false` | 每个团队都要求 TOTP 认证器或 Passkey                                |
| `default_team_require_verified_email` | boolean | `false` | 每个团队都要求已验证的主邮箱                                        |
| `default_team_role_permissions`       | object  | `{}`    | 团队管理员的默认身份组权限，例如 `{"admin":{"groups:manage":true}}` |

开启两个 `default_team_require_*` 底线会立即对现有成员生效；请先通知他们。

### 邀请链接注册

团队能否使用[邀请链接注册](teams.md#邀请链接注册)由站点管理员按团队授予。当 `allow_registration` 为 `false` 时，不会创建任何账号。

| 键                                       | 默认值 | 说明                                                             |
| ---------------------------------------- | ------ | ---------------------------------------------------------------- |
| `team_invite_registration_max_uses_cap`  | `1000` | 会创建账号的邀请可设置的 `max_uses` 上限                         |
| `team_invite_registration_rate_per_hour` | `200`  | 每个邀请每小时注册次数                                           |
| `restricted_user_capabilities`           | `{}`   | 授予受限账号的功能，例如 `{"app:create": true}`。为空 = 全部拒绝 |
| `restricted_pending_ttl_hours`           | `72`   | 未完成注册的保留时长                                             |
| `restricted_dissolve_grace_hours`        | `168`  | 团队解散时，账号从停用到删除之间的延迟                           |

能力键：`team:create`、`app:create`、`domain:create`、`pat:create`、`profile:public`、`gpg:manage`、`self:convert`。

## GitHub README 同步

用户可以从 GitHub 仓库同步其资料 README。

| 键                                | 默认值 | 说明                                                                    |
| --------------------------------- | ------ | ----------------------------------------------------------------------- |
| `github_readme_token`             | `""`   | 用于获取 README 的 GitHub 令牌。为空 = 未认证（每 IP 每小时 60 次请求） |
| `github_readme_cache_ttl_seconds` | `3600` | 获取到的 README 在重新检查前会提供多久                                  |

## GPG 登录

| 键                     | 默认值 | 说明                                                       |
| ---------------------- | ------ | ---------------------------------------------------------- |
| `gpg_challenge_prefix` | `""`   | 用户所签名挑战中的额外文本，以便他们识别该挑战来自你的站点 |

## 第三方通知

| 键                           | 默认值 | 说明                                                        |
| ---------------------------- | ------ | ----------------------------------------------------------- |
| `tg_notify_source_slug`      | `""`   | 其 bot 发送通知的 Telegram OAuth 来源。为空即禁用 Telegram  |
| `discord_notify_source_slug` | `""`   | 用于查找可私信用户的 Discord OAuth 来源。为空即禁用 Discord |
| `discord_bot_token`          | `""`   | 用于发送私信的 Discord bot 令牌                             |

## 社交登录

社交登录提供商 在 **管理 → OAuth 来源** 中作为 OAuth 来源配置，不在此处配置。参见[社交登录设置](social-login.md)。

## 邮件

| 键               | 默认值                  | 说明                                       |
| ---------------- | ----------------------- | ------------------------------------------ |
| `email_provider` | `"none"`                | `none`、`resend`、`mailchannels` 或 `smtp` |
| `email_api_key`  | `""`                    | Resend 或 Mailchannels 的 API key          |
| `email_from`     | `"noreply@example.com"` | 发件人地址                                 |
| `smtp_host`      | `""`                    | SMTP 服务器                                |
| `smtp_port`      | `587`                   | SMTP 端口                                  |
| `smtp_secure`    | `false`                 | `true` = 隐式 TLS，`false` = STARTTLS      |
| `smtp_user`      | `""`                    | SMTP 用户名                                |
| `smtp_password`  | `""`                    | SMTP 密码                                  |

### 接收

| 键                       | 默认值         | 说明                                                                        |
| ------------------------ | -------------- | --------------------------------------------------------------------------- |
| `email_verify_methods`   | `"both"`       | `link`、`send`（用户向 Prism 发邮件）或 `both`                              |
| `email_receive_provider` | `"cloudflare"` | `cloudflare`（Email Workers）、`imap` 或 `none`                             |
| `email_receive_host`     | `""`           | `verify-<code>@<host>` 使用的域名（仅 Cloudflare）。留空 = `APP_URL` 的主机 |
| `imap_host`              | `""`           | IMAP 服务器                                                                 |
| `imap_port`              | `993`          | IMAP 端口                                                                   |
| `imap_secure`            | `true`         | 隐式 TLS（端口 993）或 STARTTLS（端口 143）                                 |
| `imap_user`              | `""`           | IMAP 用户名；同时作为可发送邮件的地址展示给用户                             |
| `imap_password`          | `""`           | IMAP 密码                                                                   |
| `social_verify_ttl_days` | `0`            | 通过社交 provider 验证的邮箱保持受信任的天数。`0` = 永不过期                |

## 域名验证

域名可以通过 DNS TXT 记录、HTML meta 标签或 `.well-known` 文件验证，并会按计划重新检查。

| 键                     | 默认值 | 说明                   |
| ---------------------- | ------ | ---------------------- |
| `domain_reverify_days` | `30`   | 自动重新验证之间的天数 |

## 诊断与限流

| 键                                                | 默认值       | 说明                                 |
| ------------------------------------------------- | ------------ | ------------------------------------ |
| `login_error_retention_days`                      | `30`         | 失败登录记录的保留天数               |
| `login_dos_rate_limit` / `_window_seconds`        | `120` / `60` | 每个 IP 的登录 POST 次数             |
| `login_ip_rate_limit` / `_window_seconds`         | `60` / `60`  | 每个 IP 通过验证码后的登录尝试次数   |
| `login_identifier_rate_limit` / `_window_seconds` | `30` / `300` | 每个邮箱或用户名的登录尝试次数       |
| `login_totp_rate_limit` / `_window_seconds`       | `15` / `300` | 每个用户的 TOTP 提交次数             |
| `ipv6_rate_limit_prefix`                          | `64`         | 共享同一个限流桶的 IPv6 地址前缀位数 |

限值为 `1` 到 `86400` 的整数。密码步骤和 TOTP 步骤是分开的请求，两者都会计数。

## Wrangler 绑定与变量

这些在 `wrangler.jsonc` 中设置，而不是在管理面板中设置。

### 变量

| 变量                | 必填 | 说明                                                                                                                        |
| ------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------- |
| `APP_URL`           | 是   | 部署的完整 origin，例如 `https://auth.example.com`                                                                          |
| `LOCKDOWN_USERS`    | 否   | 任何人（包括管理员）都不能删除的用户名。用逗号、分号或空格分隔                                                              |
| `LOCKDOWN_TEAMS`    | 否   | 任何人都不能删除的团队名称。格式相同                                                                                        |
| `ENABLE_RESET`      | 否   | `"true"` 会在危险区域显示 **站点重置** 按钮。否则隐藏                                                                       |
| `NO_RESET_COOLDOWN` | 否   | `"true"` 会跳过确认重置前的 30 分钟等待。仍然需要 2FA                                                                       |
| `D1_CONSOLE`        | 否   | **管理 → 数据库** 的可用性：未设置 / `off`（默认）、`read-only` 或 `full`。参见[管理 → 数据库](admin.md#数据库与键值浏览器) |
| `KV_CONSOLE`        | 否   | 键值浏览器同上。未设置时跟随 `D1_CONSOLE`                                                                                   |

### 绑定

| 绑定          | 类型                 | 必填     | 说明                     |
| ------------- | -------------------- | -------- | ------------------------ |
| `DB`          | D1 数据库            | 是       | 持久化状态               |
| `KV_SESSIONS` | KV namespace         | 是       | 会话密钥和签名密钥       |
| `KV_CACHE`    | KV namespace         | 是       | 缓存和短期状态           |
| `ASSETS`      | Workers Assets       | 是       | 构建后的 Web 应用        |
| `SECRETS_KEY` | Secrets Store secret | 强烈推荐 | 用于静态加密密钥的主密钥 |

### `SECRETS_KEY` 配置

生成一个 32 字节密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

创建一个 Secrets Store，将密钥以 `prism-secrets-key` 为名保存，并添加 `wrangler.jsonc` 中所示的 `secrets_store_secrets` 绑定。重新部署后，运行一次 **管理 → 维护 → 危险区域 → 将密钥迁移到 Secrets Store** 和 **迁移 D1 密钥**，以保护现有数据。

在没有该绑定的情况下，Prism 会使用明文存储运行，之后仍可添加该绑定。

### Cron 触发器

```jsonc
"triggers": { "crons": ["0 */6 * * *"] }
```

每六小时，Prism 会重新验证域名、轮询 IMAP 邮箱（启用时）并清理过期数据。你也可以从 **管理 → 设置 → 维护任务** 按需运行这些任务。

### 删除锁定

绝不能删除的用户和团队（服务账号、bot 身份、关键团队）可以列入 `LOCKDOWN_USERS` 和 `LOCKDOWN_TEAMS`。通过 API 删除它们的尝试会返回 403。
