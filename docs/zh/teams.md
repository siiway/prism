---
title: 团队
description: 协作管理 OAuth 应用与已验证域名 — 角色、邀请、加入门槛与 team-as-user 存储模型。
---

# 团队

团队是 OAuth 应用与已验证域名的共同所有者。成员可以在与个人资源相同的界面里管理团队的应用和域名，但单个成员的离开不会影响这些资源的归属。

## 角色

| 角色       | 管理成员        | 改团队设置 | 管理应用/域名 | 转移所有权          | 解散 |
| ---------- | --------------- | ---------- | ------------- | ------------------- | ---- |
| `owner`    | 是              | 是         | 是            | 是（转给 co-owner） | 是   |
| `co-owner` | 是（除 owner）  | 是         | 是            | 否                  | 否   |
| `admin`    | 是（仅 member） | 否         | 是            | 否                  | 否   |
| `member`   | 否              | 否         | 团队允许的写  | 否                  | 否   |

每个团队恰好有一名 owner。转移所有权是一次性的、可审计的操作；原 owner 自动降级为 co-owner。

## 加入团队

三种方式：

1. **直接添加** — 由 admin/co-owner/owner 在 **Teams → \<team\> → Members → Add member** 中添加。
2. **邀请链接** — 在 **Members → Generate invite** 生成。可选邮箱锁定、最大使用次数、过期时间。访问 `/teams/join/:token` 会显示团队资料以及任何未满足的[加入门槛](#加入门槛)。
3. **API** — 携带会话 bearer 调用 `POST /api/teams/join/:token`。

## 加入门槛

团队所有者可要求成员加入前满足某些安全因素（成员之后试图降级时也会再次校验）。管理员还能设置 **站点底线** — 任何团队都必须满足的最低要求。

| 门槛                             | 团队字段                       | 站点底线键                            |
| -------------------------------- | ------------------------------ | ------------------------------------- |
| 至少有一个 TOTP 认证器或 Passkey | `teams.require_2fa`            | `default_team_require_2fa`            |
| 主邮箱已验证                     | `teams.require_verified_email` | `default_team_require_verified_email` |

有效要求 = 团队标记 **或** 站点底线。所有者可在底线之上加严，但不能在底线之下放松。被站点强制的因素在团队设置 UI 中会被锁灰。

::: warning 回溯生效
启用门槛会立即对每个现有成员生效。任何未满足该因素的成员将在团队操作中被拦下，直到自行补齐。`unmetRequirements` 工具函数会在加入确认页和用户侧改动路径（例如移除最后一个 TOTP 认证器）上把错误清晰地呈现给用户。请先通知成员后再切换。
:::

`/teams/join/:token` 的负载会先列出门槛，并提供链接跳到 **资料 → 安全** / **资料 → 邮箱** 以便补齐：

```json
{
  "team": { "id": "...", "name": "Acme", "avatar_url": "..." },
  "requirements": {
    "require_2fa": true,
    "require_verified_email": true,
    "forced_by_site": { "require_2fa": false, "require_verified_email": true }
  },
  "unmet": ["2fa"]
}
```

## 子团队（递归嵌套）

一个团队可以**在另一个团队下**创建，用来映射组织内部结构。子团队最多递归嵌套至运营方配置的 `max_team_depth`（默认 **5 层**）；服务器在创建和移动时都会拒绝循环以及超深嵌套。

整个特性都受站点配置控制 —— 运营方可以关闭它、收紧深度上限，或独立切换两类继承语义。详见下方 [可配置项](#可配置项)。

### 继承 —— 向下流动的内容

子团队不是独立副本。两类资源自动从上级流向所有后代，**各自可在站点配置中独立开关**：

1. **成员资格**（`inherit_team_membership`，默认开启）—— 团队 **A** 的成员在 A 的任意后代团队上都至少拥有自己在 A 上的角色。直接成员资格会与继承叠加：有效角色 = `max(直接, 继承)`。可实现“部门负责人是每个项目子团队的 admin”而不必复制成员记录。关闭后，`getEffectiveMember` 会退化为只看直接成员行，列表也不再向子树展开。
2. **已验证域名**（`inherit_team_domains`，默认开启）—— 上级团队拥有的所有域名都会作为只读条目出现在子团队的域名列表中，并打上 `inherited_from` 标记。这样当上级已经验证了顶级域，子团队的子域可以自动验证通过。关闭后，列表和自动验证均退化为只看自己拥有的域名。

其他资源仍然独立。应用属于创建它的团队；既有的 `share-to-team` 流程仍然适用于显式复制。

### 可配置项

子团队的全部行为都由站点配置驱动（管理员 → **设置 → 团队与应用限制**）。同一组数值也在未鉴权的 `/api/site` 响应中暴露，方便 SDK 客户端在 UI 上做相同的开关。

| 键                                    | 类型 | 默认值 | 作用                                                        |
| ------------------------------------- | ---- | ------ | ----------------------------------------------------------- |
| `enable_sub_teams`                    | bool | `true` | 总开关；关闭后所有子团队接口返回 403，UI 隐藏“子团队”标签。 |
| `max_team_depth`                      | int  | `5`    | 嵌套深度上限（服务端强制，管理员接口校验 1–20）。           |
| `inherit_team_membership`             | bool | `true` | 让成员角色向下级团队级联。                                  |
| `inherit_team_domains`                | bool | `true` | 让上级域名出现在子团队列表，并参与自动验证。                |
| `default_team_profile_show_sub_teams` | bool | `true` | 公开资料“子团队”分区的默认展示开关。                        |

`teams` 表上的 `profile_show_sub_teams` 列与其它 `profile_show_*` 字段使用相同约定：`null` 跟随站点默认值，`0`/`1` 表示按团队覆盖。

### 管理子团队

- **创建**：`POST /api/teams/:parentId/sub-teams`（调用者需在上级团队上是 admin+，*直接或继承*均可），或在 UI 中点击 **Teams → \<team\> → Sub-teams → New sub-team**。创建者成为新子团队的 owner。
- **列出**：`GET /api/teams/:id/sub-teams` 返回直接子团队列表，包含成员数与调用者的有效角色。上级团队的成员也能查看。
- **移动 / 改父**：`PATCH /api/teams/:id { "parent_team_id": "..." }`，传 `null` 表示提升回顶层。**仅限被移动团队的 owner**，且调用者必须在新上级团队上是 admin+。服务端会同时遍历两个子树以拒绝会造成循环或超过 `MAX_TEAM_DEPTH` 的移动。
- **删除**：`DELETE /api/teams/:id` 会级联到每一个后代。`dissolveTeam` 自下而上地为每一层把应用重新分配给该层自己的 owner —— 子团队的 owner 留住自己的应用，最终回退到执行删除的用户。数据库约束 `parent_team_id REFERENCES teams(id) ON DELETE CASCADE` 是应用层之外的一层保险。

### 列表中的继承成员资格

- `GET /api/teams`（会话）与 `GET /api/oauth/me/teams` 都会把每个直接成员资格展开成它的整个子树。条目带 `inherited_from` 字段标识上级团队 id（直接成员资格为 `null`）。
- `GET /api/teams/:id` 返回：
  - `team.ancestors` —— `[{id, name, avatar_url}]` 从直接上级到根，用于面包屑。
  - `team.sub_teams` —— 直接子团队及其成员数。
  - `team.my_role` —— **有效**角色；当来自继承时，`team.inherited_from` 给出上级 id。
  - `members` —— 直接成员的**第一页**（50 条），另有 `member_count` 表示全团队总数。翻页与筛选走 `GET /api/teams/:id/members`；详情响应自带第一页，因此首屏只需一个请求。继承成员不在此列出（可在上级团队查看，这里展开会让每个子团队列表都重复一遍）。

## 身份组

身份组是团队自建的成员标签，一个成员可以同时属于多个。它是**纯标签**：不进角色阶梯，发一个标签不会改变任何人在 Prism 内部能做什么。它唯一的用途，是随成员信息一起下发给团队接入的应用，由这些应用拿去鉴权。

默认关闭。只有团队所有者能在 **Teams → \<team\> → Settings → 身份组** 开启。

### 身份组与子团队的区别

两者都能给下游做基于分组的鉴权，所以有必要说清楚各自适用在哪：

|                              | 子团队                      | 身份组                         |
| ---------------------------- | --------------------------- | ------------------------------ |
| 是否独立实体（独立主页、id） | 是                          | 否 —— 团队内的一个标签         |
| 能否拥有应用与域名           | 能                          | 不能                           |
| 基数关系                     | 树形层级，深度受限          | 平面多对多，一人可挂多个       |
| 是否影响 Prism 内部鉴权      | **影响** —— 角色随之继承    | **不影响**                     |
| 在 claims 里的形态           | 独立的 `in_team_<子团队id>` | `groups_in_team_<团队id>` 数组 |
| 能否单独授权给应用           | 能，有自己的 `team:` scope  | 不能，随成员信息一起下发       |
| 与父团队的成员范围关系       | 可以是不重叠的另一批人      | 始终是团队现有成员的子集       |

需要**管辖与资源分家**用子团队；只是给**同一批人打属性标签**用身份组。有个坑值得点名：拿子团队当标签使，每个「标签」都会变成 claims 里的又一个团队 id，而且因为成员身份会向下继承，你本来只想打个标签的人，会连带在那个子团队里获得角色。

### 定义与分配

定义在 **Teams → \<team\> → 身份组** 中管理，每个身份组包含：

| 字段   | 说明                                                                 |
| ------ | -------------------------------------------------------------------- |
| `slug` | 下游应用用于鉴权的稳定标识。**不可修改** —— 改名会静默打断线上策略。 |
| `name` | 展示名，可随意修改。                                                 |
| 描述   | 可选，给人看的。                                                     |
| 颜色   | 可选 `#rrggbb`，用于标签配色。                                       |

限额：每团队 50 个身份组，每成员 20 个，`slug` 最长 32 字符，仅限小写字母数字与单连字符。

分配入口在成员表格 —— 成员行上的标签按钮。对话框提交的是完整的目标集合，由服务端做差集协调，且只对**实际发生变化**的身份组做权限校验。

### 谁能管理、谁能分配

所有者与共同所有者始终可以。**管理员**能做什么由所有者配置，通过一条回退链解析，每一级只贡献它显式设置过的键：

```
单组 admin_assignable  →  团队 role_permissions  →  站点默认      →  代码内置
（仅作用于分配）           （身份组 → 管理员权限）    （default_team_   （管理：关
                                                      role_permissions） 分配：开）
```

| 能力            | 覆盖范围                   | 内置默认 |
| --------------- | -------------------------- | -------- |
| `groups:manage` | 创建、编辑、删除身份组定义 | 关       |
| `groups:assign` | 给成员挂载与取消身份组     | 开       |

单组的 `admin_assignable` 覆盖项，是为了让「整体允许管理员发标签」的团队仍能把某个敏感身份组收回给所有者。

::: warning 开关本身仅所有者可改
开关功能、修改 `role_permissions`、设置单组 `admin_assignable`，这三项都限定所有者，而不是「管理员及以上」—— 这是刻意的。如果被约束的角色能编辑约束自己的配置，这个约束就等于不存在：管理员只需把所有者收走的权限给自己开回来。
:::

### 继承

身份组像角色一样沿子团队树向下流动：上级团队的成员会在每个下级团队带着上级的标签，并标记 `inherited_from`，前端据此渲染为只读。继承来的标签在其来源团队处管理。

这一行为跟随与角色继承同一个 `inherit_team_membership` 开关 —— 当上下级在成员资格上已被解耦，标签也不再跨过那条边界。

### 关闭之后

关闭是**隐藏，不是清除**。定义与分配关系都留在库里，只是所有读取出口不再下发，已接入的应用从下次刷新令牌起看不到任何身份组。重新开启后，全部分配原样恢复。

继承链上同理：上级团队关掉后，不再向下级贡献任何标签，避免已关闭团队的标签借道子团队泄出去。

::: tip 对下游的影响
因为应用是拿这些标签做鉴权的，关闭功能（或删除某个身份组）会让下游鉴权**变严**而不是变松 —— 受影响的用户只是不再出示该标签。
:::

### 出现在哪些位置

| 出口                                 | 形态                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `GET /api/teams/:id`（会话）         | `members[].groups` —— `{slug, name, color, inherited_from}`                |
| `GET /api/oauth/me/team/:id/members` | 同上，需 `team:<id>:member:read`                                           |
| `.../members/:userId/profile`        | 同上，需 `team:<id>:member:profile:read`                                   |
| ID token / userinfo                  | `groups_in_team_<id>` —— slug 数组；`teams[].groups` 需 `oidc_fields` 选入 |

**不新增 scope**：身份组随应用本就被信任读取的成员信息一起下发。已持有 `team:<id>:member:read` 的应用会在下次调用时自动看到身份组，无需重新授权 —— 之所以接受这个取舍，是因为这是团队自建的标签而非个人隐私数据。管理与分配仅限仪表盘，`team:<id>:member:write` **不**授予这些操作。

团队的 `role_permissions` 不会离开仪表盘 API —— 下游应用看得到成员持有哪些标签，但看不到团队是怎么配置发放权限的。

## 团队拥有的应用与域名

OAuth 应用可以直接在团队下创建（**Teams → \<team\> → Apps → New**），或从成员个人应用转入（**Apps → \<app\> → Settings → Transfer**）。被转入的个人应用就地改主 — `client_id` 与 `client_secret` 保持不变，外部集成不会断。

域名同理。已在个人账户验证过的域名可以共享给团队（`POST /api/teams/:id/domains/:domainId/share-to-team`），之后还能取消共享（`/share-to-personal`）或彻底转出（`/to-personal`，撤销团队的编辑权）。

## team-as-user 存储

每个团队都有一行合成的 `users` 行：`kind = 'team'`、`id` 与 `teams.id` 一致。它仅是为了让 `oauth_apps.owner_id` 在个人/团队应用上能用同一张表 join — 没有密码、没有会话、没有社交连接、不能登录。合成的邮箱与用户名（`team-<id>@teams.invalid` / `team:<id>`）使用冒号前缀，绝不会与真实注册冲突。

团队解散时，`dissolveTeam` 会先把团队拥有的应用重新分配给团队所有者（如果没有 owner 行就给执行删除的管理员），从而绕过 `oauth_apps.owner_id` 的级联删除。

## 团队公开资料

与用户一样，团队默认私密。团队所有者（或管理员）必须显式在 **Teams → \<team\> → Settings → Public profile** 启用，并选择展示的内容。站点级默认值与 `enable_public_profiles` 主开关在 [配置](configuration.md#公开资料) 中。各分区的细则见 [公开资料](public-profile.md)。

团队公开页只会在所有者本人也开了公开资料时才链接到 `/u/<username>` — 否则只展示昵称，不带链接。

## OAuth scope

涉及团队的 scope 分三类，作用范围差异巨大。完整表格（含同意规则与示例）在 [OAuth → 团队相关 scope —— 三个层级](oauth.md#团队相关-scope-三个层级)；这里给个速览：

### 聚合 `teams:*`

一次同意作用于用户的**全部团队**。端点位于 `/api/oauth/me/teams[/...]`。

| Scope          | 权限                                         |
| -------------- | -------------------------------------------- |
| `teams:read`   | 列出当前用户加入的团队与角色                 |
| `teams:create` | 创建新团队                                   |
| `teams:write`  | 修改团队设置；添加/移除用户所在团队的成员    |
| `teams:delete` | 删除团队（请求时仍校验当前用户必须是 owner） |

适合「这个用户在哪些团队」型用途 — workspace 切换器、同步成员列表、给 Cloudflare Access 策略用的 OIDC claim 等。

### 单团队 `team:*`

只作用于用户在同意时选定的**那一个团队**。Prism 在颁发前用 `bindTeamScopes()` 把 `team:read` 改写为 `team:<team-id>:read`，token 中只剩绑定后的形式。端点位于 `/api/oauth/me/team/:teamId/...`。

| 请求字符串                 | 绑定后形式                      | 权限                            |
| -------------------------- | ------------------------------- | ------------------------------- |
| `team:read`                | `team:<id>:read`                | 读取该团队的设置                |
| `team:write`               | `team:<id>:write`               | 修改该团队的设置                |
| `team:delete`              | `team:<id>:delete`              | 解散该团队                      |
| `team:member:read`         | `team:<id>:member:read`         | 列出成员与角色                  |
| `team:member:write`        | `team:<id>:member:write`        | 添加/移除成员、改角色           |
| `team:member:profile:read` | `team:<id>:member:profile:read` | 通过团队 scope 读取某成员的资料 |

同意时还有两条额外限制（`worker/routes/oauth.ts:830-859`）：

- 用户必须是所选团队的 `owner`、`co-owner` 或 `admin`。
- `team:delete` 还要求 `owner` 或 `co-owner` — admin 能授予读写，但只有真能解散团队的人才能授予删除权。

`team:member:write` 也不能越权：admin 授权后，应用提升成员的角色仍受到与该 admin 相同的上限保护，不会因 token 而获得超越授权人的能力 — 这条上限在每次成员变更时都会校验。

每次授予会在 `team_scope_grants` 表中独立审计（含团队 ID 与权限列表），与 OAuth 同意记录分开。

适合绑定到单个团队的集成 — 某 workspace 的部署机器人、某团队频道里的 chatbot 等。

### 跨实例 `site:team:*`

无需逐团队同意的跨团队管理员权限。授予时同意者必须是站点管理员，并通过 [站点 scope 确认流程](oauth.md#site-scopes-admin-only)（2FA + 输入 `grant site access`）。仅适合站点管理工具。

### `oidc_fields` claim

把用户角色嵌入 ID Token 用的 `oidc_fields` 机制同样能产出按团队的 claim — 这对依赖团队成员关系的 Cloudflare Access 策略非常有用。`teams:read` scope 会解锁扁平的 `teams` claim 以及 `in_team_<id>` / `role_in_team_<id>` 标记，启用了[身份组](#身份组)的团队还会带上 `groups_in_team_<id>`。详见 [Cloudflare Access 集成](oauth.md#cloudflare-access)。

### 怎么选

- 集成关心用户的整个团队图谱（同步成员、注入 claim）— 用 **`teams:*`**。
- 集成只针对一个团队 — 用 **`team:*`**，更窄的爆炸半径值得多一个团队选择器。
- **不要** 同时请求 `teams:*` 和 `team:*`：你会拿到并集，但同意页同时出现「全部团队提示」和「团队选择器」，对用户很迷惑。
- **`site:team:*`** 留给站点管理工具用 — 这层授予会绕过团队所有者的同意。

## 端点速览

完整列表见 [API → 团队](api.md#团队)。常用端点：

```
GET    /api/teams                            列出加入的团队
POST   /api/teams                            创建
PATCH  /api/teams/:id                        更新设置与门槛
GET    /api/teams/:id/members                列成员（分页，支持 ?q= 与 ?group=）
POST   /api/teams/:id/members                按用户名/ID 添加
PATCH  /api/teams/:id/members/:userId        改角色
DELETE /api/teams/:id/members/:userId        移除（self 即退出）
GET    /api/teams/:id/groups                 列出身份组定义与有效权限
POST   /api/teams/:id/groups                 创建身份组
PATCH  /api/teams/:id/groups/:groupId        改名/改色（slug 不可改）
DELETE /api/teams/:id/groups/:groupId        删除（连带解除所有分配）
PUT    /api/teams/:id/members/:userId/groups 覆盖某成员的身份组集合
POST   /api/teams/:id/transfer-ownership     转交给 co-owner
GET    /api/teams/join/:token                预览邀请（认证可选）
POST   /api/teams/join/:token                接受邀请
```
