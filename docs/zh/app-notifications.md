---
title: 应用通知
description: 通过 Webhook、SSE 和 WebSocket 向 OAuth 应用实时推送事件。
---

# 应用通知

Prism 可在特定事件发生时通知您的 OAuth 应用——例如用户授权访问、撤销访问，或更新个人资料。

支持三种推送渠道：

| 渠道        | 适用场景                             |
|-------------|--------------------------------------|
| Webhook     | 服务端对服务端推送；每个事件独立触发  |
| SSE         | 服务端流式推送（Node.js、Bun、Workers）|
| WebSocket   | 双向通信；同样适用于浏览器            |

三种渠道共享相同的事件类型和载荷格式。

## 身份验证

SSE 和 WebSocket 连接使用应用凭据通过 **HTTP Basic 认证**（`client_id:client_secret`）进行身份验证。

在无法设置请求头的浏览器 WebSocket 中，可将凭据作为查询参数传递：

```
?client_id=<clientId>&client_secret=<clientSecret>
```

Webhook 管理接口需要具有该应用写权限的用户 **Bearer 令牌**。

## 事件类型

| 事件类型              | 触发时机                                          |
|-----------------------|---------------------------------------------------|
| `user.token_granted`  | 用户完成 OAuth 授权流程，向您的应用授予访问权限   |
| `user.token_revoked`  | 用户在设置中撤销了对您应用的授权                  |
| `user.updated`        | 已授权您应用的用户更新了其个人资料                |
| `*`                   | 通配符——订阅以上所有事件                          |

### 载荷格式

每个事件（Webhook 请求体、SSE `data:` 行或 WebSocket 消息）均为 JSON 对象：

```json
{
  "event": "user.token_granted",
  "timestamp": 1741564800,
  "data": { ... }
}
```

#### `user.token_granted`

```json
{
  "event": "user.token_granted",
  "timestamp": 1741564800,
  "data": {
    "user_id": "usr_abc123",
    "scopes": ["openid", "profile", "email"],
    "granted_at": 1741564800
  }
}
```

#### `user.token_revoked`

```json
{
  "event": "user.token_revoked",
  "timestamp": 1741564800,
  "data": {
    "user_id": "usr_abc123"
  }
}
```

#### `user.updated`

```json
{
  "event": "user.updated",
  "timestamp": 1741564800,
  "data": {
    "user_id": "usr_abc123",
    "username": "alice",
    "display_name": "Alice"
  }
}
```

---

## Webhook

Webhook 以应用为单位注册。事件触发时，Prism 向每个订阅了该事件类型的活跃 Webhook URL 发送一个带签名的 `POST` 请求。

### API 端点

```
GET    /api/apps/:appId/webhooks
POST   /api/apps/:appId/webhooks
PATCH  /api/apps/:appId/webhooks/:webhookId
DELETE /api/apps/:appId/webhooks/:webhookId
POST   /api/apps/:appId/webhooks/:webhookId/test
GET    /api/apps/:appId/webhooks/:webhookId/deliveries
```

所有端点均需要 `Authorization: Bearer <user-token>`，且令牌所有者需拥有该应用的写权限。

### 创建 Webhook

**POST `/api/apps/:appId/webhooks`**

```json
{
  "url": "https://example.com/hooks/prism",
  "events": ["user.token_granted", "user.token_revoked"],
  "secret": "可选自定义密钥"
}
```

若省略 `secret`，Prism 将自动生成一个 32 字节的随机十六进制字符串。密钥**仅在创建响应中返回**——请妥善保存。

响应：

```json
{
  "id": "wh_xyz789",
  "app_id": "app_abc123",
  "url": "https://example.com/hooks/prism",
  "secret": "prism-generated-or-supplied-secret",
  "events": ["user.token_granted", "user.token_revoked"],
  "is_active": true,
  "created_at": 1741564800,
  "updated_at": 1741564800
}
```

### 验证签名

每个 Webhook 请求均包含 `X-Prism-Signature` 请求头：

```
X-Prism-Signature: sha256=<hex-digest>
X-Prism-Event: user.token_granted
X-Prism-Delivery: <uuid>
```

摘要为使用 Webhook 密钥对原始请求体进行 HMAC-SHA256 计算的结果。

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verifySignature(secret, rawBody, signatureHeader) {
  const expected = "sha256=" + createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}
```

请始终使用**时序安全比较**（`timingSafeEqual`）以防止计时攻击。返回 `2xx` 表示成功接收；其他状态码均记录为失败。

### 投递历史

`GET /api/apps/:appId/webhooks/:webhookId/deliveries` 返回最近 50 条投递记录：

```json
{
  "deliveries": [
    {
      "id": "del_001",
      "webhook_id": "wh_xyz789",
      "event_type": "user.token_granted",
      "response_status": 200,
      "success": true,
      "delivered_at": 1741564800
    }
  ]
}
```

### 测试推送

**POST `/api/apps/:appId/webhooks/:webhookId/test`**

立即发送一个合成的 `ping` 事件。

```json
{ "success": true, "status": 200 }
```

---

## Server-Sent Events（SSE）

```
GET /api/apps/:appId/events/sse
```

建立持久 SSE 流。服务端每 2 秒轮询新事件并及时推送。

**身份验证** — HTTP Basic 请求头：

```
Authorization: Basic <base64(clientId:clientSecret)>
```

或作为查询参数（适用于浏览器 `EventSource` 无法设置请求头的场景）：

```
?client_id=<clientId>&client_secret=<clientSecret>
```

**续传** — 传递 `Last-Event-ID` 请求头（或 `?lastEventId=`）以从已知事件 ID 处恢复，避免断线后丢失事件。

每帧 SSE 格式：

```
id: 42
event: user.token_granted
data: {"event":"user.token_granted","timestamp":1741564800,"data":{"user_id":"usr_abc123","scopes":["openid","profile"],"granted_at":1741564800}}

```

---

## WebSocket

```
GET /api/apps/:appId/events/ws
```

升级为 WebSocket 连接。服务端以 JSON 文本帧推送事件。

**身份验证** — HTTP Basic 请求头或查询参数（与 SSE 相同）。

每条消息帧：

```json
{
  "event": "user.token_granted",
  "timestamp": 1741564800,
  "data": {
    "user_id": "usr_abc123",
    "scopes": ["openid", "profile"],
    "granted_at": 1741564800
  }
}
```

### 浏览器示例

```js
const ws = new WebSocket(
  `wss://your-prism.example/api/apps/${appId}/events/ws` +
  `?client_id=${clientId}&client_secret=${clientSecret}`
);

ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  console.log(msg.event, msg.data);
});
```

---

## 安全建议

- 将 `client_secret` 保存在服务端，切勿暴露于浏览器 JavaScript 或移动端二进制包中。
- 处理载荷前务必验证 Webhook 签名。
- 在 10 秒内响应 Webhook；超时将记录为失败。
- 重连 SSE 时使用 `Last-Event-ID` / `lastEventId` 以避免丢失事件。
- 如 `client_secret` 泄露，请立即轮换。
