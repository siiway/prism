# API 参考

基础路径：`/api`

所有端点均返回 JSON。需要认证的端点要求携带 `Authorization: Bearer <token>` 请求头。令牌是登录或社交回调时颁发的 JWT。

## 初始化

### `GET /api/init/status`

返回实例是否已完成初始化。

**响应**

```json
{ "initialized": false }
```

### `POST /api/init`

创建第一个管理员账号。仅在 `initialized = false` 时有效。

**请求体**

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

供前端使用的公开站点配置，无需认证。

**响应**

```json
{
  "site_name": "Prism",
  "site_description": "...",
  "site_icon_url": null,
  "allow_registration": true,
  "captcha_provider": "none",
  "captcha_site_key": "",
  "pow_difficulty": 20,
  "accent_color": "#0078d4",
  "custom_css": "",
  "initialized": true,
  "require_email_verification": false,
  "email_verify_methods": "both",
  "enabled_providers": ["github", "google"]
}
```

## 认证

### `POST /api/auth/register`

**请求体**

```json
{
  "email": "user@example.com",
  "username": "alice",
  "password": "hunter2",
  "display_name": "Alice",
  "captcha_token": "...",
  "pow_challenge": "...",
  "pow_nonce": 12345
}
```

根据当前启用的验证码提供商，包含对应的机器人防护字段。

**响应** — `{ "token": "...", "user": { ... } }`

### `POST /api/auth/login`

**请求体**

```json
{
  "identifier": "alice",
  "password": "hunter2",
  "totp_code": "123456",
  "captcha_token": "..."
}
```

`identifier` 接受用户名或邮箱。仅在启用 TOTP 时需要提供 `totp_code`。

**响应**

```json
{ "token": "...", "user": { ... } }
```

如果已启用 TOTP 但未提供验证码：

```json
{ "totp_required": true }
```

### `POST /api/auth/logout`

撤销当前会话。需要认证。

### `GET /api/auth/verify-email?token=<token>`

使用邮件中发送的令牌验证邮箱地址。

### `POST /api/auth/resend-verify-email`

重新发送邮箱验证链接。需要认证。接受可选的验证码字段。

**请求体** — `{ "captcha_token": "...", "pow_challenge": "...", "pow_nonce": 12345 }`

**响应** — `{ "message": "Verification email sent" }`

### `POST /api/auth/email-verify-code`

返回一个验证邮箱地址，用户可以向该地址发送邮件来验证邮箱。地址格式为 `verify-<code>@<domain>`。需要认证。接受可选的验证码字段。

**请求体** — `{ "captcha_token": "...", "pow_challenge": "...", "pow_nonce": 12345 }`

**响应** — `{ "address": "verify-abc123@example.com", "code": "abc123" }`

### `GET /api/auth/pow-challenge`

返回工作量证明验证码提供商所需的挑战。

**响应** — `{ "challenge": "...", "difficulty": 20 }`

## TOTP（双因素认证）

所有端点均需要认证。

### `POST /api/auth/totp/setup`

生成新的 TOTP 密钥。返回密钥和用于生成二维码的 `otpauth://` URI。

**响应** — `{ "secret": "...", "uri": "otpauth://totp/..." }`

### `POST /api/auth/totp/verify`

验证首个验证码，确认 TOTP 设置。返回备用码。

**请求体** — `{ "code": "123456" }`

**响应** — `{ "message": "TOTP enabled", "backup_codes": ["XXXX-YYYY", ...] }`

### `DELETE /api/auth/totp`

禁用 TOTP。需要提供有效的当前 TOTP 验证码或备用码。

**请求体** — `{ "code": "123456" }`

### `POST /api/auth/totp/backup-codes`

重新生成备用码。需要有效的 TOTP 验证码。

**请求体** — `{ "code": "123456" }`

**响应** — `{ "backup_codes": ["XXXX-YYYY", ...] }`

## Passkeys（WebAuthn）

### `POST /api/auth/passkey/register/begin`

为已认证用户开始 Passkey 注册。返回 WebAuthn `PublicKeyCredentialCreationOptions`。

### `POST /api/auth/passkey/register/finish`

**请求体** — `{ "response": <AuthenticatorAttestationResponse>, "name": "My YubiKey" }`

### `POST /api/auth/passkey/auth/begin`

开始 Passkey 认证（无需认证）。

**请求体** — `{ "username": "alice" }`（可选——省略则使用可发现凭据）

### `POST /api/auth/passkey/auth/finish`

**请求体** — `{ "challenge": "...", "response": <AuthenticatorAssertionResponse> }`

**响应** — `{ "token": "...", "user": { ... } }`

### `GET /api/auth/passkeys`

列出已认证用户注册的所有 Passkeys。

### `DELETE /api/auth/passkeys/:id`

按 ID 删除 Passkey。

## GPG 密钥

### `POST /api/auth/gpg-challenge`

为 GPG 登录请求一次性挑战码。每 IP 每分钟限速 30 次。

**请求体**

```json
{ "identifier": "alice" }
```

**响应**

```json
{
  "challenge": "a3f8...",
  "text": "Prism login\nUser: alice\nChallenge: a3f8...\nTimestamp: 1710000000"
}
```

使用 `gpg --clearsign` 对返回的 `text` 进行签名，然后将输出传递给 `/api/auth/gpg-login`。

### `POST /api/auth/gpg-login`

提交已签名的挑战码完成 GPG 登录。每 IP 每分钟限速 10 次。

**请求体**

```json
{
  "identifier": "alice",
  "signed_message": "-----BEGIN PGP SIGNED MESSAGE-----\n..."
}
```

**响应** — `{ "token": "...", "user": { ... } }`

挑战码为一次性使用，5 分钟后过期。

### `GET /api/user/gpg`

列出已认证用户注册的所有 GPG 密钥。需要会话认证。

**响应**

```json
{
  "keys": [
    {
      "id": "...",
      "fingerprint": "abc123...",
      "key_id": "...",
      "name": "我的笔记本密钥",
      "created_at": 1710000000,
      "last_used_at": 1710100000
    }
  ]
}
```

### `POST /api/user/gpg`

添加 GPG 公钥。需要会话认证。

**请求体**

```json
{
  "public_key": "-----BEGIN PGP PUBLIC KEY BLOCK-----\n...",
  "name": "我的笔记本密钥"
}
```

若省略 `name`，则使用密钥中的第一个用户 ID 作为标签。

### `DELETE /api/user/gpg/:id`

按 ID 删除 GPG 密钥。需要会话认证。

### `GET /users/:username.gpg`

公开端点——以 ASCII Armor 格式返回用户注册的所有 GPG 公钥，每个密钥块之间以空行分隔。`Content-Type: application/pgp-keys`。若用户未注册任何密钥则返回 `404`。

```
curl https://your-prism-domain/users/alice.gpg
```

### OAuth 范围授权的 GPG 端点

以下端点接受 OAuth 访问令牌或 PAT，无需会话 Cookie：

| 方法     | 路径                         | 所需范围    |
|----------|------------------------------|-------------|
| `GET`    | `/api/oauth/me/gpg-keys`     | `gpg:read`  |
| `POST`   | `/api/oauth/me/gpg-keys`     | `gpg:write` |
| `DELETE` | `/api/oauth/me/gpg-keys/:id` | `gpg:write` |

请求/响应格式与上述会话认证端点一致。

### OAuth 范围授权的社交连接端点

以下端点接受 OAuth 访问令牌或 PAT，无需会话 Cookie：

| 方法     | 路径                                   | 所需范围       |
|----------|----------------------------------------|----------------|
| `GET`    | `/api/oauth/me/social-connections`     | `social:read`  |
| `DELETE` | `/api/oauth/me/social-connections/:id` | `social:write` |

请求/响应格式与上述会话认证端点一致。

## 会话

### `GET /api/auth/sessions`

列出已认证用户的活跃会话。

### `DELETE /api/auth/sessions/:id`

按 ID 撤销会话。

## 用户

所有端点均需要认证。

### `GET /api/user/me`

**响应**

```json
{
  "user": {
    "id": "...",
    "email": "...",
    "username": "...",
    "display_name": "...",
    "avatar_url": null,
    "role": "user",
    "email_verified": true
  },
  "totp_enabled": false,
  "passkey_count": 1
}
```

### `PATCH /api/user/me`

**请求体** — `{ "display_name": "Alice", "avatar_url": "https://..." }`

### `POST /api/user/me/change-password`

**请求体** — `{ "current_password": "...", "new_password": "..." }`

### `POST /api/user/me/avatar`

`multipart/form-data`，字段名为 `avatar`。最大 2 MB，支持 JPEG、PNG、WebP、GIF。

**响应** — `{ "avatar_url": "/api/assets/avatars/..." }`

### `DELETE /api/user/me`

永久删除账号。

**请求体** — `{ "password": "...", "confirm": "DELETE" }`

## OAuth 应用

所有端点均需要认证。

### `GET /api/apps`

列出当前用户拥有的应用。

### `POST /api/apps`

**请求体**

```json
{
  "name": "My App",
  "description": "...",
  "website_url": "https://myapp.com",
  "redirect_uris": ["https://myapp.com/callback"],
  "allowed_scopes": ["openid", "profile", "email"],
  "is_public": false
}
```

### `GET /api/apps/:id`

### `PATCH /api/apps/:id`

部分更新——字段与创建时相同。

### `POST /api/apps/:id/rotate-secret`

生成新的 `client_secret`，旧密钥立即失效。

**响应** — `{ "client_secret": "..." }`

### `DELETE /api/apps/:id`

## 域名

所有端点均需要认证。

### `GET /api/domains`

列出当前用户的已验证和未验证域名。

### `POST /api/domains`

**请求体** — `{ "domain": "example.com", "app_id": "optional-app-id" }`

**响应** — 包含 `txt_record`（主机名）和 `txt_value`（需添加为 DNS TXT 记录的令牌）。

### `POST /api/domains/:id/verify`

触发 DNS 验证检查。查询 `_prism-verify.domain` 的 TXT 记录。

**响应** — `{ "verified": true, "next_reverify_at": 1234567890 }`

### `DELETE /api/domains/:id`

## 社交关联

### `GET /api/connections`

列出已认证用户已关联的社交提供商。

### `GET /api/connections/:provider/begin`

重定向到 `provider`（`github`、`google`、`microsoft`、`discord`）的 OAuth 授权 URL。

查询参数：

- `mode=login`（默认）— 使用该提供商登录或注册
- `mode=connect` — 将提供商绑定到已登录的现有账号

### `GET /api/connections/:provider/callback`

OAuth 回调自动处理。成功时重定向到 `/auth/callback?token=...`，失败时重定向到 `/connections?error=...`。

### `DELETE /api/connections/:provider`

断开当前账号与提供商的关联。需要认证。

## OAuth 2.0 / OIDC

完整的集成说明请参阅 [OAuth / OIDC 指南](oauth.md)。

### `GET /api/oauth/authorize`

返回授权页面所需的应用信息和请求的权限范围。

### `POST /api/oauth/authorize`

批准或拒绝授权请求。

**请求体**

```json
{
  "client_id": "...",
  "redirect_uri": "https://app.example.com/callback",
  "scope": "openid profile email",
  "state": "random-state",
  "code_challenge": "...",
  "code_challenge_method": "S256",
  "action": "approve"
}
```

### `POST /api/oauth/token`

令牌端点。支持 `authorization_code` 和 `refresh_token` 授权类型。

### `GET /api/oauth/userinfo`

以 OpenID Connect 格式返回已认证用户的个人资料。

### `POST /api/oauth/introspect`

RFC 7662 令牌内省。

### `POST /api/oauth/revoke`

RFC 7009 令牌撤销。

### `GET /.well-known/openid-configuration`

OpenID Connect Discovery 文档。

## 管理员

所有管理员端点均需要 `role = admin` 的认证。

### 配置

- `GET /api/admin/config` — 所有配置键值对
- `PATCH /api/admin/config` — 更新一个或多个键

### 统计

- `GET /api/admin/stats` — `{ users, apps, verified_domains, active_tokens }`

### 用户

- `GET /api/admin/users?page=1&limit=20&search=alice`
- `GET /api/admin/users/:id`
- `PATCH /api/admin/users/:id` — 更新 `role`、`is_active`、`email_verified`
- `DELETE /api/admin/users/:id`

### 应用

- `GET /api/admin/apps?page=1`
- `PATCH /api/admin/apps/:id` — 更新 `is_verified`、`is_active`

### 审计日志

- `GET /api/admin/audit-log?page=1`

## 健康检查

### `GET /api/health`

始终返回 `{ "ok": true }`，无需认证。
