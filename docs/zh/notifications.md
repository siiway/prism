---
title: 通知
description: 用户账号事件触发的邮件 / Telegram / Discord 通知 — 偏好设置、命名规则集与规则引擎。
---

# 通知

Prism 在与安全相关的事件上向用户推送通知 — 应用变更、域名生命周期、安全因素变化、OAuth 同意授权/撤销、团队成员关系等等 — 通道是用户自己的邮箱、Telegram 与 Discord。每个用户自行决定哪些事件触发、推送到哪里。这些事件的完整记录（以及推送到任意目标的作用域化 webhook）详见 [审核日志](audit-logs.md)。

支持两种配置方式：

- **偏好（preferences）** — 扁平的 `事件 → brief|full` 映射。简单，配起来快。
- **规则集（rulesets）** — 命名的、按顺序的 match/action 数组，支持账号过滤与 `stop`。当你需要把同一事件中的某一封邮件静音、或把 brief / full 在不同通道间分开时表达力更强。

引擎会先评估规则集；偏好映射作为兼容路径，仅在没有规则集时使用。

## 事件

| 事件                                    | 触发条件                             |
| --------------------------------------- | ------------------------------------ |
| `app.created` / `updated` / `deleted`   | 你的 OAuth 应用被改动                |
| `domain.added` / `verified` / `deleted` | 你的域名被改动                       |
| `connection.added` / `removed`          | 社交账号被绑定 / 解绑                |
| `connection.login`                      | 通过已绑定的社交账号完成了一次登录   |
| `profile.updated`                       | 显示名 / 头像等被改动                |
| `security.passkey_added` / `_removed`   | Passkey 添加 / 移除                  |
| `security.totp_enabled` / `_disabled`   | TOTP 认证器启用 / 移除               |
| `token.created` / `revoked`             | PAT 被创建 / 撤销                    |
| `team.member_added` / `_removed`        | 你被加入 / 移出团队                  |
| `oauth.consent_granted` / `_revoked`    | 你授予 / 撤销了对某应用的 OAuth 授权 |

事件清单与 `worker/lib/notifications.ts → USER_NOTIFICATION_EVENTS` 一致。Webhook 使用同一组名称 — 这就是「能被通知什么」的唯一权威列表。

## 等级

每条投递有一个等级：

- **`brief`** — 最少：事件名 + 时间 + 资源标签（应用名、域名等）。
- **`full`** — 在此之上还会包含永久链接、IP、User-Agent 以及关联元数据（如 `connection.login` 会加上来源 slug、provider 用户名、是否新设备等）。

## 通道

| 通道     | 配置方式                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 邮件     | 用户的已验证主邮箱 + `user_emails` 中任意已验证次要邮箱。HTML 正文构造时已 XSS-safe（所有插值都先经过 HTML 转义）               |
| Telegram | 已绑定的 Telegram 社交连接。Prism 使用 `tg_notify_source_slug` 指定的已启用 Telegram OAuth 源中的 bot token 发送                |
| Discord  | 已绑定的 Discord 社交连接。Prism 使用 `discord_notify_source_slug` 指定的 OAuth 源识别用户 ID，并用 `discord_bot_token` 发送 DM |

`tg_notify_source_slug` 为空时，即使用户在规则中配置了 Telegram 通道，整个站点的 Telegram 投递仍然停用。`discord_notify_source_slug` 或 `discord_bot_token` 任一为空时，Discord 投递停用。邮件投递则需要管理员配置好邮件 provider。

## 偏好（扁平）

最简形式。存储于 `user_notification_prefs.events`（Telegram 走 `tg_events` 镜像），结构为 `Record<string, "brief"|"full">`。未列出的事件视为「关闭」。

`GET /api/user/me/notifications`：

```json
{
  "email_events": {
    "app.created": "full",
    "security.totp_enabled": "brief"
  },
  "tg_events": {
    "connection.login": "full"
  }
}
```

`PUT /api/user/me/notifications` 接受相同结构并原子替换。

历史的 `string[]` 形态（所有事件都按 `"full"` 处理）仍由 `parsePrefsEvents` 兼容解析。

## 规则集

规则集是一组按顺序的规则。事件触发时，引擎从上向下遍历，把每条匹配规则的副作用累加，最后产出去重后的投递列表。

### 规则结构

```json
{
  "id": "rule_xyz",
  "name": "burner 邮箱屏蔽域名噪音",
  "enabled": true,
  "match": {
    "event": "domain.*",
    "accounts": ["email:burner-id"]
  },
  "action": {
    "type": "drop"
  },
  "stop": false
}
```

| 字段                         | 含义                                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                         | 服务端生成的稳定 ID                                                                                                                    |
| `name`                       | 人类可读标签（≤ 64 字符，可选）                                                                                                        |
| `enabled`                    | `false` 时跳过此规则，不影响状态                                                                                                       |
| `match.event`                | 通配符：`*` 匹配任意，`?` 匹配单字符，其余字面匹配。锚定匹配 — `app` 只匹配 `app`，不匹配 `appx`                                       |
| `match.accounts`             | 可选。每项形如 `email:<email_id>`、`tg:<connection_id>` 或 `discord:<connection_id>`。限定该规则副作用只作用于这些账号                 |
| `action.type`                | `send`（追加通道）或 `drop`（清空已积累的投递集合）                                                                                    |
| `action.channels`（仅 send） | 数组，元素 `{ kind: "email", email_id, level }`、`{ kind: "tg", connection_id, level }` 或 `{ kind: "discord", connection_id, level }` |
| `stop`                       | `true` 在该规则触发后停止后续遍历                                                                                                      |

### 评估语义

- 多条 `send` 累加。同一通道再次出现且等级更高，则升级（`full > brief`）。
- `drop` 清空目前积累的投递。配合上方更宽松的规则，可表达「除了 X 之外都发到主邮箱」。
- `match.accounts` 过滤的是规则的*副作用*，而非匹配条件。带账号过滤的 `send` 会静默跳过不在列表中的通道；带账号过滤的 `drop` 只清空列出的账号，其它通道继续保留。
- `stop: true` 停止遍历。常用作锚点，避免下方更通用的规则把当前规则的效果撤销。

### 完整示例

```json
[
  {
    "id": "1",
    "name": "全事件 → 主邮箱",
    "match": { "event": "*" },
    "action": {
      "type": "send",
      "channels": [{ "kind": "email", "email_id": "primary", "level": "full" }]
    }
  },
  {
    "id": "2",
    "name": "应用事件再发到 Telegram（brief）",
    "match": { "event": "app.*" },
    "action": {
      "type": "send",
      "channels": [
        { "kind": "tg", "connection_id": "tg_abc", "level": "brief" }
      ]
    }
  },
  {
    "id": "3",
    "name": "屏蔽域名噪音",
    "match": { "event": "domain.*" },
    "action": { "type": "drop" }
  }
]
```

`security.totp_enabled` → 主邮箱（full）。`app.created` → 主邮箱（full）+ Telegram（brief）。`domain.verified` → 无投递（规则 3 把规则 1 加进来的清空了）。

### 端点

```
GET    /api/user/me/notification-rulesets
POST   /api/user/me/notification-rulesets
PUT    /api/user/me/notification-rulesets/:id
DELETE /api/user/me/notification-rulesets/:id
```

`POST` 调用 `sanitizeRulesArray` 进行校验：

- 最多 200 条。
- 未知的 action 类型或错误结构的 channel 一律 `400`。
- 未知事件名也 `400`（接受 `USER_NOTIFICATION_EVENTS` 中的所有事件以及 `*` / `?` 通配符）。

## Telegram 配置

Telegram 登录与 Telegram 通知投递使用同一个 bot token。该 token 存在 Telegram OAuth 源的 `client_secret` 中。

1. 打开 Telegram，与 `@BotFather` 对话。
2. 执行 `/newbot`，设置显示名称和用户名，然后复制 HTTP API token。
3. 执行 `/setdomain`，选择该 bot，填写 Prism 的公开域名，例如 `prism.example.com`。Telegram Login 会拒绝来自未注册域名的回调。
4. 在 Prism 中进入 **Admin → OAuth Sources → Add Source**。
5. 选择 **Telegram**，设置 slug（如 `telegram`），把 bot token 粘贴到 secret/token 字段，并保持启用。
6. 进入 **Admin → Settings → 邮件与通知 → 聊天通知**。
7. 在 **Telegram** 中选择该 Telegram OAuth 源并保存。这会设置 `tg_notify_source_slug`。
8. 想接收 Telegram 通知的用户进入 **关联账号**，通过同一个 bot / 域名绑定 Telegram，然后在 **通知** 页面启用 Telegram 通道。

投递细节：

- Prism 使用 `https://api.telegram.org/bot<TOKEN>/sendMessage` 发送。
- 已绑定 Telegram connection 的 `provider_user_id` 会作为 `chat_id`。
- 用户通常需要先通过 Telegram Login widget 授权 Prism，Prism 才能向该用户发送消息。

Telegram 消息是纯文本，附带回到对应 Prism 页面的链接。

## Discord 配置

Discord OAuth 登录和 Discord 机器人投递是两套不同凭据。OAuth 源保存用于绑定账号的 OAuth client ID / client secret；通知发送必须使用同一个 Discord Application 下的 bot token，并在 Prism 中单独保存为 `discord_bot_token`。

1. 打开 [Discord Developer Portal](https://discord.com/developers/applications)，创建或选择用于 Prism Discord 登录的 Application。
2. 在 **OAuth2 → General** 中复制 **Client ID** 与 **Client Secret**。添加回调 URL：`https://your-domain/api/connections/<slug>/callback`。
3. 在 Prism 中进入 **Admin → OAuth Sources → Add Source**，选择 **Discord**，设置 slug（如 `discord`），填写 OAuth Client ID / Secret，并保持启用。
4. 回到 Discord Developer Portal，打开同一个 Application 的 **Bot** 页面。
5. 如果还没有 bot，先创建 bot；如需新 token，点击 **Reset Token**，然后复制 bot token。这个 token 不是 OAuth client secret。
6. 在 Prism 中进入 **Admin → Settings → 邮件与通知 → 聊天通知**，在 **Discord** 中选择 Discord OAuth 源，把 bot token 粘贴到 **Discord bot token**，然后保存。这会设置 `discord_notify_source_slug` 与 `discord_bot_token`。
7. 想接收 Discord 通知的用户进入 **关联账号** 绑定 Discord，然后在 **通知** 页面启用 Discord 通道。

投递细节：

- Prism 先使用 `Authorization: Bot <token>` 和用户绑定的 Discord ID 调用 `POST /users/@me/channels` 创建或复用 DM channel。
- Prism 再把通知消息发送到返回的 DM channel。
- 如果用户屏蔽 bot、关闭共同服务器私信，或 Discord 平台策略 / 速率限制阻止创建 DM，Discord 会拒绝投递。通知发送在异步流程中执行，Prism 会跳过失败的 DM 尝试。

## 邮件渲染

邮件正文为 HTML：精简的内联 header 加一张关键字段表格。所有动态值都先经 `esc()` 转义（`& < > " '`），所有链接都通过 `safeHref()` 过滤（只放行 `http:` / `https:`）。纯文本备份从相同数据自动生成。

## 隐私提示

- `full` 等级会在安全相关事件（`security.*`、`connection.login`、`token.*`）上携带 IP 与 UA，便于发现陌生登录。如果你不希望这些信息落到邮箱里，请改用 `brief`。
- Telegram 消息会途经 Telegram 服务器。任何你不希望出现在 Telegram 聊天里的信息，就别用 Telegram 通道的 `full` 等级 — 改用 `brief`。
