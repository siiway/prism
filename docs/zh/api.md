---
title: API 参考
description: Prism REST API — 认证、OAuth、应用、团队、域名、GPG、公开资料与管理员端点。
---

# API 参考

基础路径：`/api`

所有端点均返回 JSON。需要认证的端点接受三种凭据中的任意一种：登录时颁发的会话 JWT（`Authorization: Bearer <token>`）、标准授权码流颁发的 OAuth access token，或前缀为 `prism_pat_` 的 PAT。接受 OAuth token 的端点通常挂载在 `/api/oauth/me/*`。

`/api/*` 的 CORS 锁定为 `APP_URL`。`/api/proxy/image/*`、`/.well-known/*` 与 `/api/users/:username`（公开资料）不附带 `Access-Control-Allow-Credentials`，便于安全嵌入。

## 初始化

### `GET /api/init/status`

返回实例是否已完成初始化。

**响应** — `{ "initialized": false }`

### `POST /api/init`

创建第一个管理员账号。仅在 `initialized = false` 时有效。

```json
{
  "email": "admin@example.com",
  "username": "admin",
  "password": "s3cur3",
  "display_name": "Admin",
  "site_name": "My Prism"
}
```

**响应** — `{ "token": "...", "user": { ... } }`

## 站点

### `GET /api/site`

供前端读取的公开站点配置。无需认证。仅返回安全字段，绝不暴露任何 secret。

```json
{
  "site_name": "Prism",
  "site_description": "...",
  "site_icon_url": null,
  "allow_registration": true,
  "invite_only": false,
  "captcha_provider": "none",
  "captcha_site_key": "",
  "pow_difficulty": 20,
  "accent_color": "#0078d4",
  "custom_css": "",
  "initialized": true,
  "require_email_verification": false,
  "email_verify_methods": "both",
  "enable_public_profiles": true,
  "disable_user_create_team": false,
  "disable_user_create_app": false,
  "enable_sub_teams": true,
  "max_team_depth": 5,
  "inherit_team_membership": true,
  "inherit_team_domains": true,
  "default_team_profile_show_sub_teams": true,
  "enabled_sources": [
    { "slug": "github", "provider": "github", "name": "GitHub" },
    { "slug": "google", "provider": "google", "name": "Google" }
  ]
}
```

## 认证

### `POST /api/auth/register`

```json
{
  "email": "user@example.com",
  "username": "alice",
  "password": "hunter2",
  "display_name": "Alice",
  "captcha_token": "...",
  "pow_challenge": "...",
  "pow_nonce": 12345,
  "invite_token": "..."
}
```

仅根据当前启用的验证码 provider 携带相应字段；站点为「仅限邀请」模式时 `invite_token` 必填。

**响应** — `{ "token": "...", "user": { ... } }`

### `POST /api/auth/login`

```json
{
  "identifier": "alice",
  "password": "hunter2",
  "totp_code": "123456",
  "captcha_token": "..."
}
```

`identifier` 接受用户名、主邮箱或任意已验证的次要邮箱（`allow_alt_email_login` 为 true 时）。仅在用户启用了 TOTP 时需要 `totp_code`；Passkey 走专用端点。

**响应** — `{ "token": "...", "user": { ... } }`

若启用了 TOTP 但未提供 code：

```json
{ "totp_required": true, "available_methods": ["totp", "passkey", "backup"] }
```

### `POST /api/auth/logout`

撤销当前会话。需认证。

### `GET /api/auth/verify-email?token=<token>`

通过邮件中的 token 验证邮箱。

### `POST /api/auth/email-verify-code`

返回一个验证地址，让用户通过发送邮件来验证。Cloudflare Email Workers 模式下格式为 `verify-<code>@<domain>`；IMAP 模式下为配置的邮箱地址（验证码作为邮件主题）。需认证。

```json
{ "address": "verify-abc123@example.com", "code": "abc123" }
```

### `POST /api/auth/check-email-verification`

供长轮询用：返回 `{ "verified": boolean }`。在用户主动发邮件验证期间用得上。

### `POST /api/auth/resend-verify-email`

重新发送验证链接。需认证，可携带可选验证码字段。

### `GET /api/auth/pow-challenge`

获取 PoW 挑战。

```json
{ "challenge": "...", "difficulty": 20, "expires_at": 1741568400 }
```

## TOTP（多认证器）

需认证。

### `GET /api/auth/totp/list`

列出已启用的 TOTP 认证器。

### `POST /api/auth/totp/setup`

生成新 TOTP secret，返回 secret 与 `otpauth://` URI。可传 `name` 标记新认证器（如 `"Pixel 9"`）。

```json
{ "name": "Pixel 9", "secret": "...", "uri": "otpauth://totp/..." }
```

### `POST /api/auth/totp/verify`

提交首次正确码以确认绑定。首次为账号添加任意认证器时还会返回备用码。

### `DELETE /api/auth/totp/:id`

按 ID 移除单个认证器。需要当前 TOTP code、备用码或 Passkey 二次验证之一 — 资料 → 安全 中的对话框会自动选择已启用的方式。

### `POST /api/auth/totp/backup-codes`

重新生成备用码。需要有效 TOTP code。

## Passkey（WebAuthn）

### `POST /api/auth/passkey/register/begin` / `/finish`

为已登录用户添加 Passkey。

### `POST /api/auth/passkey/auth/begin` / `/finish`

用 Passkey 登录。`begin` 可传 `username` 限定凭据范围，省略则使用 discoverable credential。

### `POST /api/auth/passkey/verify/begin` / `/finish`

已登录态的 Passkey 二次验证 — 用于步骤提升场景（例如移除最后一个 TOTP 认证器）。

### `GET /api/auth/passkeys`

列出当前用户的 Passkey。

### `DELETE /api/auth/passkeys/:id`

删除 Passkey。

## GPG 公钥

### `POST /api/auth/gpg-challenge`

请求登录挑战。每 IP 每分钟 30 次限流。

```json
{ "identifier": "alice" }
```

**响应** — `{ "challenge": "...", "text": "Prism login\n..." }`

`gpg_challenge_prefix` 配置会插入到站点头与随机挑战之间，让用户能验证签名文本来自你的站点。

### `POST /api/auth/gpg-login`

提交 `gpg --clearsign` 签名后的挑战。每 IP 每分钟 10 次限流。挑战一次性使用，5 分钟过期。

```json
{
  "identifier": "alice",
  "signed_message": "-----BEGIN PGP SIGNED MESSAGE-----\n..."
}
```

**响应** — `{ "token": "...", "user": { ... } }`

### `GET /api/user/gpg` / `POST /api/user/gpg` / `DELETE /api/user/gpg/:id`

会话认证下的 GPG 公钥管理。`POST` 接受 ASCII armor 或二进制 `public_key` 加可选 `name`；同时支持 RSA/EdDSA 等经典算法和 ML-DSA 后量子算法。

### `GET /users/:username.gpg`

公开联邦端点。返回该用户全部已注册公钥（ASCII armor 块按空行分隔），`Content-Type: application/pgp-keys`。

### OAuth scope 版 GPG 端点

| Method   | Path                         | Scope       |
| -------- | ---------------------------- | ----------- |
| `GET`    | `/api/oauth/me/gpg-keys`     | `gpg:read`  |
| `POST`   | `/api/oauth/me/gpg-keys`     | `gpg:write` |
| `DELETE` | `/api/oauth/me/gpg-keys/:id` | `gpg:write` |

请求/响应格式与会话认证版相同。

## 会话

### `GET /api/auth/sessions` / `DELETE /api/auth/sessions/:id`

列出和撤销当前用户的活跃会话。

## 用户

需认证。

### `GET /api/user/me` / `PATCH /api/user/me`

读取与部分更新当前用户（显示名、头像、公开资料开关、通知偏好）。部分字段下方有专用端点。

### `POST /api/user/me/change-password`

```json
{ "current_password": "...", "new_password": "..." }
```

### `POST /api/user/me/avatar`

`multipart/form-data`，字段 `avatar`，最大 2 MB。接受 JPEG、PNG、WebP、GIF。绑定 R2 时存 R2，否则内联存 D1。

### `POST /api/user/me/readme` / `POST /api/user/me/readme/sync`

手写 markdown README，或从 GitHub 用户仓库 README（`github.com/<login>/<login>`）同步。同步会遵守 `github_readme_cache_ttl_seconds` 缓存以及 `github_readme_token` PAT 配置。

### `GET /api/user/me/emails` / `POST` / `DELETE /api/user/me/emails/:id`

次要邮箱管理。`POST /:id/resend` 重发验证；`POST /:id/set-primary` 在验证后切换主邮箱。

### `GET /api/user/me/notifications` / `PUT`

读写用户通知偏好（事件 × 通道 × `brief|full` 等级）。详见 [通知](notifications.md)。

### `GET /api/user/me/notification-rulesets` / `POST` / `PUT /:id` / `DELETE /:id`

具名规则集 — 按顺序执行的 match/action 规则，可基于账号 key 过滤，并支持 `stop`。表达力比扁平偏好更强。详见 [通知](notifications.md)。

### `GET /api/user/tokens` / `POST` / `DELETE /:id`

个人访问令牌。明文仅在创建响应中一次性返回。详见 [个人访问令牌](personal-access-tokens.md)。

### `DELETE /api/user/me`

永久删除账号。`{ "password": "...", "confirm": "DELETE" }`

## OAuth 应用

需认证。完整流程见 [OAuth / OIDC 指南](oauth.md) 与 [跨应用权限](app-permissions.md)。

| Method                              | Path                                         | 说明                                                                                                    |
| ----------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET`                               | `/api/apps`                                  | 列出当前用户的应用                                                                                      |
| `POST`                              | `/api/apps`                                  | 创建应用                                                                                                |
| `GET`                               | `/api/apps/:id`                              | 读取                                                                                                    |
| `PATCH`                             | `/api/apps/:id`                              | 更新；包含 `oidc_fields`、`optional_scopes`、`use_jwt_tokens`、`allow_self_manage_exported_permissions` |
| `POST`                              | `/api/apps/:id/rotate-secret`                | 轮换 `client_secret`                                                                                    |
| `DELETE`                            | `/api/apps/:id`                              | 删除                                                                                                    |
| `GET`                               | `/api/apps/:id/scope-definitions`            | 列出导出 scope 定义                                                                                     |
| `POST` / `PATCH` / `DELETE`         | `/api/apps/:id/scope-definitions[/:scope]`   | 管理 scope 定义（`allow_self_manage_exported_permissions` 开启后应用可用 HTTP Basic 自管）              |
| `GET` / `POST` / `DELETE`           | `/api/apps/:id/scope-access-rules[/:ruleId]` | owner-allow / owner-deny / app-allow / app-deny 规则                                                    |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/apps/:appId/webhooks[/:id]`            | 应用通知 webhook，详见 [应用通知](app-notifications.md)                                                 |

`/api/apps/:appId/events/sse` 与 `…/events/ws` 是 SSE / WebSocket 流，详见 [应用通知](app-notifications.md)。

## 团队

完整指南见 [团队](teams.md)。端点速览：

| Method                    | Path                                                 | 说明                                                                                                                                                                                                                       |
| ------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`                     | `/api/teams`                                         | 列出当前用户可达的团队（直接 + 通过子团队继承可见；每条携带 `parent_team_id` 与 `inherited_from`）                                                                                                                         |
| `POST`                    | `/api/teams`                                         | 创建团队。可选 `parent_team_id` 表示创建子团队 — 调用者需在上级团队上是 admin+（直接或继承），且深度 ≤ `max_team_depth`                                                                                                    |
| `GET`                     | `/api/teams/:id`                                     | 团队详情 + `my_role`（有效）、`inherited_from`、`ancestors[]`（直接父 → 根）、`sub_teams[]`（直接子团队 + 成员数）、直接成员                                                                                               |
| `PATCH`                   | `/api/teams/:id`                                     | 更新名称、描述、头像、公开资料开关（含 `profile_show_sub_teams`）、`parent_team_id`（owner-only，校验环 & 深度）、`require_2fa`、`require_verified_email`、`enable_groups`（owner-only）、`role_permissions`（owner-only） |
| `DELETE`                  | `/api/teams/:id`                                     | 解散（owner，直接或继承）。级联到所有子团队；每一层的应用回退给该层自己的 owner                                                                                                                                            |
| `GET`                     | `/api/teams/:id/sub-teams`                           | 列出直接子团队。上级团队的成员（直接或继承）可查看                                                                                                                                                                         |
| `POST`                    | `/api/teams/:id/sub-teams`                           | 在 `:id` 下创建子团队 — 等价于 `POST /api/teams` 带 `parent_team_id`                                                                                                                                                       |
| `GET`                     | `/api/teams/:id/members`                             | 分页成员列表。`?page=`、`?limit=`（上限 100）、`?q=`（显示名/用户名）、`?group=`（slug，继承来的标签同样命中）                                                                                                             |
| `POST`                    | `/api/teams/:id/members`                             | 按用户名/ID 添加成员（admin 及以上）                                                                                                                                                                                       |
| `PATCH`                   | `/api/teams/:id/members/:userId`                     | 修改角色                                                                                                                                                                                                                   |
| `DELETE`                  | `/api/teams/:id/members/:userId`                     | 移除成员；`:userId = self` 即退出团队                                                                                                                                                                                      |
| `PATCH`                   | `/api/teams/:id/membership/show-on-profile`          | 单成员开关：是否出现在团队公开成员列表                                                                                                                                                                                     |
| `GET`                     | `/api/teams/:id/groups`                              | 列出[身份组](teams.md#身份组)定义与解析后的管理员权限（任意成员可读）                                                                                                                                                      |
| `POST`                    | `/api/teams/:id/groups`                              | 创建身份组。需要 `groups:manage` 能力；`admin_assignable` 仅 owner 可设                                                                                                                                                    |
| `PATCH`                   | `/api/teams/:id/groups/:groupId`                     | 更新名称/描述/颜色。`slug` 不可变；`admin_assignable` 仅 owner 可设                                                                                                                                                        |
| `DELETE`                  | `/api/teams/:id/groups/:groupId`                     | 删除身份组 —— 级联解除所有分配                                                                                                                                                                                             |
| `PUT`                     | `/api/teams/:id/members/:userId/groups`              | 覆盖某成员的身份组集合（`{ group_ids: [...] }`）。仅对发生变化的身份组做权限校验                                                                                                                                           |
| `POST`                    | `/api/teams/:id/transfer-ownership`                  | 把所有权转给另一名成员                                                                                                                                                                                                     |
| `GET`                     | `/api/teams/:id/invites`                             | 列出有效邀请 token                                                                                                                                                                                                         |
| `POST`                    | `/api/teams/:id/invites`                             | 生成邀请 token（可选邮箱锁定 + 最大次数 + 过期）                                                                                                                                                                           |
| `DELETE`                  | `/api/teams/:id/invites/:token`                      | 撤销邀请                                                                                                                                                                                                                   |
| `GET`                     | `/api/teams/join/:token`（认证可选）                 | 查看邀请 — 返回团队、门槛、未满足项                                                                                                                                                                                        |
| `POST`                    | `/api/teams/join/:token`                             | 接受邀请                                                                                                                                                                                                                   |
| `GET` / `POST` / `DELETE` | `/api/teams/:id/domains[/:domainId]`                 | 团队域名。`GET` 同时返回上级团队拥有的域名作为只读条目，带 `inherited_from` 标记（受 `inherit_team_domains` 控制）                                                                                                         |
| `POST`                    | `/api/teams/:id/domains/:domainId/verify`            | 触发重新核验                                                                                                                                                                                                               |
| `POST`                    | `/api/teams/:id/domains/:domainId/to-personal`       | 把已验证域名转回所有者个人空间                                                                                                                                                                                             |
| `POST`                    | `/api/teams/:id/domains/:domainId/share-to-team`     | 把个人域名共享给团队                                                                                                                                                                                                       |
| `POST`                    | `/api/teams/:id/domains/:domainId/share-to-personal` | 反向操作                                                                                                                                                                                                                   |
| `GET` / `POST`            | `/api/teams/:id/apps`                                | 团队 OAuth 应用                                                                                                                                                                                                            |
| `POST`                    | `/api/teams/:id/apps/transfer`                       | 把个人应用转入团队                                                                                                                                                                                                         |
| `DELETE`                  | `/api/teams/:id/apps/:appId/transfer`                | 把团队应用转回原所有者                                                                                                                                                                                                     |

## 域名

| Method   | Path                      | 说明                                                                                               |
| -------- | ------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/domains`            | 列出当前用户的域名                                                                                 |
| `POST`   | `/api/domains`            | 添加域名，返回 `verification_method` 选项与每种方法的具体说明（DNS TXT、HTML meta、`.well-known`） |
| `POST`   | `/api/domains/:id/verify` | 用所选方法触发重新核验                                                                             |
| `DELETE` | `/api/domains/:id`        | 删除                                                                                               |

## 社交连接

| Method   | Path                                 | 说明                                                           |
| -------- | ------------------------------------ | -------------------------------------------------------------- |
| `GET`    | `/api/connections`                   | 列出当前用户已绑定的社交账号                                   |
| `GET`    | `/api/connections/:slug/begin`       | 跳转到源的授权 URL。`?mode=login`（默认）或 `?mode=connect`    |
| `GET`    | `/api/connections/:slug/callback`    | OAuth 回调（由 provider 跳转触发）                             |
| `GET`    | `/api/connections/telegram/callback` | Telegram widget 回调（无 `:slug`，因为 Telegram 用另一种流程） |
| `POST`   | `/api/connections/:id/refresh`       | 从 provider 刷新显示名/头像                                    |
| `DELETE` | `/api/connections/:id`               | 解绑                                                           |

OAuth scope 版本：

| Method   | Path                                   | Scope          |
| -------- | -------------------------------------- | -------------- |
| `GET`    | `/api/oauth/me/social-connections`     | `social:read`  |
| `DELETE` | `/api/oauth/me/social-connections/:id` | `social:write` |

## OAuth 2.0 / OIDC

完整流程见 [OAuth / OIDC 指南](oauth.md)。

| Method | Path                                | 说明                                               |
| ------ | ----------------------------------- | -------------------------------------------------- |
| `GET`  | `/api/oauth/authorize`              | 返回应用信息与请求 scope，供同意页使用             |
| `POST` | `/api/oauth/authorize`              | 同意 / 拒绝                                        |
| `POST` | `/api/oauth/token`                  | `authorization_code` 与 `refresh_token` 两种 grant |
| `GET`  | `/api/oauth/userinfo`               | OIDC UserInfo                                      |
| `POST` | `/api/oauth/introspect`             | RFC 7662                                           |
| `POST` | `/api/oauth/revoke`                 | RFC 7009                                           |
| `GET`  | `/.well-known/openid-configuration` | Discovery                                          |
| `GET`  | `/.well-known/jwks.json`            | ID Token 与 JWT access token 的 RSA 公钥           |

### 步骤提升 2FA

| Method | Path                         | 认证                                            |
| ------ | ---------------------------- | ----------------------------------------------- |
| `POST` | `/api/oauth/2fa/challenges`  | 应用凭据（HTTP Basic）或 PKCE                   |
| `GET`  | `/api/oauth/2fa/info`        | 可选用户会话 — 驱动 SPA                         |
| `POST` | `/api/oauth/2fa/authorize`   | 用户会话 — 提交 TOTP/Passkey/备用码或 sudo 旁路 |
| `POST` | `/api/oauth/2fa/sudo/revoke` | 用户会话 — 主动结束 sudo 宽限期                 |
| `POST` | `/api/oauth/2fa/verify`      | 应用凭据 — 用回跳 code 兑换验证结果             |

### `/api/oauth/me/*`（按 token 鉴权的用户 API）

接受 OAuth access token 或 PAT。所需 scope 见 [OAuth → Scopes](oauth.md#scopes) 与 [管理员 → OAuth scope 参考](admin.md#oauth-scope-reference)。

| 路径                                                                            | Scope                                                                                                                                                                              |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /me/profile`                                                               | `profile`                                                                                                                                                                          |
| `PATCH /me/profile`                                                             | `profile:write`                                                                                                                                                                    |
| `GET /me/apps` / `POST /me/apps` / `PATCH /me/apps/:id` / `DELETE /me/apps/:id` | `apps:read` / `apps:write`                                                                                                                                                         |
| `GET /me/team-apps`                                                             | `apps:read`                                                                                                                                                                        |
| `GET /me/teams` / `POST` / `PATCH /me/teams/:id` / `DELETE`                     | `teams:read` / `teams:write` / `teams:create` / `teams:delete` — 列表包含通过子团队继承可见的团队（带 `inherited_from`）。PATCH/DELETE 使用有效角色（继承的 admin/owner 同样有效） |
| `POST /me/teams/:id/members` / `DELETE`                                         | `teams:write` — 使用有效角色                                                                                                                                                       |
| `GET /me/domains` / `POST` / `POST :domain/verify` / `DELETE`                   | `domains:read` / `domains:write`                                                                                                                                                   |
| `GET /me/gpg-keys` / `POST` / `DELETE`                                          | `gpg:read` / `gpg:write`                                                                                                                                                           |
| `GET /me/social-connections` / `DELETE`                                         | `social:read` / `social:write`                                                                                                                                                     |
| `GET /me/admin/users` / `PATCH` / `DELETE`                                      | `admin:users:read` / `:write` / `:delete`                                                                                                                                          |
| `GET /me/admin/config` / `PATCH`                                                | `admin:config:read` / `:write`                                                                                                                                                     |
| `POST /me/invites` / `GET` / `DELETE`                                           | `admin:invites:create` / `:read` / `:delete`                                                                                                                                       |
| `GET /me/site/users[/:id]`                                                      | `admin:users:read`                                                                                                                                                                 |
| `GET /me/team/:teamId/info` / `PATCH`                                           | `teams:read` / `teams:write`                                                                                                                                                       |
| `GET /me/team/:teamId/members` / `POST` / `DELETE` / `PATCH …/role`             | `teams:read` / `teams:write`                                                                                                                                                       |
| `GET /me/team/:teamId/members/:userId/profile`                                  | `teams:read`                                                                                                                                                                       |

### `GET /api/oauth/consents` / `DELETE /api/oauth/consents/:client_id`

管理当前用户已授权的应用。`DELETE` 同时撤销该应用的所有未过期 token。

## 公开资料

### `GET /api/users/:username`

按可见性开关返回用户公开资料；用户不存在、私有或 `enable_public_profiles` 关闭都返回 404，且响应体一致以避免泄露用户名是否存在。可携带可选 Bearer — 资料拥有者自己的 token 即使在私密状态也能看到自己。详见 [公开资料](public-profile.md)。

### `GET /api/public/teams/:id`

返回团队公开资料；同样的 404 一致性。任意成员的 token 即可在私密时看到完整数据（便于预览）。

启用子团队且团队所有者开启该分区后（`profile_show_sub_teams`，或站点默认 `default_team_profile_show_sub_teams`），响应包含 `sub_teams[]` 数组 —— 仅包括**自身也已公开**的子团队，避免私密子团队的名字被父团队顺带泄露。若团队的父团队自身也是公开的，响应还会带 `parent_team` 面包屑 `{id, name, avatar_url}`。

## 图片代理

### `GET /api/proxy/image/:id`

按已注册映射推送图片，SVG 会被消毒。`:id` 是 `POST /api/proxy/image/register`（需认证）返回的不透明 ID — 不接受 URL 透传，杜绝被用作 SSRF 中继。响应附带跨源头便于嵌入。

### `POST /api/proxy/image/register`

为前端需要展示的远程图片 URL（markdown 预览、`ImageUrlInput` 预览等）注册映射。需认证。返回 `{ "id": "...", "url": "/api/proxy/image/<id>" }`。

## 管理员

需 `role = admin`。

### 配置

| Method  | Path                | 说明                                              |
| ------- | ------------------- | ------------------------------------------------- |
| `GET`   | `/api/admin/config` | 读取所有配置（敏感字段已脱敏）                    |
| `PATCH` | `/api/admin/config` | 批量更新；绑定了 `SECRETS_KEY` 时敏感字段自动加密 |

### 统计 / 仪表盘

`GET /api/admin/stats` → `{ users, apps, verified_domains, active_tokens }`。

### 用户

| Method   | Path                               | 说明                                                   |
| -------- | ---------------------------------- | ------------------------------------------------------ |
| `GET`    | `/api/admin/users?page=…&search=…` | 分页用户列表                                           |
| `GET`    | `/api/admin/users/:id`             | 详情（含会话、应用、连接）                             |
| `PATCH`  | `/api/admin/users/:id`             | `role`、`is_active`、`email_verified`、按用户 TTL 覆写 |
| `DELETE` | `/api/admin/users/:id`             | 永久删除                                               |
| `DELETE` | `/api/admin/users/:id/sessions`    | 撤销该用户全部会话                                     |

### 应用 / OAuth Sources / 邀请 / Webhook / 团队

| 路径                                                         | 说明                                              |
| ------------------------------------------------------------ | ------------------------------------------------- |
| `GET / PATCH /api/admin/apps[/:id]`                          | 验证或停用                                        |
| `GET / POST / PATCH / DELETE /api/admin/oauth-sources[/:id]` | 源 CRUD                                           |
| `GET /api/admin/oauth-sources/discover`                      | 自动获取 OIDC 发现                                |
| `POST /api/admin/oauth-sources/migrate`                      | 一次性：把旧的 site_config 社交字段导入为 sources |
| `GET / POST / DELETE /api/admin/invites[/:id]`               | 站点邀请 token                                    |
| `GET /api/admin/teams` / `DELETE /:id`                       | 列出 / 解散团队                                   |
| `POST /api/admin/test-email`                                 | 发送测试发件邮件                                  |
| `POST /api/admin/test-email-receiving`                       | 生成验证邮箱接收测试码                            |

### 审计 / 请求日志 / 登录错误

| Method   | Path                                  | 说明               |
| -------- | ------------------------------------- | ------------------ |
| `GET`    | `/api/admin/audit-log?page=…`         | 审计事件           |
| `GET`    | `/api/admin/login-errors`             | 失败登录表         |
| `GET`    | `/api/admin/request-logs`             | 可筛选的请求日志   |
| `GET`    | `/api/admin/request-logs/export`      | 当前筛选导出 CSV   |
| `GET`    | `/api/admin/request-logs/:id/details` | 单条请求详情       |
| `DELETE` | `/api/admin/request-logs`             | 全部清空           |
| `DELETE` | `/api/admin/request-logs/spectate`    | 清空 spectate 缓冲 |

### 密钥迁移 / Danger Zone

| Method         | Path                                                            | 说明                                                          |
| -------------- | --------------------------------------------------------------- | ------------------------------------------------------------- |
| `GET`          | `/api/admin/secrets/status`                                     | `SECRETS_KEY` 是否绑定，多少 site_config 行尚未加密           |
| `POST`         | `/api/admin/secrets/migrate`                                    | 加密 site_config / oauth source / oauth app 的剩余明文 secret |
| `GET`          | `/api/admin/d1-secrets/status`                                  | bearer 类字段的同上状态                                       |
| `POST`         | `/api/admin/d1-secrets/migrate`                                 | 哈希尚未迁移的 token / code                                   |
| `GET / POST`   | `/api/admin/teams-as-users-status` & `/migrate-teams-as-users`  | 为每个团队补建 `kind = 'team'` 用户行                         |
| `GET / POST`   | `/api/admin/image-proxy-status` & `/migrate-image-proxy`        | 为旧头像/图标补建图片代理映射                                 |
| `POST`         | `/api/admin/sweep-image-proxy`                                  | 立即清理孤儿映射（同时也会被 cron 调用）                      |
| `GET / DELETE` | `/api/admin/image-proxy[/:id]`                                  | 浏览 / 删除代理映射                                           |
| `POST`         | `/api/admin/migrate-recovery-codes`                             | 重新哈希历史明文备用码                                        |
| `GET / POST`   | `/api/admin/reset/status` & `/request` & `/cancel` & `/confirm` | 邮件签署的站点重置流程                                        |
| `GET / POST`   | `/api/admin/debug`                                              | 部署诊断的内部开关                                            |

## 健康检查

### `GET /api/health`

总是返回 `{ "ok": true }`。无需认证。
