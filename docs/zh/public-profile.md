---
title: 公开资料
description: 让用户和团队选择启用公开页面，展示他们选择的字段——显示名称、头像、GPG 密钥、拥有的应用、已验证域名等。
---

# 公开资料

用户可以选择在 `/u/<username>` 启用公开资料，团队所有者也可以选择在 `/t/<team-id>` 将团队启用为公开页面。两者均可由任何未登录访客查看。每位用户或团队所有者选择要分享的分区，管理员则设置站点级默认值。

资料默认私密。在用户（或团队所有者）选择公开之前，不会显示任何内容。

## 可见性如何生效

1. **站点开关**——管理员可以为整个实例关闭此功能。关闭后，资料页面和接口始终返回 404。
2. **主动开启**——每位用户在**个人资料 → 公开资料**中开启“将我的资料设为公开”。在此之前，该资料返回 404。
3. **按字段选择**——资料公开后，用户选择要分享的字段。未改动过的字段遵循站点默认值。

不存在的用户和私密用户会返回相同的 404，因此任何人都无法借此判断哪些用户名存在。

## 用户资料字段

| 字段           | 展示内容                                 | 默认     |
| -------------- | ---------------------------------------- | -------- |
| 显示名称       | 用户的显示名称                           | 公开     |
| 头像           | 用户的头像图片                           | 公开     |
| 邮箱           | 主邮箱地址                               | **私密** |
| 加入日期       | 账号创建时间                             | 公开     |
| GPG 公钥       | 每个 GPG 公钥的指纹、Key ID 和标签       | 公开     |
| 已授权应用     | 用户已授权访问的应用（名称、图标、网站） | **私密** |
| 用户创建的应用 | 用户注册的应用（名称、图标、描述）       | 公开     |
| 已验证域名     | 用户拥有并已验证的域名                   | 公开     |

这些是开箱即用的站点默认值；管理员可以更改其中任意一项。已授权应用默认私密，因为该列表会暴露用户使用了哪些服务。

## 团队资料字段

团队所有者和管理员（而非站点管理员）控制团队的可见性。团队默认私密。

| 字段           | 展示内容                                               | 默认     |
| -------------- | ------------------------------------------------------ | -------- |
| 描述           | 团队描述                                               | 公开     |
| 头像           | 团队头像                                               | 公开     |
| 所有者         | 所有者的用户名；如果其资料也公开，则链接到该资料       | **私密** |
| 成员数         | 成员数量                                               | 公开     |
| 团队创建的应用 | 注册到团队的应用                                       | 公开     |
| 已验证域名     | 团队拥有的域名                                         | 公开     |
| 成员列表       | 每位成员（每位成员自己的“显示已加入团队”设置同样生效） | **私密** |
| 子团队         | 自身已选择公开资料的直接子团队                         | 公开     |

子团队的页面会显示“`<parent>` 的子团队”链接，但仅当父团队也公开时才显示。所有者默认私密，因为即使该用户自己的资料是私密的，展示其用户名也会使其暴露。如果所有者的资料是私密的，团队页面只显示其显示名称，不附带链接。

## 用户设置

在**个人资料 → 公开资料**中：

1. 开启**将我的资料设为公开**。
2. 使用开关选择要分享的内容。未改动过的开关会标注“（站点默认）”。
3. 点击**查看公开资料**，查看其他人实际看到的内容。

开关一经更改即会保存。

## 团队设置

团队所有者和管理员使用**团队 → \<team\> → 设置 → 公开资料**，其工作方式相同：一个**将此团队设为公开**开关、各分区开关，以及**查看公开资料**。团队成员始终可以预览该页面，即使团队处于私密状态。

## 管理员设置

在**管理 → 设置 → 公开资料**中：

- **用户可以发布资料**——总开关。选择**不允许**会为用户和团队关闭此功能。
- 每个用户字段和每个团队分区的**默认值**。它们适用于所有尚未自行选择的用户和团队，并立即生效。

更改默认值绝不会使资料变为公开。是否公开始终由用户或团队所有者自行选择。

## 公开 API

两个接口均无需认证。

### `GET /api/users/:username`

```bash
curl https://your-prism-domain/api/users/alice
```

```json
{
  "profile": {
    "username": "alice",
    "display_name": "Alice",
    "avatar_url": "/api/proxy/image?...",
    "unproxied_avatar_url": "https://example.com/alice.png",
    "email": null,
    "joined_at": 1730000000,
    "gpg_keys": [
      {
        "fingerprint": "abcd1234...",
        "key_id": "abcdef0123456789",
        "name": "laptop",
        "created_at": 1730000000
      }
    ],
    "authorized_apps": null,
    "owned_apps": [
      {
        "id": "app_...",
        "client_id": "abc123",
        "name": "My Tool",
        "description": "A small utility",
        "icon_url": null,
        "website_url": "https://mytool.example",
        "created_at": 1730000000
      }
    ],
    "domains": [{ "domain": "alice.example", "verified_at": 1730000000 }]
  }
}
```

用户隐藏的字段会以 `null` 返回。

### `GET /api/public/teams/:id`

```bash
curl https://your-prism-domain/api/public/teams/team_abc123
```

```json
{
  "team": {
    "id": "team_abc123",
    "name": "Acme",
    "description": "We make stuff.",
    "avatar_url": "/api/proxy/image?...",
    "created_at": 1730000000,
    "owner": {
      "username": "alice",
      "display_name": "Alice",
      "avatar_url": "/api/proxy/image?..."
    },
    "member_count": 12,
    "apps": [],
    "domains": [{ "domain": "acme.example", "verified_at": 1730000000 }]
  }
}
```

如果所有者自己的资料是私密的，`owner.username` 和 `owner.avatar_url` 为 `null`，仅显示 `display_name`。

### 说明

- 两个接口都接受可选的 Bearer 令牌。私密资料的所有者仍可读取该资料；对于私密团队，任何成员都可以读取。
- 每个 `404` 响应都具有相同的响应体（`{"error":"not_found"}`）。
- 图片 URL 会经过 Prism 的头像代理。原始图片 URL 也会以 `unproxied_avatar_url` 返回。
- 公开资料仅列出 GPG 密钥元数据。完整公钥位于 `/users/:username.gpg`，该端点始终公开，且不受这些设置影响。

## SDK

[`@siiway/prism`](https://www.npmjs.com/package/@siiway/prism) TypeScript SDK 封装了两个接口：

```ts
import { PrismClient } from "@siiway/prism";

const client = new PrismClient({
  baseUrl: "https://your-prism-domain",
  clientId: "your-client-id",
  redirectUri: "https://yourapp.example/callback",
});

const profile = await client.getPublicProfile("alice");
const team = await client.getPublicTeamProfile("team_abc123");
```

当资料不存在或为私密时，两者都会返回 `null`，而不会抛出异常。
