---
title: 通知
description: 用户账号事件触发的邮件、Telegram 和 Discord 通知。按事件配置的偏好、命名规则集和规则引擎。
---

# 通知

Prism 通过邮件、Telegram 和 Discord 向用户通知与安全相关的事件——应用变更、域名变更、安全因素变更、OAuth 授权授予与撤销、团队成员关系等。每个用户选择触发哪些事件以及发送到哪里。事件完整记录及发往其他目标的 Webhook，请参阅[审计日志](audit-logs.md)。

有两种配置投递的方式：

- **偏好** — 为每个事件选择 `brief` 或 `full`。简单快捷。
- **规则集** — 带条件的按顺序规则。用于将某个事件对某个地址静音、按国家/地区或一天中的时间路由事件，或将不同等级发送到不同通道。

规则集启用期间会取代偏好。

## 事件

| 事件                                    | 触发时机                     |
| --------------------------------------- | ---------------------------- |
| `app.created` / `updated` / `deleted`   | 你的 OAuth 应用发生变更      |
| `domain.added` / `verified` / `deleted` | 你的域名发生变更             |
| `connection.added` / `removed`          | 添加或移除了社交连接         |
| `connection.login`                      | 通过已关联的社交账号完成登录 |
| `profile.updated`                       | 显示名称、头像等发生变更     |
| `security.passkey_added` / `_removed`   | 添加或移除了 Passkey         |
| `security.totp_enabled` / `_disabled`   | 添加或移除了 TOTP 认证器     |
| `token.created` / `revoked`             | 创建或撤销了个人访问令牌     |
| `team.member_added` / `_removed`        | 你被加入或移出团队           |
| `oauth.consent_granted` / `_revoked`    | 你授予或撤销了应用访问权限   |

## 等级

- **`brief`** — 事件、发生时间以及涉及对象（应用名、域名等）。
- **`full`** — 增加链接，以及 IP、User-Agent 和相关详情（对于 `connection.login`，包括来源、提供方用户名以及是否为新设备）。

`full` 会有意包含安全事件上的 IP 地址和 User-Agent，以便你发现无法识别的登录。如果你不希望收件箱或聊天中出现这些信息，请选择 `brief`。Telegram 消息会经过 Telegram 的服务器，因此对于任何你不愿放在 Telegram 聊天中的内容，请使用 `brief`。

## 通道

| 通道     | 发送到                                                   |
| -------- | -------------------------------------------------------- |
| 邮件     | 用户的已验证主邮箱以及所有已验证的次要邮箱               |
| Telegram | 用户关联的 Telegram 账号，通过站点的 Telegram bot 发送   |
| Discord  | 用户关联的 Discord 账号，由站点的 Discord bot 以私信发送 |

邮件需要配置邮件提供商。在管理员选择 Telegram 来源之前，Telegram 对所有用户都关闭；Discord 也是如此，直到管理员选择来源并设置 bot token（两者都在 **管理 → 设置 → 邮件与通知 → 聊天通知** 下）。

## 规则集

规则集是按顺序排列的规则列表。事件触发时，Prism 从上到下遍历规则，应用所有匹配的规则，并发送到最终得到的目标列表。同一时间只能有一个规则集处于启用状态。

每个规则集和每条规则在 **通知 → 规则集** 下都有自己的页面。规则可以通过可视化方式构建，也可以写成表达式，并可用虚构事件进行测试。规则集的 **追踪** 会用虚构事件运行每条规则，并显示哪些规则匹配以及通知将发往何处。

### 规则

| 字段               | 含义                                                                          |
| ------------------ | ----------------------------------------------------------------------------- |
| `name`             | 标签（最多 64 个字符，可选）                                                  |
| `enabled`          | `false` 时跳过该规则                                                          |
| `match.expression` | 规则适用时机。为空时匹配所有事件                                              |
| `match.accounts`   | 可选。将规则的*效果*限制到这些目标（`email:<id>`、`tg:<id>`、`discord:<id>`） |
| `action.type`      | `send` 添加通道；`drop` 清空目前收集到的内容                                  |
| `action.channels`  | 对于 `send`：每个目标及其等级（`brief` 或 `full`）                            |
| `stop`             | `true` 时在此规则匹配后结束求值                                               |

### 表达式

语法遵循 Cloudflare 的 Rules 语言：

```
event.category eq "security" and not ip.src in {10.0.0.0/8 192.168.0.0/16}
(resource.name wildcard "prod-*" or http.user_agent contains "curl")
time.hour in {0..6 22..23} and starts_with(event, "connection.")
```

| 字段                     | 类型   | 值                                                          |
| ------------------------ | ------ | ----------------------------------------------------------- |
| `event`                  | string | 事件名，例如 `security.passkey_added`                       |
| `event.category`         | string | 点号前的部分：`app`、`domain`、`connection`、`security`、…… |
| `ip.src`                 | IP     | 触发事件者的 IP 地址                                        |
| `ip.src.country`         | string | 该地址的两位国家/地区代码；未知时为空                       |
| `http.user_agent`        | string | 其 User-Agent                                               |
| `resource.name`          | string | 事件涉及的对象：应用、域名、团队、令牌、Passkey 或提供方    |
| `oauth.scopes`           | array  | 授予的权限范围（`oauth.consent_granted`）                   |
| `profile.changed_fields` | array  | 更改的字段（`profile.updated`）                             |
| `time.hour`              | int    | 事件发生的小时，0–23，UTC                                   |
| `time.weekday`           | int    | 事件发生的星期，1（星期一）– 7（星期日），UTC               |

| 类型   | 比较方式                                                                                    |
| ------ | ------------------------------------------------------------------------------------------- |
| string | `eq` `ne` `contains` `wildcard`、`in {"a" "b"}`、`starts_with(f, "x")`、`ends_with(f, "x")` |
| IP     | `eq` `ne`、`in {203.0.113.7 10.0.0.0/8 2001:db8::/32}`                                      |
| int    | `eq` `ne` `lt` `le` `gt` `ge`、`in {1 2 9..17}`                                             |
| array  | `contains "x"`、`in {"a" "b"}`                                                              |

- 使用 `and` / `&&`、`or` / `||`、`not` / `!` 和括号组合。`not` 绑定最紧，其次是 `and`，然后是 `or`。`==`、`!=`、`<`、`<=`、`>`、`>=` 分别等同于 `eq`、`ne`、`lt`、`le`、`gt`、`ge`。
- 字符串使用双引号。除 `wildcard` 外，比较区分大小写；`wildcard` 不区分大小写且仅支持 `*`。
- 没有值的字段（没有国家/地区、没有权限范围）只满足 `ne`。
- 表达式限制为 4096 个字符，最多 200 个条件。
- 可视化构建器可处理由 OR 连接的 AND 条件组；更复杂的情况（例如 `not (a or b)`）则以文本方式编辑。

### 规则如何组合

- 多条 `send` 规则会叠加。如果同一通道以两个等级出现，较高等级（`full`）优先。
- `drop` 会清空目前收集到的全部内容。与上方的一条宽泛规则配合，就可以表达“所有内容都发到我的主邮箱，但域名事件除外”。
- `match.accounts` 限制的是规则的效果，而不是它是否匹配。带范围的 `send` 会跳过这些账号之外的通道；带范围的 `drop` 只清空列出的账号。界面中的“仅静音这些目标”会设置此项。
- `stop: true` 会阻止下方规则改变此规则的结果。
- 已停用的规则以及表达式无法解析的规则会被跳过。

### 示例

```json
[
  {
    "name": "Everything to primary email",
    "match": {},
    "action": {
      "type": "send",
      "channels": [{ "kind": "email", "email_id": "primary", "level": "full" }]
    }
  },
  {
    "name": "Sign-ins from abroad also to Telegram",
    "match": {
      "expression": "event eq \"connection.login\" and ip.src.country ne \"DE\""
    },
    "action": {
      "type": "send",
      "channels": [{ "kind": "tg", "connection_id": "tg_abc", "level": "full" }]
    }
  },
  {
    "name": "Quiet nights, except security",
    "match": {
      "expression": "time.hour in {0..6} and event.category ne \"security\""
    },
    "action": { "type": "drop" },
    "stop": true
  }
]
```

UTC 14:00 来自美国的 `connection.login` 会发往主邮箱和 Telegram。UTC 03:00 的 `app.created` 不会发往任何地方。UTC 03:00 的 `security.totp_disabled` 会发往主邮箱。

### API

规则集通过 `/api/user/me/notification-rulesets[/:id]` 上的 `GET`、`POST`、`PUT` 和 `DELETE` 管理；偏好通过 `/api/user/me/notifications` 上的 `GET` 和 `PUT` 管理。一个规则集最多可包含 200 条规则。无效的规则或表达式会返回 `400`，并带有类似 `rule_expression_unknown_field` 的错误码，以及说明出错位置的 `params`。

## Telegram 配置

Telegram 登录和 Telegram 通知使用同一个 bot。

1. 在 Telegram 中，与 `@BotFather` 对话，运行 `/newbot`，并复制 HTTP API token。
2. 运行 `/setdomain`，选择该 bot，并输入你的 Prism 域名，例如 `prism.example.com`。Telegram 会拒绝来自未注册域名的登录。
3. 在 Prism 中，进入 **管理 → OAuth 来源 → 添加来源**，选择 **Telegram**，设置一个 slug（例如 `telegram`），然后粘贴 bot token。
4. 进入 **管理 → 设置 → 邮件与通知 → 聊天通知**，在 **Telegram** 下选择该来源。
5. 每个用户在 **关联账号** 下连接 Telegram，然后在 **通知** 下开启 Telegram 通道。

用户需要先通过 Telegram widget 登录 Prism，bot 才能向其发送消息。消息为纯文本，并带有返回 Prism 的链接。

## Discord 配置

Discord 登录和 Discord 通知使用同一个 Discord 应用中的两套不同凭据：OAuth client ID 和 secret（用于关联账号）以及 bot token（用于发送私信）。bot token 不是 OAuth client secret。

1. 在 [Discord Developer Portal](https://discord.com/developers/applications) 中创建或打开该应用。在 **OAuth2 → General** 下，复制 **Client ID** 和 **Client Secret**，并添加重定向 URL `https://your-domain/api/connections/<slug>/callback`。
2. 在 Prism 中，进入 **管理 → OAuth 来源 → 添加来源**，选择 **Discord**，设置一个 slug（例如 `discord`），然后粘贴 client ID 和 secret。
3. 在 Developer Portal 中打开 **Bot**，如有需要则创建 bot，并复制其 token（如果看不到，请使用 **Reset Token**）。
4. 在 Prism 中，进入 **管理 → 设置 → 邮件与通知 → 聊天通知**，选择 Discord 来源，粘贴 bot token，然后保存。
5. 每个用户在 **关联账号** 下连接 Discord，然后在 **通知** 下开启 Discord 通道。

如果用户屏蔽了 bot 或关闭了来自共享服务器的私信，Discord 可能会拒绝发送私信。Prism 会静默跳过发送失败的私信。
