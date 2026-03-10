---
title: Webhooks
description: 在 Prism 中发生事件时，通过 HTTP 实时接收通知。
---

# Webhooks

Prism 可以在发生重要事件时，向您指定的 URL 发送 HTTP POST 请求。Webhook 分为两种范围：

- **用户 Webhook** — 由任意用户配置；当**该用户**触发事件时触发（创建/更新/删除应用、添加/验证/删除域名、更新个人资料）。
- **管理员 Webhook** — 仅管理员可配置；当审计日志事件发生时触发（用户删除、配置变更等）。

两种类型共享相同的载荷格式、签名机制和投递行为。

## 工作原理

1. 创建一个 Webhook，配置端点 URL、密钥和订阅的事件列表。
2. 当匹配事件被触发时，Prism 向该 URL 发送签名的 JSON 载荷。
3. Prism 记录 HTTP 响应，并将其存入该 Webhook 的投递历史。

投递是**尽力而为**且**非阻塞**的——原始请求不会因此延迟。如果您的端点不可达，失败会记录在投递历史中，但不会自动重试。

## 用户 Webhook

任意已登录用户均可在仪表盘的 **设置 → Webhooks** 中管理个人 Webhook。

| 字段 | 说明                                                    |
|------|---------------------------------------------------------|
| 名称 | 该 Webhook 的可读标签                                   |
| 端点 | 接收 POST 请求的 HTTPS URL                              |
| 密钥 | 用于对载荷签名。留空则由 Prism 自动生成 32 字节随机密钥。 |
| 事件 | 订阅一个或多个事件类型，或使用 `*` 接收所有事件          |

密钥仅在创建时显示一次，请妥善保存。

### 用户事件

| 事件              | 触发时机                      |
|-------------------|-------------------------------|
| `*`               | 通配符——匹配以下所有用户事件  |
| `app.created`     | 您创建了一个 OAuth 应用       |
| `app.updated`     | 您更新了一个 OAuth 应用       |
| `app.deleted`     | 您删除了一个 OAuth 应用       |
| `domain.added`    | 您添加了一个域名以进行验证    |
| `domain.verified` | 您拥有的域名通过了验证        |
| `domain.deleted`  | 您删除了一个域名              |
| `profile.updated` | 您更新了个人资料（名称、头像等） |

### 用户 Webhook API

用户 Webhook 也可通过 OAuth Bearer Token 或个人访问令牌（PAT）以编程方式管理：

| 权限范围         | 授予能力                                    |
|------------------|---------------------------------------------|
| `webhooks:read`  | 列出 Webhook 并查看投递历史                 |
| `webhooks:write` | 创建、更新、删除并向您的 Webhook 发送测试请求 |

#### 接口列表

```
GET    /api/oauth/me/webhooks
POST   /api/oauth/me/webhooks
PATCH  /api/oauth/me/webhooks/:id
DELETE /api/oauth/me/webhooks/:id
POST   /api/oauth/me/webhooks/:id/test
GET    /api/oauth/me/webhooks/:id/deliveries
```

#### 示例：创建用户 Webhook

```bash
curl -X POST https://your-prism.example/api/oauth/me/webhooks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "应用监控",
    "url": "https://example.com/hooks/prism",
    "events": ["app.created", "app.deleted"]
  }'
```

响应：

```json
{
  "webhook": {
    "id": "abc123",
    "name": "应用监控",
    "url": "https://example.com/hooks/prism",
    "secret": "prism-generated-secret",
    "events": ["app.created", "app.deleted"],
    "is_active": 1,
    "created_at": 1741564800
  }
}
```

`secret` 仅在创建时返回，请妥善保存。

## 管理员 Webhook

管理员可在管理面板的 **Admin → Webhooks** 中管理站点级 Webhook。这些 Webhook 在审计日志事件发生时触发，普通用户不可见。

### 管理员事件

| 事件                  | 触发时机                           |
|-----------------------|------------------------------------|
| `*`                   | 通配符——匹配以下所有管理员事件     |
| `admin.config.update` | 站点配置被更改                     |
| `admin.user.update`   | 管理员更新了用户账号               |
| `admin.user.delete`   | 管理员删除了用户账号               |
| `admin.app.update`    | 管理员更新了 OAuth 应用（验证/停用） |
| `admin.team.delete`   | 管理员删除了团队                   |
| `invite.create`       | 站点邀请已创建                     |
| `invite.revoke`       | 站点邀请已撤销                     |
| `oauth_source.create` | OAuth 提供商来源已添加             |
| `oauth_source.update` | OAuth 提供商来源已更新             |
| `oauth_source.delete` | OAuth 提供商来源已删除             |
| `webhook.create`      | Webhook 已创建                     |
| `webhook.update`      | Webhook 已更新                     |
| `webhook.delete`      | Webhook 已删除                     |

### 管理员 Webhook API

| 权限范围                | 授予能力                          |
|-------------------------|-----------------------------------|
| `admin:webhooks:read`   | 列出 Webhook 并查看投递历史       |
| `admin:webhooks:write`  | 创建、更新并发送测试请求至 Webhook |
| `admin:webhooks:delete` | 永久删除 Webhook                  |

#### 接口列表

```
GET    /api/oauth/me/admin/webhooks
POST   /api/oauth/me/admin/webhooks
GET    /api/oauth/me/admin/webhooks/:id
PATCH  /api/oauth/me/admin/webhooks/:id
DELETE /api/oauth/me/admin/webhooks/:id
POST   /api/oauth/me/admin/webhooks/:id/test
GET    /api/oauth/me/admin/webhooks/:id/deliveries
```

所有接口均需 Bearer Token 且令牌持有者的 `role = admin`。

#### 示例：创建管理员 Webhook

```bash
curl -X POST https://your-prism.example/api/oauth/me/admin/webhooks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "我的 Webhook",
    "url": "https://example.com/hooks/prism",
    "events": ["admin.user.delete", "admin.user.update"]
  }'
```

## 载荷格式

用户 Webhook 和管理员 Webhook 均使用相同的 JSON 结构：

```json
{
  "event": "app.created",
  "timestamp": 1741564800,
  "data": {
    "app_id": "xyz789"
  }
}
```

| 字段        | 类型   | 说明                            |
|-------------|--------|---------------------------------|
| `event`     | string | 触发本次投递的事件类型          |
| `timestamp` | number | 事件发生时的 Unix 时间戳（秒）    |
| `data`      | object | 事件上下文——ID、名称及其他元数据 |

## 验证签名

每个请求都包含 `X-Prism-Signature` 请求头，内容为使用 Webhook 密钥对原始请求体进行 HMAC-SHA256 签名后的十六进制摘要。

```
X-Prism-Signature: sha256=<十六进制摘要>
X-Prism-Event: app.created
X-Prism-Delivery: <uuid>
```

Node.js 验证示例：

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verifySignature(secret, rawBody, signatureHeader) {
  const expected = "sha256=" + createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}
```

请始终使用**时序安全比较**（`timingSafeEqual`）以防止时序攻击。您的端点应返回 `2xx` 状态码表示已收到；其他状态码将被记录为失败。

## 发送测试请求

在 Webhook 列表中，点击任意 Webhook 行右侧的刷新图标，即可立即发送 `webhook.test` 事件。结果（HTTP 状态码和响应体）将内联显示，并记录在投递历史中。

## 投递历史

展开任意 Webhook 行可查看其最近 50 条投递记录，每条记录显示：

- 投递是否成功（绿色）或失败（红色）
- HTTP 响应状态码
- 事件类型
- 投递时间

## 安全建议

- **始终验证签名**，再处理投递内容。
- 仅使用 **HTTPS** 端点——Prism 接受 HTTP，但载荷在传输中会暴露。
- 快速响应（10 秒内）。Prism 超时后记录失败并不重试。
- 定期通过 `PATCH` 传入新 `secret` 值来轮换密钥。
- 将密钥视同密码——不要记录日志，不要提交到代码仓库。
