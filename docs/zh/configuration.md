---
title: 配置
description: 所有存储在 D1 中的运行时配置项，以及 Wrangler 绑定、环境变量和密钥。
---

# 配置

站点配置存储在 D1 的 `site_config` 表中，可通过 **Admin → Settings** 在运行时编辑。更改任何配置项均无需重新部署。

敏感字段（验证码私钥、社交登录的 client_secret、SMTP/IMAP 密码、GitHub README PAT、Discord bot token 等）通过 Cloudflare Secrets Store 绑定 [`SECRETS_KEY`](#wrangler-绑定与变量) 使用 AES-GCM 在数据库中加密存储。管理面板读取时透明解密，配置 API 永远不会暴露其明文。

## 通用

| 键                           | 类型    | 默认值                          | 说明                                                       |
| ---------------------------- | ------- | ------------------------------- | ---------------------------------------------------------- |
| `site_name`                  | string  | `"Prism"`                       | 显示在浏览器标题和邮件中                                   |
| `site_description`           | string  | `"Federated identity platform"` | 显示在登录页面                                             |
| `site_icon_url`              | string? | `null`                          | 网站图标 / Logo 的 URL                                     |
| `allow_registration`         | boolean | `true`                          | 允许新用户自助注册                                         |
| `invite_only`                | boolean | `false`                         | 即使 `allow_registration = true`，也要求注册时携带邀请令牌 |
| `require_email_verification` | boolean | `false`                         | 要求用户完成邮箱验证后才能登录                             |
| `accent_color`               | string  | `"#0078d4"`                     | 主题主色调（十六进制），驱动 FluentUI 主题                 |
| `custom_css`                 | string  | `""`                            | 注入到每个页面的 `<style>` 块                              |
| `disable_user_create_team`   | boolean | `false`                         | 隐藏「新建团队」按钮 — 仅管理员可创建团队                  |
| `disable_user_create_app`    | boolean | `false`                         | 隐藏「新建应用」按钮 — 仅管理员可创建 OAuth 应用           |
| `allow_alt_email_login`      | boolean | `true`                          | 允许使用任意已验证的次要邮箱登录，而不仅是主邮箱           |
| `initialized`                | boolean | `false`                         | 首次初始化后设为 `true`，请勿手动修改                      |

## 会话与令牌

| 键                         | 类型   | 默认值 | 说明                                                                   |
| -------------------------- | ------ | ------ | ---------------------------------------------------------------------- |
| `session_ttl_days`         | number | `30`   | 会话 JWT 有效期（天）。可在 `users` 表中按用户单独覆写（仅管理员可改） |
| `access_token_ttl_minutes` | number | `60`   | OAuth 访问令牌有效期（分钟）。同样支持按用户覆写                       |
| `refresh_token_ttl_days`   | number | `30`   | OAuth 刷新令牌有效期（天）。同样支持按用户覆写                         |

## 机器人防护（验证码）

同一时刻只能启用一个 provider。注册、登录、改密、重发邮箱验证、以及管理员显式启用的流程都会触发验证码。

| 键                   | 类型   | 默认值   | 说明                                                        |
| -------------------- | ------ | -------- | ----------------------------------------------------------- |
| `captcha_provider`   | string | `"none"` | `none` \| `turnstile` \| `hcaptcha` \| `recaptcha` \| `pow` |
| `captcha_site_key`   | string | `""`     | 所选服务商的公开 site key                                   |
| `captcha_secret_key` | string | `""`     | 所选服务商的服务端密钥（加密存储）                          |
| `pow_difficulty`     | number | `20`     | 工作量证明所需的前导零比特数（越高越难）                    |

**Proof-of-work** 不依赖任何第三方服务。`pow/` 中的 Rust→WASM 求解器比 JS 兜底快约 10 倍。难度 20 时一般在 0.1–2 秒内完成。高于 24 可能在低端设备上超时。PoW 一次性使用，通过 `pow_used` 表防重放。

## 二次验证 / 步骤提升

| 键                        | 类型    | 默认值  | 说明                                                                                                                                       |
| ------------------------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `sudo_mode_ttl_minutes`   | number  | `5`     | 用户成功完成一次步骤提升后，同一 `(用户, 会话, 应用)` 三元组下的后续挑战在该时长内可跳过 TOTP/Passkey 重新提示。`0` 表示完全禁用 sudo 模式 |
| `require_captcha_for_2fa` | boolean | `false` | 站点全局：每次步骤提升确认都必须通过当前启用的验证码。应用也可针对单个挑战开启。`captcha_provider = none` 时此项无效                       |

## 公开资料

用户和团队的公开资料默认全部关闭，必须显式启用。站点级默认值仅作用于用户尚未自定义的字段，绝不会把已设为私密的资料暗中转为公开。

### 用户资料默认值

| 键                                     | 类型    | 默认值  | 说明                                                                        |
| -------------------------------------- | ------- | ------- | --------------------------------------------------------------------------- |
| `enable_public_profiles`               | boolean | `true`  | 主开关。`false` ⇒ `/u/:username` 与 `/t/:id` 一律返回 404                   |
| `default_profile_show_display_name`    | boolean | `true`  |                                                                             |
| `default_profile_show_avatar`          | boolean | `true`  |                                                                             |
| `default_profile_show_email`           | boolean | `false` | 敏感信息 — 即使资料整体公开也默认不展示                                     |
| `default_profile_show_joined_at`       | boolean | `true`  |                                                                             |
| `default_profile_show_gpg_keys`        | boolean | `true`  |                                                                             |
| `default_profile_show_authorized_apps` | boolean | `false` | 暴露用户连接了哪些第三方服务 — 默认关闭                                     |
| `default_profile_show_owned_apps`      | boolean | `true`  |                                                                             |
| `default_profile_show_domains`         | boolean | `true`  |                                                                             |
| `default_profile_show_joined_teams`    | boolean | `false` | 同时控制是否允许出现在任何团队的公开成员列表中                              |
| `default_profile_show_readme`          | boolean | `true`  | README 本身是显式启用的（空内容即不展示）；只有用户写过内容时该默认值才生效 |
| `profile_readme_max_bytes`             | number  | `65536` | README Markdown 源码的字节硬上限                                            |

### 团队资料默认值

| 键                                       | 类型    | 默认值  | 说明                                                                 |
| ---------------------------------------- | ------- | ------- | -------------------------------------------------------------------- |
| `default_team_profile_show_description`  | boolean | `true`  |                                                                      |
| `default_team_profile_show_avatar`       | boolean | `true`  |                                                                      |
| `default_team_profile_show_owner`        | boolean | `false` | 默认关闭：否则会通过团队页暴露所有者的用户名                         |
| `default_team_profile_show_member_count` | boolean | `true`  |                                                                      |
| `default_team_profile_show_apps`         | boolean | `true`  |                                                                      |
| `default_team_profile_show_domains`      | boolean | `true`  |                                                                      |
| `default_team_profile_show_members`      | boolean | `false` | 完整成员列表。是否真正展示某成员还要看其 `profile_show_joined_teams` |
| `default_team_profile_show_sub_teams`    | boolean | `true`  | 子团队列表。子团队也必须自己开启公开资料才会真正出现                 |

主开关 `profile_is_public` 没有站点级默认值（隐私优先） — 团队所有者或管理员必须显式开启。

### 子团队（嵌套团队）

[子团队特性](teams.md#子团队-递归嵌套)的总开关和继承开关。完整语义见对应文档，键本身：

| 键                        | 类型    | 默认值 | 说明                                                 |
| ------------------------- | ------- | ------ | ---------------------------------------------------- |
| `enable_sub_teams`        | boolean | `true` | 总开关；关闭后所有子团队接口返回 403。               |
| `max_team_depth`          | integer | `5`    | 嵌套深度上限（根为 0），管理员接口校验 1–20。        |
| `inherit_team_membership` | boolean | `true` | 把成员角色级联到后代（有效角色 = max(直接, 继承)）。 |
| `inherit_team_domains`    | boolean | `true` | 让上级域名出现在子团队列表，并参与自动验证。         |

### 身份组

[身份组](teams.md#身份组)的按团队权限集在站点侧的兜底默认值。没有总开关 —— 该特性按团队 opt-in 且默认关闭，团队所有者不开启就不会下发任何东西。

| 键                              | 类型   | 默认值 | 说明                                                                |
| ------------------------------- | ------ | ------ | ------------------------------------------------------------------- |
| `default_team_role_permissions` | object | `{}`   | `admin` 角色的兜底能力授予，例如 `{"admin":{"groups:manage":true}}` |

解析顺序为：单组覆盖 → 团队 `role_permissions` → 本键 → 代码内置默认（`groups:manage` 关、`groups:assign` 开）。每一级只贡献它显式设置过的键，因此这里留空对象就等于让所有团队直接落到内置默认。

### 团队加入门槛（站点底线）

站点级硬性最低要求，任意团队都必须满足。所有者只能在此基础上加严，不能放松到底线之下。

| 键                                    | 类型    | 默认值  | 说明                                                     |
| ------------------------------------- | ------- | ------- | -------------------------------------------------------- |
| `default_team_require_2fa`            | boolean | `false` | 底线：任何团队都要求成员至少有一个 TOTP 认证器或 Passkey |
| `default_team_require_verified_email` | boolean | `false` | 底线：任何团队都要求成员的主邮箱已验证                   |

::: warning
开启这些底线会立即对所有现有成员生效 — 没有满足条件的成员将无法继续团队操作，直至自行补齐。建议先在前端通知成员后再切换。
:::

## GitHub README 同步

用户可选择从 GitHub 用户仓库同步公开资料 README。缓存遵守 ETag，失败时返回旧内容。

| 键                                | 类型   | 默认值 | 说明                                                                                    |
| --------------------------------- | ------ | ------ | --------------------------------------------------------------------------------------- |
| `github_readme_token`             | string | `""`   | 站点级 GitHub PAT，作为最后一道授权回退。空表示未授权访问（每 IP 60 次/小时）。加密存储 |
| `github_readme_cache_ttl_seconds` | number | `3600` | 在该 TTL 内直接服务缓存内容，过期后才发起带条件 GET                                     |
| `github_readme_token_failures`    | number | `0`    | 自动管理：站点 PAT 的连续 401 计数。达到 3 次后自动清空 token                           |

## GPG 登录

| 键                     | 类型   | 默认值 | 说明                                                                                                                  |
| ---------------------- | ------ | ------ | --------------------------------------------------------------------------------------------------------------------- |
| `gpg_challenge_prefix` | string | `""`   | 在 clearsign 文本的站点头与随机挑战之间插入的额外行。可用于添加人类可读的标识，让用户能够确认自己签的挑战来自你的站点 |

## 第三方通知

| 键                           | 类型   | 默认值 | 说明                                                                                                                     |
| ---------------------------- | ------ | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| `tg_notify_source_slug`      | string | `""`   | 用于推送 Telegram 通知的已启用 Telegram OAuth 源 slug。留空即关闭 Telegram 投递。该源的 bot token 同时用作发送通知的 bot |
| `discord_notify_source_slug` | string | `""`   | 用于识别 Discord 通知收件人的已启用 Discord OAuth 源 slug。留空即关闭 Discord 投递                                       |
| `discord_bot_token`          | string | `""`   | 用于创建 DM channel 并发送通知消息的 Discord bot token。它与 Discord OAuth 源中的 client secret 是两个不同凭据           |

## 社交登录

每个 OAuth 源（GitHub、Google、Microsoft、Discord、Telegram、X、Generic OIDC、Generic OAuth 2）都已迁入 `oauth_sources` 表 — 在 **Admin → OAuth Sources** 中管理，不在本页设置。下方的旧字段仍保留以兼容历史数据，新部署应直接使用 OAuth Sources。

| 键（旧）                  | 说明                                 |
| ------------------------- | ------------------------------------ |
| `github_client_id`        | GitHub OAuth App Client ID           |
| `github_client_secret`    | GitHub OAuth App Client Secret       |
| `google_client_id`        | Google Cloud OAuth 2.0 Client ID     |
| `google_client_secret`    | Google Cloud OAuth 2.0 Client Secret |
| `microsoft_client_id`     | Azure AD Application (client) ID     |
| `microsoft_client_secret` | Azure AD Client Secret               |
| `discord_client_id`       | Discord Application ID               |
| `discord_client_secret`   | Discord Client Secret                |

所有 `*_client_secret` 在数据库中加密存储。源的回调 URL 格式为：

```
https://your-domain/api/connections/<slug>/callback
```

## 邮件 — 发送

| 键               | 类型    | 默认值                  | 说明                                            |
| ---------------- | ------- | ----------------------- | ----------------------------------------------- |
| `email_provider` | string  | `"none"`                | `none` \| `resend` \| `mailchannels` \| `smtp`  |
| `email_api_key`  | string  | `""`                    | Resend / Mailchannels 的 API key（加密存储）    |
| `email_from`     | string  | `"noreply@example.com"` | 出站邮件的发件人地址                            |
| `smtp_host`      | string  | `""`                    | SMTP 服务器地址（provider = `smtp` 时）         |
| `smtp_port`      | number  | `587`                   | SMTP 端口                                       |
| `smtp_secure`    | boolean | `false`                 | true = 隐式 TLS（465）；false = STARTTLS（587） |
| `smtp_user`      | string  | `""`                    | SMTP 用户名                                     |
| `smtp_password`  | string  | `""`                    | SMTP 密码（加密存储）                           |

## 邮件 — 接收

| 键                       | 类型    | 默认值         | 说明                                                                                     |
| ------------------------ | ------- | -------------- | ---------------------------------------------------------------------------------------- |
| `email_verify_methods`   | string  | `"both"`       | `link`（系统发送）\| `send`（用户发送邮件验证）\| `both`                                 |
| `email_receive_provider` | string  | `"cloudflare"` | `cloudflare`（Email Workers）\| `imap`（按 cron 轮询 IMAP 收件箱）\| `none`              |
| `email_receive_host`     | string  | `""`           | `verify-<code>@<host>` 邮件的域名（仅 Cloudflare）。为空时使用 `APP_URL` 主机名          |
| `imap_host`              | string  | `""`           | IMAP 服务器地址（provider = `imap` 时）                                                  |
| `imap_port`              | number  | `993`          | IMAP 端口                                                                                |
| `imap_secure`            | boolean | `true`         | true = 隐式 TLS（993）；false = STARTTLS（143）                                          |
| `imap_user`              | string  | `""`           | IMAP 用户名 — 同时作为接收验证邮件的目标地址展示给用户（验证码作为邮件主题）             |
| `imap_password`          | string  | `""`           | IMAP 密码（加密存储）                                                                    |
| `social_verify_ttl_days` | number  | `0`            | 非零时，通过社交登录验证的邮箱在该天数内一直被信任，过期后才需重新验证。`0` 表示永不过期 |

## 域名验证

域名可通过 DNS TXT、HTML meta、`.well-known` 文件中任意一种方式验证 — 由用户在添加时选择。已验证的域名会按设定的 cron 频率重新核验。

| 键                     | 类型   | 默认值 | 说明                               |
| ---------------------- | ------ | ------ | ---------------------------------- |
| `domain_reverify_days` | number | `30`   | 已验证域名的自动重新核验间隔（天） |

## 诊断与限流

| 键                           | 类型   | 默认值 | 说明                                                                  |
| ---------------------------- | ------ | ------ | --------------------------------------------------------------------- |
| `login_error_retention_days` | number | `30`   | `login_errors` 表中失败登录记录的保留天数，超过后由 cron 清理         |
| `ipv6_rate_limit_prefix`     | number | `64`   | 限流时按多少位前缀对 IPv6 地址聚合（避免一个 `/64` 拥有无限重试次数） |

## Wrangler 绑定与变量

下列项目在 `wrangler.jsonc` 中配置，无法在管理面板中编辑。

### 变量

| 变量                | 必填 | 说明                                                                                                              |
| ------------------- | ---- | ----------------------------------------------------------------------------------------------------------------- |
| `APP_URL`           | 是   | 部署的完整 origin，例如 `https://auth.example.com`                                                                |
| `LOCKDOWN_USERS`    | 否   | 逗号/分号/空格分隔的用户名列表，列表中的用户无法被任何人（包括管理员）删除。留空即禁用。                          |
| `LOCKDOWN_TEAMS`    | 否   | 逗号/分号/空格分隔的团队名称列表，列表中的团队无法被任何人（包括管理员）删除。留空即禁用。                        |
| `ENABLE_RESET`      | 否   | 设为 `"true"` 以启用 **Admin → Settings → Danger Zone → Site reset** 按钮。未设置或为其他值时隐藏（具有破坏性）。 |
| `NO_RESET_COOLDOWN` | 否   | 设为 `"true"` 以跳过请求重置与确认之间的 30 分钟冷却期。即使设置此项，2FA 仍然要求。                              |

### 绑定

| 绑定          | 类型                 | 必填     | 说明                                                                        |
| ------------- | -------------------- | -------- | --------------------------------------------------------------------------- |
| `DB`          | D1 数据库            | 是       | 所有持久化状态                                                              |
| `KV_SESSIONS` | KV namespace         | 是       | JWT 密钥、ID Token RSA 密钥对、按会话存储的元数据                           |
| `KV_CACHE`    | KV namespace         | 是       | 限流计数器、IMAP 拉取游标、图片代理缓存                                     |
| `ASSETS`      | Workers Assets       | 是       | 已构建的 SPA。`html_handling: "none"` 让 SSR 自行处理 `/`                   |
| `SECRETS_KEY` | Secrets Store secret | 强烈推荐 | 32 字节 base64url 编码的 AES-GCM 主密钥。绑定后所有敏感字段在 D1 中加密存储 |

### `SECRETS_KEY` 配置

生成 32 字节主密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

在 Cloudflare 控制台创建 Secrets Store，把密钥以 `prism-secrets-key` 为名存入，然后在 `wrangler.jsonc` 中加入 `secrets_store_secrets` 绑定。

重新部署后，在 **Admin → Settings → Danger Zone → "Migrate secrets to Secrets Store"** 中点击迁移一次，将 D1 中已有的 OAuth/源/SMTP/IMAP/验证码凭据加密。Bearer 类机密（PAT、OAuth code、OAuth token、邀请 token、邮箱验证码、二次验证码、单条备用码）通过姊妹按钮 **"Migrate D1 secrets"** 迁移成 HMAC-SHA256 哈希，可继续按值检索但无法从数据库还原。

未绑定 `SECRETS_KEY` 时所有加密/哈希函数均退化为 no-op — 历史明文路径仍然可用，便于平滑升级。

### Cron 触发器

```jsonc
"triggers": { "crons": ["0 */6 * * *"] }
```

每 6 小时 worker 会：

- 重新核验 `next_reverify_at` 已到期的域名；
- 拉取 IMAP 邮箱（`email_receive_provider = imap` 时）；
- 清理 `app_event_queue` 与 `pow_used` 中的过期记录；
- 回收 `image_proxy_mappings` 中已无源行的孤儿映射。

### 用户 / 团队删除锁定

如果你有绝对不能被删除的用户或团队 —— 共享服务账号、机器人身份或关键组织团队 ——
请在 `wrangler.jsonc` 中设置 `LOCKDOWN_USERS` 和 `LOCKDOWN_TEAMS`。
被锁定的账号在管理员（或团队所有者）尝试通过 API 删除时会返回 403 错误。

变量接受逗号、分号或空格分隔的名称列表，每个名称的首尾空白会被自动去除。
