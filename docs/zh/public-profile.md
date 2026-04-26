---
title: 公开资料
description: 让用户和团队启用公开页面，自由选择展示哪些字段——显示名称、头像、GPG 公钥、应用、已验证域名等。
---

# 公开资料

Prism 用户可以启用 `/u/<username>` 路径下的公开资料页面，团队所有者也可以将团队公开为 `/t/<team-id>`。两类页面均允许未登录访客查看。每位用户/团队所有者自行决定要分享的字段；管理员则设置合理的站点级默认值。

资料默认私密，只有用户（或团队所有者）明确开启后才会对外可见。

## 工作原理

可见性按照以下三层叠加生效：

1. **站点总开关**——管理员可对整个实例关闭此功能。关闭后，无论用户/团队的个人设置如何，`/u/<username>`、`/t/<team-id>`、`/api/users/<username>` 与 `/api/public/teams/<id>` 都返回 404。
2. **用户/团队级开关**——用户在**个人资料 → 公开资料**中切换"将我的资料设为公开"，团队所有者/管理员则在**团队 → 设置 → 公开资料**中切换。关闭则同样返回 404。
3. **字段/分区级开关**——开启公开后，用户/团队选择要分享的字段。未自定义的字段会沿用站点对该字段的默认值。

无论实体不存在还是用户主动隐藏，返回的 404 响应完全相同，因此无法通过该接口探测某个用户名/团队 ID 是否存在。

## 用户资料的可分享字段

| 字段 | 含义 | 默认 |
| - | - | - |
| 显示名称 | 用户显示名 | 公开 |
| 头像 | 用户头像 | 公开 |
| 邮箱 | 用户主邮箱 | **私密** |
| 加入日期 | 账号创建时间 | 公开 |
| GPG 公钥 | 每个已注册 GPG 公钥的指纹、Key ID 和标签 | 公开 |
| 已授权应用 | 用户已通过 OAuth 授权的应用（名称、图标、网址） | **私密** |
| 用户创建的应用 | 用户注册的 OAuth 应用（名称、图标、描述） | 公开 |
| 已验证域名 | 用户拥有并已验证的域名 | 公开 |

::: tip 为何已授权应用默认私密
用户连接的服务列表较为敏感（会暴露其使用习惯）。即使整个资料是公开的，该字段仍默认隐藏。
:::

## 团队资料的可分享分区

团队拥有独立的可见性开关，由**团队的所有者和管理员**（而非站点管理员）控制。规则与用户资料相同：默认私密，按分区开启。

| 分区 | 含义 | 默认 |
| - | - | - |
| 描述 | 团队描述 | 公开 |
| 头像 | 团队头像 | 公开 |
| 所有者 | 团队所有者的用户名（若所有者本人也公开了资料，则附带链接） | **私密** |
| 成员数 | 团队成员的数量（仅数字，不显示成员列表） | 公开 |
| 团队应用 | 注册到团队的 OAuth 应用 | 公开 |
| 已验证域名 | 团队拥有的域名 | 公开 |

::: tip 为何所有者默认私密
团队所有者是某个具体的用户，将其用户名展示在公开页面会"被动公开"该用户——即便其本人的用户资料是私密的。因此团队所有者必须明确选择是否暴露自己。
:::

只有当所有者**自己的**用户资料也是公开时，团队页面才会附带 `/u/<username>` 链接；否则只显示其显示名称，不附带任何链接。

## 用户设置

用户在**个人资料 → 公开资料**中管理可见性：

1. 切换**将我的资料设为公开**。在此关闭时，没有人能查看该资料。
2. 通过字段开关选择要分享的字段。未触碰过的开关会显示"（站点默认）"标记，便于识别该值是继承得到的。
3. 点击**查看公开资料**会在新标签页打开 `/u/<username>`，预览访客实际看到的内容。

各字段开关在切换时即时保存，无需额外的"保存"步骤。

## 团队设置

团队所有者和管理员在**团队 → \<team\> → 设置 → 公开资料**中管理可见性，流程与用户设置一致：

1. **将此团队设为公开**——总开关。关闭后访客访问团队页面会得到 404。
2. 各分区开关，未自定义时显示"（站点默认）"。
3. **查看公开资料**会在新标签页打开 `/t/<team-id>`。

团队成员即使在团队私密时也能查看团队的公开页面——便于预览。

## 管理员设置

管理员在**管理 → 设置 → 公开资料**（在"通用"标签页下）配置该功能。

- **启用公开资料**——总开关。关闭后整个站点的公开资料功能（用户**与**团队）都不可用。
- **每个字段的默认可见性**（用户资料）——适用于所有未对该字段设置个人偏好的用户。
- **每个分区的默认可见性**（团队资料）——适用于所有未自定义的团队，由团队所有者/管理员（而非站点管理员）调整团队侧。

修改默认值会立即对所有继承该值的用户/团队生效。

修改默认值不会改变任何用户或团队的 `profile_is_public` 标志——这始终是用户（或团队所有者）的明确选择。管理员无法强制把任何资料变为公开。

## 公开 API

公开资料数据通过两个无需鉴权的 JSON 接口提供。

### `GET /api/users/:username`

返回根据可见性过滤后的用户资料；若用户名不存在、用户未公开或站点已禁用此功能，则返回 `404`。

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
    "domains": [
      { "domain": "alice.example", "verified_at": 1730000000 }
    ]
  }
}
```

被用户隐藏的字段会返回 `null`（对集合类字段如 `gpg_keys`、`domains`，则整个数组返回 `null`）。

### `GET /api/public/teams/:id`

返回团队资料；规则同上。

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
    "unproxied_avatar_url": "https://example.com/acme.png",
    "created_at": 1730000000,
    "owner": {
      "username": "alice",
      "display_name": "Alice",
      "avatar_url": "/api/proxy/image?..."
    },
    "member_count": 12,
    "apps": [
      {
        "id": "app_...",
        "client_id": "...",
        "name": "Acme Cloud",
        "description": "",
        "icon_url": null,
        "website_url": "https://acme.example",
        "created_at": 1730000000
      }
    ],
    "domains": [
      { "domain": "acme.example", "verified_at": 1730000000 }
    ]
  }
}
```

如果团队所有者选择了暴露自己，但其**自己的**用户资料是私密的，那么 `owner.username` 与 `owner.avatar_url` 都会是 `null`，仅 `display_name` 可见，且不会附带跳转链接。

### 其他行为

- 两个接口都接受可选的 Bearer 令牌。对用户资料，所有者本人的令牌可以查看私密资料；对团队资料，**任何团队成员**（不限所有者）的令牌都能查看私密团队页面——用于预览。
- 所有 `404` 响应共享同一个响应体（`{"error":"Not found"}`），因此调用方无法区分"不存在"与"未公开"。
- 图片地址会经过 Prism 的图片代理（`/api/proxy/image?...`）；如果你想直接使用原始 URL，可以读取 `unproxied_avatar_url` 字段。

### GPG 公钥

公开资料中只包含每个已注册 GPG 公钥的元数据（指纹、Key ID、标签）。完整的 ASCII armored 公钥仍保留在原有的 `/users/:username.gpg` 端点中——该端点不受这些可见性开关影响，长期以来一直对外公开，便于联邦化查询。

## SDK 用法

[`@siiway/prism`](https://www.npmjs.com/package/@siiway/prism) TypeScript SDK 同时支持两个接口：

```ts
import { PrismClient } from "@siiway/prism";

const client = new PrismClient({
  baseUrl: "https://your-prism-domain",
  clientId: "your-client-id",
  redirectUri: "https://yourapp.example/callback",
});

const profile = await client.getPublicProfile("alice");
const team = await client.getPublicTeamProfile("team_abc123");

console.log(profile?.display_name, team?.member_count);
```

两个方法在资料缺失或未公开时都返回 `null`（而非抛出异常），因此一次空值判断即可覆盖"无公开数据"的所有情况。无需令牌。

## 数据库结构

### `users`

| 字段 | 类型 | 含义 |
| - | - | - |
| `profile_is_public` | `INTEGER NOT NULL DEFAULT 0` | `1` 表示用户已选择公开。无 NULL 状态——管理员永远无法隐式翻转此字段。 |
| `profile_show_display_name` | `INTEGER`（可空） | `NULL` 表示沿用站点默认；`0`/`1` 表示用户的明确选择。 |
| `profile_show_avatar` | `INTEGER`（可空） | 同上。 |
| `profile_show_email` | `INTEGER`（可空） | 同上。 |
| `profile_show_joined_at` | `INTEGER`（可空） | 同上。 |
| `profile_show_gpg_keys` | `INTEGER`（可空） | 同上。 |
| `profile_show_authorized_apps` | `INTEGER`（可空） | 同上。 |
| `profile_show_owned_apps` | `INTEGER`（可空） | 同上。 |
| `profile_show_domains` | `INTEGER`（可空） | 同上。 |

### `teams`

| 字段 | 类型 | 含义 |
| - | - | - |
| `profile_is_public` | `INTEGER NOT NULL DEFAULT 0` | 由团队所有者/管理员设置；同样无 NULL 状态。 |
| `profile_show_description` | `INTEGER`（可空） | `NULL` 表示沿用站点默认；`0`/`1` 表示团队的明确选择。 |
| `profile_show_avatar` | `INTEGER`（可空） | 同上。 |
| `profile_show_owner` | `INTEGER`（可空） | 同上。 |
| `profile_show_member_count` | `INTEGER`（可空） | 同上。 |
| `profile_show_apps` | `INTEGER`（可空） | 同上。 |
| `profile_show_domains` | `INTEGER`（可空） | 同上。 |

### `site_config`

| Key | 含义 |
| - | - |
| `enable_public_profiles` | 同时控制用户与团队公开资料的总开关。 |
| `default_profile_show_*` | 用户资料各字段的默认值。 |
| `default_team_profile_show_*` | 团队资料各分区的默认值。 |
