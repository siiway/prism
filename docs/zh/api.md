---
title: API 参考
description: Prism 的 REST API — 认证、OAuth、应用、团队、域名、GPG、公开资料及管理端点。
---

# API 参考

基础路径：`/api`

所有端点均返回 JSON。Web 界面使用安全的 HttpOnly 会话 Cookie 进行认证。API 集成应使用标准授权码流程颁发的 OAuth access token，或使用个人访问令牌（前缀 `prism_pat_`）。通过令牌认证的用户端点大多位于 `/api/oauth/me/*` 下。

跨源请求仅允许来自 `APP_URL`，但图片代理、`/.well-known/*` 和公开资料端点除外，这些端点可以安全嵌入。请求正文限制为 5 MiB；更大的请求会返回 `413`。

## 错误

失败的请求会返回稳定、机器可读的错误码：

```json
{ "error": "field_required", "params": { "field": "name" } }
```

`error` 是小写错误码，例如 `team_not_found` 或 `forbidden`；请据此判断。当消息中有待填内容（字段名、限制值）时会附带 `params`。Web 界面会翻译每个错误码，因此响应中没有英文消息。成功的写操作会返回数据，没有可返回内容时返回 `{ "ok": true }`。

OAuth 和 OpenID Connect 协议端点（`/api/oauth/token`、`/api/oauth/register`、`/api/oauth/userinfo`、设备流程等）则遵循各自的 RFC：`error` 是标准错误码，`error_description` 是面向客户端开发者的英文文本。

## 初始化

### `GET /api/init/status`

在首次运行设置完成前返回 `{ "initialized": false }`。

### `POST /api/init`

创建第一个管理员账号。仅在设置完成前有效。

```json
{
  "email": "admin@example.com",
  "username": "admin",
  "password": "s3cur3",
  "display_name": "Admin",
  "site_name": "My Prism"
}
```

**响应** — `{ "user": { ... } }`。会话仅通过 Cookie 设置。

## 站点

### `GET /api/site`

供前端使用的公开站点配置。无需认证；绝不包含密钥。

```json
{
  "site_name": "Prism",
  "site_description": "...",
  "site_icon_url": null,
  "allow_registration": true,
  "invite_only": false,
  "captcha_provider": "none",
  "accent_color": "#0078d4",
  "initialized": true,
  "require_email_verification": false,
  "enable_public_profiles": true,
  "enable_sub_teams": true,
  "max_team_depth": 5,
  "enabled_sources": [
    { "slug": "github", "provider": "github", "name": "GitHub" }
  ]
}
```

实际响应包含更多字段（功能开关和默认值）。

## 认证

### `POST /api/auth/register`

```json
{
  "email": "user@example.com",
  "username": "alice",
  "password": "hunter2",
  "display_name": "Alice",
  "captcha_token": "...",
  "invite_token": "..."
}
```

包含与当前验证码提供商 匹配的机器人防护字段。`invite_token` 在仅限邀请模式下必填。**响应** — 当注册同时登录用户时返回 `{ "user": { ... } }`（会话仅存在于 Cookie 中）。

### `POST /api/auth/login`

```json
{
  "identifier": "alice",
  "password": "hunter2",
  "totp_code": "123456",
  "captcha_token": "..."
}
```

`identifier` 是用户名、主邮箱，或（当 `allow_alt_email_login` 开启时）任意已验证的次要邮箱。仅在已启用 TOTP 时需要 `totp_code`。Passkey 使用下方专用端点。

**响应** — `{ "user": { ... } }`。如果已启用 TOTP 但未发送验证码：

```json
{ "totp_required": true, "available_methods": ["totp", "passkey", "backup"] }
```

### `POST /api/auth/logout`

结束当前会话。Prism 同一时间只支持一个浏览器会话；切换账号意味着退出后重新登录。

### 邮箱验证

| 端点                                      | 用途                                                |
| ----------------------------------------- | --------------------------------------------------- |
| `GET /api/auth/verify-email?token=`       | 使用邮件中的链接验证                                |
| `POST /api/auth/email-verify-code`        | 获取用于发送验证的邮箱地址：`{ "address", "code" }` |
| `POST /api/auth/check-email-verification` | `{ "verified": boolean }` — 用户发送邮件期间轮询    |
| `POST /api/auth/resend-verify-email`      | 重新发送链接（接受验证码字段）                      |

## TOTP

所有端点都需要认证。一个用户可以拥有多个认证器。

| 端点                               | 用途                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| `GET /api/auth/totp/list`          | 列出认证器                                                                     |
| `POST /api/auth/totp/setup`        | 创建密钥。可选 `name`。返回 `{ name, secret, uri }`；`uri` 是 `otpauth://` URI |
| `POST /api/auth/totp/verify`       | 用第一个验证码确认设置。首次添加任意认证器时返回备用码                         |
| `DELETE /api/auth/totp/:id`        | 移除一个。需要 TOTP 验证码、备用码或 Passkey 验证                              |
| `POST /api/auth/totp/backup-codes` | 重新生成备用码。需要有效的 TOTP 验证码                                         |

## Passkey (WebAuthn)

| 端点                                               | 用途                                         |
| -------------------------------------------------- | -------------------------------------------- |
| `POST /api/auth/passkey/register/begin` / `finish` | 添加 Passkey                                 |
| `POST /api/auth/passkey/auth/begin` / `finish`     | 登录。传入 `username` 可缩小凭据范围，或省略 |
| `POST /api/auth/passkey/verify/begin` / `finish`   | 登录状态下重新验证（用于加强确认）           |
| `GET /api/auth/passkeys`                           | 列出用户的 Passkey                           |
| `DELETE /api/auth/passkeys/:id`                    | 移除一个                                     |

## GPG 密钥

### `POST /api/auth/gpg-challenge`

请求登录挑战：`{ "identifier": "alice" }`。返回
`{ "challenge": "...", "text": "Prism login\n..." }`。站点的
`gpg_challenge_prefix` 会添加到文本中，以便用户识别你的站点。

### `POST /api/auth/gpg-login`

提交用 `gpg --clearsign` 签名的挑战：

```json
{
  "identifier": "alice",
  "signed_message": "-----BEGIN PGP SIGNED MESSAGE-----\n..."
}
```

挑战仅可使用一次，5 分钟后过期。如果账号已启用 TOTP，且未关闭 **GPG 验证后仍要求 2FA**，第一次调用会返回 `{ "totp_required": true }`；请携带 `totp_code` 重新提交同一消息。

### 管理密钥

`GET`、`POST` 和 `DELETE /api/user/gpg[/:id]` 管理已登录用户的密钥。
`POST` 接受 ASCII armor 格式的 `public_key`，以及可选 `name`；支持 RSA、
EdDSA 和 ML-DSA 密钥。包含多个密钥的 `public_key`（多个块拼接，或
`gpg --export --armor key1 key2` 导出的单个块）会被拆分，每个密钥单独保存。
已注册的密钥会被跳过；有多个密钥时，`name` 会加上 `#1`、`#2`… 后缀。响应为
`{ "keys": [...], "added": <数量>, "skipped": <数量> }`；若所有密钥都已存在，
返回 `409 key_exists`。

`GET /users/:username.gpg` 是公开查询，以 armor 块返回用户密钥（`application/pgp-keys`）。

使用 OAuth：`GET /api/oauth/me/gpg-keys`（`gpg:read`）、`POST` 和
`DELETE /api/oauth/me/gpg-keys/:id`（`gpg:write`）。`POST` 以同样方式拆分密钥；
其响应还会在顶层带上第一个新增密钥的字段。

## 会话

| 端点                             | 用途                                                      |
| -------------------------------- | --------------------------------------------------------- |
| `GET /api/auth/sessions`         | 用户的活动会话，含 IP 及其地理位置                        |
| `GET /api/auth/sessions/:id/ips` | 该会话登录过的每个 IP，含首次/最后出现时间                |
| `DELETE /api/auth/sessions/:id`  | 撤销一个会话                                              |
| `DELETE /api/auth/sessions`      | 撤销除当前会话外的所有会话。返回 `{ "revoked": <count> }` |

## 用户

所有端点都需要认证。

| 端点                                                                       | 用途                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `GET` / `PATCH /api/user/me`                                               | 读取或更新用户（显示名、头像、资料可见性、偏好）                                |
| `POST /api/user/me/change-password`                                        | `{ "current_password", "new_password" }`                                        |
| `POST /api/user/me/avatar`                                                 | `multipart/form-data`，字段 `avatar`。最大 2 MB；JPEG、PNG、WebP 或 GIF         |
| `POST /api/user/me/readme`                                                 | 保存 Markdown README                                                            |
| `POST /api/user/me/readme/sync`                                            | 从用户的 `github.com/<login>/<login>` 仓库同步                                  |
| `GET` / `POST` / `DELETE /api/user/me/emails[/:id]`                        | 管理次要邮箱。`POST /:id/resend` 重发；`POST /:id/set-primary` 验证后切换主邮箱 |
| `GET` / `PUT /api/user/me/notifications`                                   | 通知偏好。参见[通知](notifications.md)                                          |
| `GET` / `POST` / `PUT` / `DELETE /api/user/me/notification-rulesets[/:id]` | 通知规则集。参见[通知](notifications.md)                                        |
| `GET` / `POST` / `DELETE /api/user/tokens[/:id]`                           | 个人访问令牌。值仅在创建时显示。参见[个人访问令牌](personal-access-tokens.md)   |
| `DELETE /api/user/me`                                                      | 删除账号：`{ "password": "...", "confirm": "DELETE" }`                          |

列表端点接受 `?page=`、`?limit=`，通常还接受 `?q=`，并返回 `total`。

## OAuth 应用

所有端点都需要认证。参见 [OAuth / OIDC 指南](oauth.md) 和
[跨应用权限](app-permissions.md)。

| 方法                                | 路径                                         | 说明                                                                                                        |
| ----------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET`                               | `/api/apps`                                  | 当前用户拥有的应用                                                                                          |
| `POST`                              | `/api/apps`                                  | 创建应用                                                                                                    |
| `GET`                               | `/api/apps/:id`                              | 读取应用                                                                                                    |
| `PATCH`                             | `/api/apps/:id`                              | 更新字段，包括 `oidc_fields`、`optional_scopes`、`use_jwt_tokens`、`allow_self_manage_exported_permissions` |
| `POST`                              | `/api/apps/:id/rotate-secret`                | 轮换 `client_secret`                                                                                        |
| `DELETE`                            | `/api/apps/:id`                              | 删除应用                                                                                                    |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/apps/:id/scope-definitions[/:scope]`   | 导出的 scope                                                                                                |
| `GET` / `POST` / `DELETE`           | `/api/apps/:id/scope-access-rules[/:ruleId]` | 谁可以添加或请求应用的 scope                                                                                |
| `GET` / `POST` / `DELETE`           | `/api/apps/:id/access-rules[/:ruleId]`       | [访问白名单](app-access-whitelist.md)                                                                       |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/apps/:appId/webhooks[/:id]`            | [应用通知](app-notifications.md)                                                                            |

应用密钥为只写：仅在创建应用或轮换其密钥时返回生成的密钥。其他情况下只会得到 `has_client_secret`。

## 团队

概念参见[团队](teams.md)。

| 方法                      | 路径                                                                                 | 说明                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `GET`                     | `/api/teams`                                                                         | 用户可访问的团队，包括继承的子团队（`inherited_from`）                                    |
| `POST`                    | `/api/teams`                                                                         | 创建团队。`parent_team_id` 使其成为子团队。站点管理员可设置 `owner_username` / `owner_id` |
| `GET`                     | `/api/teams/:id`                                                                     | 团队详情，含 `my_role`、`ancestors`、`sub_teams` 和第一页成员                             |
| `PATCH`                   | `/api/teams/:id`                                                                     | 更新设置、加入门槛、`parent_team_id`、身份组设置                                          |
| `DELETE`                  | `/api/teams/:id`                                                                     | 解散团队及所有子团队                                                                      |
| `GET` / `POST`            | `/api/teams/:id/sub-teams`                                                           | 列出或创建子团队                                                                          |
| `GET`                     | `/api/teams/:id/members`                                                             | 成员。`?q=`、`?group=`（slug）                                                            |
| `POST`                    | `/api/teams/:id/members`                                                             | 通过 `username` 或 `user_id` 添加成员                                                     |
| `PATCH`                   | `/api/teams/:id/members/:userId`                                                     | 更改角色                                                                                  |
| `DELETE`                  | `/api/teams/:id/members/:userId`                                                     | 移除成员，或退出（自己的 id）                                                             |
| `PATCH`                   | `/api/teams/:id/membership/show-on-profile`                                          | 选择加入或退出团队的公开成员列表                                                          |
| `GET` / `POST`            | `/api/teams/:id/groups`                                                              | 列出或创建[身份组](teams.md#身份组)                                                       |
| `PATCH` / `DELETE`        | `/api/teams/:id/groups/:groupId`                                                     | 更新或删除身份组                                                                          |
| `PUT`                     | `/api/teams/:id/members/:userId/groups`                                              | 替换成员的身份组：`{ "group_ids": [...] }`                                                |
| `POST`                    | `/api/teams/:id/transfer-ownership`                                                  | 将所有权转移给另一名成员                                                                  |
| `GET` / `POST`            | `/api/teams/:id/invites`                                                             | 列出或创建邀请（邮箱锁定、最大使用次数、一个身份组、绝对 `expires_at`）                   |
| `PATCH` / `DELETE`        | `/api/teams/:id/invites/:token`                                                      | 编辑、启用/禁用或撤销邀请                                                                 |
| `GET`                     | `/api/teams/join/:token`                                                             | 预览邀请：团队、门槛、未满足项（认证可选）                                                |
| `POST`                    | `/api/teams/join/:token`                                                             | 接受邀请                                                                                  |
| `GET` / `POST` / `DELETE` | `/api/teams/:id/domains[/:domainId]`                                                 | 团队域名                                                                                  |
| `POST`                    | `/api/teams/:id/domains/:domainId/verify`                                            | 重新验证                                                                                  |
| `POST`                    | `/api/teams/:id/domains/:domainId/share-to-team`, `share-to-personal`, `to-personal` | 将个人域名共享给团队、反向操作或移出                                                      |
| `GET` / `POST`            | `/api/teams/:id/apps`                                                                | 团队拥有的应用                                                                            |
| `POST` / `DELETE`         | `/api/teams/:id/apps/transfer`, `/api/teams/:id/apps/:appId/transfer`                | 将个人应用移入团队，或移回                                                                |

### 邀请链接注册

参见[团队 → 邀请链接注册](teams.md#邀请链接注册)。

| 方法   | 路径                             | 说明                                         |
| ------ | -------------------------------- | -------------------------------------------- |
| `GET`  | `/api/join/:teamId`              | 公开。团队品牌、门槛和验证码配置             |
| `POST` | `/api/auth/register-with-invite` | 创建待处理账号并登录                         |
| `GET`  | `/api/auth/invite-join/status`   | 待处理账号仍需满足的条件                     |
| `POST` | `/api/auth/invite-join/complete` | 满足门槛后加入团队                           |
| `GET`  | `/api/user/me/restriction`       | 调用者是否受限，以及是否可以转换             |
| `POST` | `/api/user/me/convert`           | 转换为完整账号（单向；需要已验证的真实邮箱） |

## 域名

| 方法     | 路径                      | 说明                                                        |
| -------- | ------------------------- | ----------------------------------------------------------- |
| `GET`    | `/api/domains`            | 用户的域名                                                  |
| `POST`   | `/api/domains`            | 添加域名。返回验证选项（DNS TXT、HTML meta、`.well-known`） |
| `POST`   | `/api/domains/:id/verify` | 立即检查验证                                                |
| `DELETE` | `/api/domains/:id`        | 移除                                                        |

## 社交连接

| 方法     | 路径                               | 说明                                                              |
| -------- | ---------------------------------- | ----------------------------------------------------------------- |
| `GET`    | `/api/connections`                 | 用户已关联的账号                                                  |
| `POST`   | `/api/connections/intent`          | 获取用于关联提供商 的短期令牌                                     |
| `GET`    | `/api/connections/:slug/begin`     | 开始登录（`?mode=login`）或关联（`?mode=connect&intent=<token>`） |
| `GET`    | `/api/connections/:slug/callback`  | 提供商的重定向目标                                                |
| `POST`   | `/api/connections/:slug/tg-verify` | 验证 Telegram 登录数据                                            |
| `POST`   | `/api/connections/:id/refresh`     | 从提供商 刷新显示名和头像                                         |
| `DELETE` | `/api/connections/:id`             | 取消关联                                                          |

该流程必须在发起它的浏览器中于 10 分钟内完成。
OAuth 令牌等价端点：`GET /api/oauth/me/social-connections`（`social:read`）
和 `DELETE /api/oauth/me/social-connections/:id`（`social:write`）。

## OAuth 2.0 / OIDC

流程说明参见 [OAuth / OIDC 指南](oauth.md)。

| 方法                 | 路径                                      | 说明                             |
| -------------------- | ----------------------------------------- | -------------------------------- |
| `GET`                | `/api/oauth/authorize`                    | 授权页面的应用信息和请求的 scope |
| `POST`               | `/api/oauth/authorize`                    | 批准或拒绝                       |
| `POST`               | `/api/oauth/par`                          | 推送授权请求（RFC 9126）         |
| `POST`               | `/api/oauth/register`                     | 动态客户端注册（RFC 7591）       |
| `GET`/`PUT`/`DELETE` | `/api/oauth/register/:client_id`          | 客户端管理（RFC 7592）           |
| `POST`               | `/api/oauth/token`                        | 授权码、刷新、设备和令牌交换授权 |
| `POST`               | `/api/oauth/device_authorization`         | 设备授权（RFC 8628）             |
| `GET` / `POST`       | `/api/oauth/userinfo`                     | OIDC UserInfo                    |
| `POST`               | `/api/oauth/introspect`                   | RFC 7662                         |
| `POST`               | `/api/oauth/revoke`                       | RFC 7009                         |
| `GET` / `POST`       | `/api/oauth/end_session`                  | RP 发起的登出                    |
| `GET`                | `/.well-known/openid-configuration`       | OpenID Connect Discovery         |
| `GET`                | `/.well-known/oauth-authorization-server` | RFC 8414 元数据                  |
| `GET`                | `/.well-known/oauth-protected-resource`   | RFC 9728 元数据                  |
| `GET`                | `/.well-known/webfinger`                  | 颁发者发现                       |
| `GET`                | `/.well-known/jwks.json`                  | 公共签名密钥                     |
| `GET`                | `/.well-known/security.txt`               | 配置安全联系人时                 |
| `GET`                | `/.well-known/change-password`            | 重定向到修改密码页面             |

### 加强 2FA

| 方法   | 路径                         | 认证                              |
| ------ | ---------------------------- | --------------------------------- |
| `POST` | `/api/oauth/2fa/challenges`  | 应用凭据（HTTP Basic）或 PKCE     |
| `POST` | `/api/oauth/2fa/verify`      | 应用凭据 — 用重定向 code 交换结果 |
| `POST` | `/api/oauth/2fa/sudo/revoke` | 用户会话 — 结束 Sudo 模式窗口     |

其他加强端点用于 Prism 自己的确认页面。

### `/api/oauth/me/*` (令牌认证)

这些端点接受 OAuth access token 或个人访问令牌。scope 列于
[OAuth → 权限范围](oauth.md#权限范围)。

| 路径                                                                     | Scope                                                          |
| ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `GET /me/profile`                                                        | `profile`                                                      |
| `PATCH /me/profile`                                                      | `profile:write`                                                |
| `GET` / `POST` / `PATCH` / `DELETE /me/apps[/:id]`                       | `apps:read` / `apps:write`                                     |
| `GET /me/team-apps`                                                      | `apps:read`                                                    |
| `GET` / `POST` / `PATCH` / `DELETE /me/teams[/:id]`                      | `teams:read` / `teams:create` / `teams:write` / `teams:delete` |
| `POST` / `DELETE /me/teams/:id/members`                                  | `teams:write`                                                  |
| `GET` / `POST` / `DELETE /me/domains`, `POST /me/domains/:domain/verify` | `domains:read` / `domains:write`                               |
| `GET` / `POST` / `DELETE /me/gpg-keys`                                   | `gpg:read` / `gpg:write`                                       |
| `GET` / `DELETE /me/social-connections`                                  | `social:read` / `social:write`                                 |
| `GET` / `PATCH` / `DELETE /me/admin/users`                               | `admin:users:read` / `:write` / `:delete`                      |
| `GET` / `PATCH /me/admin/config`                                         | `admin:config:read` / `admin:config:write`                     |
| `GET` / `POST` / `DELETE /me/invites`                                    | `admin:invites:read` / `:create` / `:delete`                   |
| `GET /me/team/:teamId/info`, `PATCH`                                     | `team:<id>:read` / `team:<id>:write`                           |
| `GET` / `POST` / `PATCH` / `DELETE /me/team/:teamId/members[...]`        | `team:<id>:member:read` / `team:<id>:member:write`             |
| `GET /me/team/:teamId/members/:userId/profile`                           | `team:<id>:member:profile:read`                                |

`/me/team/:teamId/...` 路径需要绑定到该团队的令牌（参见
[OAuth → 团队 scope](oauth.md#团队-scope)）；仅有 `teams:*` 令牌不够。

`POST /me/domains` 接受 `{ "domain": "example.com" }`，返回 `201`，包含域名的
`id`、`domain`、`verification_token`、`verified`，以及各验证方式所需的值：
`txt_record` / `txt_value`（DNS TXT）、`http_url` / `http_path` / `http_value`
（`.well-known` 文件）和 `meta_tag`（HTML meta）。如果用户已有一个已验证的上级域名
（例如添加 `app.example.com` 时已验证 `example.com`），新域名会立即通过验证：
`verified` 为 `true`，`verified_by_parent` 为该上级域名。

### `GET /api/oauth/consents` / `DELETE /api/oauth/consents/:client_id`

列出当前用户已授权的应用，或撤销其中一个。撤销会移除该应用的授权以及所有未过期令牌。

## 搜索

### `GET /api/search?q=<text>`

驱动命令面板（Ctrl/⌘ K）。需要会话。匹配名称中包含 `q`（至少 2 个字符）的条目，每种类型最多返回 5 条结果：

```json
{
  "results": [
    {
      "kind": "app",
      "admin": false,
      "id": "…",
      "title": "My app",
      "subtitle": "prism_…",
      "url": "/apps/…"
    }
  ]
}
```

`kind` 为 `app`、`team`、`domain`、`token`、`consent`、`user` 或 `oauth_source`。
管理员还会获得全站结果（`admin: true`）。

## 公开资料

### `GET /api/users/:username`

用户的公开资料，按用户选择分享的内容过滤。如果用户不存在、为私有或公开资料功能已关闭，返回 `404`；三种情况下响应相同。参见[公开资料](public-profile.md)。

### `GET /api/public/teams/:id`

团队公开资料，遵循相同的 `404` 规则。包含 `sub_teams`（仅自身也公开的子团队）以及当父团队公开时的 `parent_team` 面包屑。

## 头像代理

远程头像和图标图片通过 Prism 提供，因此页面不会直接加载第三方图片。

- `POST /api/proxy/image/register`（需认证）注册远程 HTTPS 图片 URL，并返回 `{ "id": "...", "url": "/api/proxy/image/<id>" }`。私有和保留地址会被拒绝。
- `GET /api/proxy/image/:id` 提供图片。可安全嵌入，SVG 会被清理，超过 5 MiB 的图片会被拒绝。只有已注册的 ID 可用；它不是开放代理。

## 管理

所有管理端点都需要具有管理员角色的用户。管理面板为每个管理操作使用对应的 `/api/admin/*` 端点；主要端点如下：

| 路径                                                                                            | 用途                                                                      |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `GET` / `PATCH /api/admin/config`                                                               | 读取或更新设置。密钥会被脱敏，并在写入时加密                              |
| `GET /api/admin/stats`                                                                          | 总计                                                                      |
| `GET /api/admin/users`, `GET` / `PATCH` / `DELETE /api/admin/users/:id`                         | 列出、读取、更新（角色、启用状态、邮箱、按用户令牌有效期）或删除用户      |
| `DELETE /api/admin/users/:id/sessions`                                                          | 撤销用户的所有会话                                                        |
| `POST /api/admin/users/bulk`                                                                    | `{ user_ids, action }` — `activate`、`deactivate` 或 `delete`；最多 50 个 |
| `GET` / `PATCH /api/admin/apps[/:id]`                                                           | 验证或停用应用                                                            |
| `POST /api/admin/apps/:id/transfer`                                                             | `{ owner_id }` 或 `{ team_id }`                                           |
| `GET` / `POST` / `PATCH` / `DELETE /api/admin/oauth-sources[/:id]`                              | 管理 OAuth 来源                                                           |
| `GET /api/admin/oauth-sources/discover`                                                         | 获取颁发者的 OIDC discovery                                               |
| `GET` / `POST` / `DELETE /api/admin/invites[/:id]`                                              | 站点邀请                                                                  |
| `GET /api/admin/teams`, `DELETE /api/admin/teams/:id`                                           | 列出或解散团队                                                            |
| `GET /api/admin/domains`, `POST /api/admin/domains/:id/verify`, `DELETE /api/admin/domains/:id` | 域名，包括强制验证                                                        |
| `GET /api/admin/audit-log`                                                                      | 平台审计日志                                                              |
| `GET /api/audit/:scope/export`                                                                  | 导出你有权读取的审计日志：`?format=csv\|json`，最多 10,000 个事件         |
| `GET /api/admin/login-errors`                                                                   | 失败的登录                                                                |
| `POST /api/admin/test-email`                                                                    | 发送测试邮件                                                              |
| `GET /api/notices`, `POST /api/notices/:id/dismiss`                                             | 当前查看者的公告（公开公告在未登录时也可用）                              |

数据库控制台、键值浏览器、密钥迁移、公告编辑器、scope 授权和其他维护工具均由管理面板驱动；参见[管理指南](admin.md)。

## 健康检查

### `GET /api/health`

返回 `{ "ok": true }`。无需认证。
