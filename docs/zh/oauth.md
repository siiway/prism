---
title: OAuth / OIDC 指南
description: 将 Prism 作为 OAuth 2.0 / OpenID Connect 提供商进行集成——授权码流程、PKCE、权限范围、令牌交换与内省。
---

# OAuth 2.0 / OIDC 集成指南

Prism 是一个符合标准的 OAuth 2.0 授权服务器和 OpenID Connect 提供商。任何支持 OAuth 2.0 授权码流程的应用都可以使用 Prism 作为其身份提供商。

## Discovery

OpenID Connect Discovery 文档位于：

```
https://your-prism-domain/.well-known/openid-configuration
```

大多数 OAuth/OIDC 库可以从此 URL 自动完成配置。

## 注册应用程序

1. 登录 Prism，前往 **Apps → New Application**
2. 填写名称、描述和重定向 URI
3. 复制 **Client ID** 和 **Client Secret**——密钥仅显示一次

如果你的应用完全运行在浏览器端（没有服务端来保密密钥），请启用**公共客户端**。公共客户端必须使用 PKCE，没有客户端密钥。

## 授权码流程（含 PKCE）

### 第一步 — 重定向用户

```
GET https://your-prism-domain/api/oauth/authorize
  ?response_type=code
  &client_id=<CLIENT_ID>
  &redirect_uri=https://yourapp.com/callback
  &scope=openid profile email
  &state=<RANDOM_STATE>
  &code_challenge=<CODE_CHALLENGE>
  &code_challenge_method=S256
```

**PKCE** — 生成一个 `code_verifier`（43–128 个随机 URL 安全字符），然后：

```
code_challenge = BASE64URL(SHA-256(ASCII(code_verifier)))
```

**权限范围**

| 范围             | 包含的声明                                              |
| ---------------- | ------------------------------------------------------- |
| `openid`         | `sub`、`iss`、`aud`、`iat`、`exp`（OIDC 必须）          |
| `profile`        | `name`、`preferred_username`、`picture`                 |
| `email`          | `email`、`email_verified`                               |
| `apps:read`      | 用户拥有的应用列表                                      |
| `offline_access` | 启用刷新令牌颁发                                        |

### 第二步 — 用户授权

Prism 显示授权页面，列出你的应用名称和请求的权限范围。如果用户已经对相同的权限范围授权过，则自动跳过授权页面。

### 第三步 — 接收授权码

Prism 重定向到你的 `redirect_uri`：

```
https://yourapp.com/callback?code=<AUTH_CODE>&state=<STATE>
```

请务必验证 `state` 与你发送的值一致。

### 第四步 — 换取令牌

```http
POST /api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=<AUTH_CODE>
&redirect_uri=https://yourapp.com/callback
&client_id=<CLIENT_ID>
&client_secret=<CLIENT_SECRET>
&code_verifier=<CODE_VERIFIER>
```

公共客户端省略 `client_secret`，必须包含 `code_verifier`。

**响应**

```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "...",
  "id_token": "...",
  "scope": "openid profile email"
}
```

### 第五步 — 调用 UserInfo

```http
GET /api/oauth/userinfo
Authorization: Bearer <ACCESS_TOKEN>
```

**响应**

```json
{
  "sub": "user-id",
  "name": "Alice",
  "preferred_username": "alice",
  "email": "alice@example.com",
  "email_verified": true,
  "picture": "https://your-prism-domain/api/assets/avatars/..."
}
```

## 刷新令牌

```http
POST /api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token=<REFRESH_TOKEN>
&client_id=<CLIENT_ID>
&client_secret=<CLIENT_SECRET>
```

## 令牌内省（RFC 7662）

用于服务端间验证，无需解析 JWT：

```http
POST /api/oauth/introspect
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <base64(client_id:client_secret)>

token=<ACCESS_TOKEN>
```

**响应（有效令牌）**

```json
{
  "active": true,
  "sub": "user-id",
  "scope": "openid profile",
  "client_id": "...",
  "exp": 1234567890,
  "iat": 1234564290
}
```

## 令牌撤销（RFC 7009）

```http
POST /api/oauth/revoke
Content-Type: application/x-www-form-urlencoded

token=<ACCESS_OR_REFRESH_TOKEN>
&client_id=<CLIENT_ID>
&client_secret=<CLIENT_SECRET>
```

## ID 令牌

ID 令牌是一个签名的 JWT（HS256）。可通过获取 `/.well-known/jwks.json` 的 JWKS，或调用内省端点来验证。

标准声明：

| 声明    | 值                        |
| ------- | ------------------------- |
| `iss`   | 你的 Prism 实例 URL       |
| `sub`   | 稳定的用户 ID             |
| `aud`   | 你的 `client_id`          |
| `iat`   | 颁发时间戳                |
| `exp`   | 过期时间戳                |
| `nonce` | 从授权请求中原样返回      |

## 错误响应

授权错误会重定向到你的 `redirect_uri`，附带：

```
?error=access_denied&error_description=User+denied+access
```

令牌端点错误返回 HTTP 400：

```json
{ "error": "invalid_grant", "error_description": "Code expired or invalid" }
```

常见错误码：`invalid_request`、`invalid_client`、`invalid_grant`、`unauthorized_client`、`unsupported_grant_type`、`access_denied`。
