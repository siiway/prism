---
title: 管理员指南
description: 在 Prism 管理面板中管理用户、应用、OAuth 来源、设置和审计日志。
---

# 管理员指南

管理面板位于 `/admin`，仅对 `role = admin` 的用户可见。第一个管理员账号在首次初始化时创建。后续管理员可通过 **Admin → Users → Edit User → Role → Admin** 提升权限。

## 仪表盘

显示四个汇总统计数据：

| 统计项       | 说明                    |
| ------------ | ----------------------- |
| 总用户数     | 所有已注册账号          |
| OAuth 应用数 | 所有已注册应用          |
| 已验证域名数 | 通过验证的域名          |
| 活跃令牌数   | 未过期的 OAuth 访问令牌 |

统计下方还会显示运维警告 — 最重要的是：当 [`SECRETS_KEY`](configuration.md#secrets_key-配置) 已绑定但 D1 数据尚未迁移时会提示。点进 **设置 → Danger Zone** 即可一次性完成加密。

## 设置

设置按标签页分组。所有更改立即生效——无需重新部署。

### 通用

- **Site name** — 显示在浏览器标签和邮件模板中
- **Site description** — 显示在登录页面
- **Site icon URL** — PNG/SVG Logo 的链接
- **注册模式** — `开放`（任何人可注册）、`仅限邀请`（需要邀请令牌）或`关闭`（禁止新注册）
- **Require email verification** — 用户必须点击验证链接后才能登录

### 外观

- **Accent color** — 驱动整个 FluentUI 主题的十六进制颜色，保存后立即生效。
- **Custom CSS** — 注入到每个页面的 `<style>` 块，适合在不修改源码的情况下进行品牌定制。

### 安全 / 会话

- **Session TTL（天）** — 登录会话的有效期
- **Access token TTL（分钟）** — OAuth 访问令牌有效期
- **Refresh token TTL（天）** — OAuth 刷新令牌有效期
- **Sudo 模式 TTL（分钟）** — 用户成功完成一次 2FA 步骤提升后，同一 `(用户, 会话, 应用)` 在该时长内的后续挑战可跳过 TOTP/Passkey 重新提示。`0` 表示完全禁用 sudo 模式。每次确认时仍要求用户勾选行动确认复选框。详见 [OAuth → 步骤提升 2FA](oauth.md#step-up-2fa)。
- **Require captcha for 2FA** — 站点全局：每次步骤提升确认都必须通过当前启用的验证码。应用也可针对单个挑战开启。`captcha_provider = none` 时无效。
- **IPv6 限流前缀长度** — 限流时 IPv6 地址按多少位前缀聚合（默认 `/64`）。避免一个 `/64` 拥有无限重试次数。

### 机器人防护

选择一个验证码提供商：

| 提供商               | 说明                                               |
| -------------------- | -------------------------------------------------- |
| 无                   | 不启用机器人防护                                   |
| Cloudflare Turnstile | 需要 Turnstile 站点密钥 + 密钥，提供免费套餐       |
| hCaptcha             | 需要 hCaptcha 站点密钥 + 密钥                      |
| reCAPTCHA v3         | 需要 Google reCAPTCHA v3 站点密钥 + 密钥，无感验证 |
| 工作量证明           | 无需第三方服务，难度 20 在现代硬件上约需 0.1–2 秒  |

选择 **Cloudflare Turnstile** 后，会出现**验证端点**设置，用于选择分发组件脚本的主机：全球 `challenges.cloudflare.com` 或中国大陆加速镜像 `challenges.cloudflare-cn.com`。服务端校验始终使用全球主机，因此该设置只影响组件在访客浏览器中的加载方式。可选：始终全球、始终中国大陆，或按浏览器语言（客户端）、按请求地区（服务端）、按浏览器地区（客户端）自动选择。参见 [`turnstile_endpoint_mode`](configuration.md#机器人防护验证码)。

### 邮件

邮件设置分为两个子标签页：**发送**和**接收**。

#### 发送

- **Email provider** — `none`、`resend`、`mailchannels` 或 `smtp`
- **API key** — Resend 或 Mailchannels 的 API 密钥
- **SMTP 设置** — 主机、端口、加密方式、用户名、密码（选择 `smtp` 时显示）
- **From address** — 验证邮件和通知邮件的发件地址
- **发送测试邮件** — 向管理员邮箱发送测试邮件，验证发件功能是否正常

#### 接收

- **邮箱验证方式** — 控制用户验证邮箱的方式：
  - `link` — 系统向用户邮箱发送验证链接
  - `send` — 用户发送邮件以验证邮箱（具体方式取决于接收方式）
  - `both` — 用户可以选择任一方式
- **接收方式** — Prism 如何接收入站验证邮件：
  - `Cloudflare Email Workers` — 事件驱动，邮件触发 Worker 的 `email()` 处理程序。需要配置 Cloudflare Email Routing。用户向 `verify-<code>@<host>` 发送邮件。
  - `IMAP` — Prism 按计划任务周期（默认每 6 小时）轮询 IMAP 邮箱。适用于任何邮件提供商。用户**以验证码为邮件主题**，发送到配置的 IMAP 邮箱地址（例如 `receive@prism.example.com`）。
  - `无` — 禁用邮件接收（仅支持链接验证方式）
- **接收域名** — 用于接收 `verify-<code>@<host>` 验证邮件的域名（仅 Cloudflare Email Workers 使用）。留空则默认使用 `APP_URL` 的主机名。
- **IMAP 设置** — 主机、端口、加密方式、用户名、密码（接收方式为 `imap` 时显示）。IMAP 用户名（邮箱地址）将作为验证邮件的收件地址展示给用户。
- **测试邮件接收** — 生成测试验证码和地址，验证入站邮件是否正常工作

### 域名重新验证

- **Domain reverify interval（天）** — Prism 按该频率对每个已验证域名重新核验所记录的证明（DNS TXT、HTML meta 标签或 `.well-known` 文件 — 由用户在添加时选择），默认 30 天。

### 公开资料

- **Enable public profiles** — 主开关。关闭后 `/u/<username>` 与 `/t/<team-id>` 一律返回 404，无视任何用户/团队的个人开关。详见 [公开资料](public-profile.md)。
- **用户资料 / 团队资料默认值** — 用户（或团队）尚未自定义某字段时使用的默认值。修改默认值会立即对继承用户生效；不会覆盖已显式设置的值。

### 团队加入门槛

站点级硬性最低要求，每个团队都必须满足。所有者只能在此基础上加严，不能放松。

- **默认要求 2FA** — 任何团队都要求成员至少有一个 TOTP 认证器或 Passkey。
- **默认要求验证邮箱** — 任何团队都要求成员的主邮箱已验证。

::: warning
开启这些底线会立即对所有现有成员生效 — 没有满足条件的成员将无法继续团队操作，直至自行补齐。请先通知成员后再切换。
:::

### 子团队（嵌套团队）

整个子团队特性也在这一页配置。默认值适用于大多数运营场景；按需关掉各个开关可缩小特性范围。完整语义见 [团队 → 子团队](teams.md#子团队-递归嵌套)。

- **启用子团队** — 总开关。关闭后所有子团队接口返回 403，UI 的“子团队”标签被隐藏，数据库中的 `parent_team_id` 行被忽略（保留但不参与继承，可随时重新启用而不丢数据）。
- **最大嵌套深度** — 硬性上限，校验区间 1–20。默认值 5 足以覆盖大多数组织；调大会让每次授权检查多一次 DB 往返。
- **继承团队成员资格** — 开启（默认）后，父团队成员在每个后代团队上都至少拥有相同角色（`有效 = max(直接, 继承)`）。关闭后仅看直接成员行 —— 子团队的管理员必须显式添加。
- **继承已验证域名** — 开启（默认）后，上级域名作为只读条目（带 `inherited_from`）出现在子团队列表，子团队为上级已验证父域的子域添加时也会自动通过验证。关闭后子团队必须重新自行验证想用的域名。
- **公开资料默认展示子团队** — 设置站点级默认 `default_team_profile_show_sub_teams`。每个团队仍可在 **团队 → \<team\> → 设置 → 公开资料 → 子团队** 中覆盖。

### 通知与 Telegram

- **Telegram 通知源** — 用于推送 Telegram 通知的已启用 Telegram OAuth 源 slug，复用其 bot token。留空即关闭 Telegram 投递（邮件和 Webhook 投递不受影响）。详见 [通知](notifications.md)。

### 诊断

- **Login error 保留天数** — `login_errors` 表中失败登录记录的保留期，超过后由 cron 清理。

### Danger Zone

会改变数据库形态的工具，每个都是一次幂等的批量迁移，重复执行安全。

- **Migrate secrets to Secrets Store** — 加密 site_config 中的密钥（验证码 secret、社交源 `client_secret`、SMTP/IMAP 密码、GitHub README PAT、OAuth 应用 `client_secret`）。需先绑定 [`SECRETS_KEY`](configuration.md#secrets_key-配置)。
- **Migrate D1 secrets** — 把 bearer 类机密（PAT、OAuth token/code、邀请 token、邮箱验证码、二次验证码、单条备用码）替换为 HMAC-SHA256 哈希。明文不再存储；候选值在查询时同样哈希后用 `WHERE col = ?` 比较。
- **迁移团队为 team-as-user 行** — 为每个团队补建一个 `kind = 'team'` 的合成 `users` 行，使 `oauth_apps.owner_id` 能统一连接。
- **迁移图片代理映射** — 为关闭式图片代理上线之前已经存在的头像 / 图标 URL 注册映射。
- **迁移恢复码** — 重新哈希历史明文备用码。
- **站点重置** — 清空并重新初始化。目标管理员需先签署一封邮件确认；管理面板再要求输入确认词触发清空。具有破坏性，且需要已配置邮件提供商。该按钮仅在 `wrangler.jsonc` 中设置 `ENABLE_RESET = "true"` 时显示。

## OAuth 来源

**Admin → OAuth Sources** 是配置所有社交登录提供商的地方。与简单的开关不同，每个*来源*是一个独立命名的 OAuth 连接，拥有自己的 slug、凭据和显示名称，支持同一提供商类型的多个来源（例如两个 GitHub 应用，或 Keycloak 与 Google 并存）。

### 来源字段

| 字段          | 说明                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------- |
| Slug          | 唯一 URL 键 — 出现在回调 URL 中，格式为 `/api/connections/<slug>/callback`                  |
| 提供商        | 基础 OAuth 类型（GitHub、Google、Microsoft、Discord、Telegram、X、通用 OIDC、通用 OAuth 2） |
| 显示名称      | 显示在登录/注册按钮上的标签                                                                 |
| Client ID     | OAuth 应用的客户端 ID                                                                       |
| Client Secret | OAuth 应用的客户端密钥                                                                      |
| 受信任        | 为 `true`（默认）时，通过该来源的社交登录跳过邮箱验证                                       |
| 启用          | 切换是否在登录页面显示该来源，禁用不会删除数据                                              |

### 通用 OIDC 来源

当提供商为**通用 OpenID Connect** 时，会出现额外的端点 URL 字段：

- **Issuer URL** — 提供商的 issuer 地址（如 `https://accounts.example.com`）。点击**自动发现**按钮，Prism 会从 `{issuer}/.well-known/openid-configuration` 自动填充三个端点。
- **授权 URL** — OAuth 2.0 授权端点
- **令牌 URL** — 令牌交换端点
- **用户信息 URL** — 获取用户资料的端点

可选的 **Scopes** 字段用于自定义请求的权限范围（默认：`openid email profile`）。

### 通用 OAuth 2 来源

当提供商为**通用 OAuth 2** 时，同样显示上述三个 URL 字段，但没有 OIDC 自动发现功能，需手动填写全部 URL。

### 回调 URL

每个来源的回调 URL 为：

```
https://<your-prism-domain>/api/connections/<slug>/callback
```

在提供商的开发者控制台创建 OAuth 应用时，请注册此 URL。

详细的各提供商配置说明请参阅[社交登录配置](social-login.md)。

## 邀请

当注册模式为**仅限邀请**时，邀请标签页可创建和撤销邀请令牌。

- **邮箱（可选）** — 将邀请限定到特定邮箱地址
- **最大使用次数** — 留空表示不限次数
- **有效期（天）** — 可选

邀请链接可直接复制分享。邮件发送需要配置邮件提供商。

## 用户

用户列表支持搜索和排序。点击用户行可打开详情视图。

### 用户操作

| 操作           | 效果                                                   |
| -------------- | ------------------------------------------------------ |
| 更改角色       | 在 `user` 和 `admin` 之间切换                          |
| 停用           | 阻止登录；现有令牌在过期前仍然有效                     |
| 标记邮箱已验证 | 手动验证而无需发送邮件                                 |
| 删除           | 永久删除用户及其所有数据（级联删除会话、应用、关联等） |

删除用户不可逆。其 OAuth 应用也会一并删除，这将导致使用这些应用的所有第三方集成失效。

如果用户名在 `wrangler.jsonc` 的 `LOCKDOWN_USERS` 环境变量中列出，删除按钮将被隐藏且 API 返回 403 — 该用户永久受保护。详见 [配置 → Wrangler 绑定与变量](configuration.md#wrangler-绑定与变量)。

## 应用

应用列表显示所有用户的全部 OAuth 应用，包括：

- 所有者用户名
- 验证状态
- 启用/停用状态

### 应用审核

| 操作 | 效果                                       |
| ---- | ------------------------------------------ |
| 验证 | 在授权页面上为应用添加已验证徽章           |
| 停用 | 阻止应用完成新的授权流程，现有令牌继续有效 |

已验证的应用在授权页面上显示对勾标记，表示已由管理员审核。

## 团队

**Admin → Teams** 列出全实例所有团队，包含所有者、成员数和加入门槛标记。

| 操作 | 效果                                                               |
| ---- | ------------------------------------------------------------------ |
| 查看 | 浏览成员、所属应用、已验证域名                                     |
| 解散 | 删除团队。团队拥有的应用会先被重新分配给团队所有者，避免被级联删除 |

如果团队名称在 `LOCKDOWN_TEAMS` 环境变量中列出，解散按钮将被隐藏且 API 返回 403。详见 [配置 → Wrangler 绑定与变量](configuration.md#wrangler-绑定与变量)。

`disable_user_create_team` 会对非管理员隐藏「新建团队」按钮 — 启用后只有管理员能创建团队（已存在的团队继续工作）。

## 邀请链接注册

开启 `enable_team_invite_registration` 后，**Admin → Teams** 会多出两个控制项。

**授权 / 撤销** —— 授予团队发放「可创建账号」邀请链接的权限。这是两道门中的第二道；没有它，团队所有者自己的开关不起任何作用。撤销时会一并关闭该开关，使通道立即关停，而不是在日后恢复授权时自动重新打开。

豁免项通过同一个端点设置。只有邮箱验证可被豁免，且仅限管理员操作 —— 它是唯一成本随注册量线性增长的检查。Captcha、工作量证明以及各类限流一律不可豁免。

**解散（分段）** —— 解散签发过账号的团队会注销这些账号，因此不走普通的删除按钮（对这类团队会返回 409）。阶段一用一条语句一次性停用全部受影响账号，无论数量多少。阶段二在 `restricted_dissolve_grace_hours` 之后分批删除，中间留有撤销窗口。

只删除来源为该团队的账号。用自己的 Prism 账号加入的成员、以及已转换的账号，均不受影响。

`GET /api/admin/restricted-users?invite_token=…` 可列出某个链接产生的所有账号 —— 邀请码泄漏时就用它定损。

完整模型见 [团队 → 受限账号](teams.md#受限账号)。

## 请求日志

**Admin → Request Logs** 是 Worker 每条请求的分页可筛选表 — 方法、路径、状态、耗时、IP、UA、用户 ID（如有登录）以及对应的审计日志条目（如有）。

- **筛选**：按方法、状态范围、路径前缀或用户。
- **Spectate**：打开类似 `tail -f` 的实时视图，自动刷新。
- **导出 CSV**：把当前筛选导出为 CSV。
- **详情**：单条请求的完整 timing 和审计联动。
- **清空**：删除整张表（或仅清空 spectate 缓冲）。

请求日志独立于审计日志：一次请求可能未引发任何审计动作，cron 触发的审计也没有对应的请求行。

**记录出站请求** 是单独的调试开关，用于记录 Worker 发往外部 API 的请求，例如 Telegram 和 Discord 通知投递。开启后，Prism 会把这些调用写入 `request_logs`，用外部 URL 作为 `path`，并在详情中保存已脱敏的请求 / 响应正文。除非正在排查第三方投递失败，否则请保持关闭，因为它会记录消息内容并让每次出站调用额外读取一次 KV。

## 登录错误

**Admin → Login Errors** 列出所有失败的认证尝试（密码错误、TOTP 错误、挑战过期等），含 error_code、identifier、IP、metadata。`login_error_retention_days` 控制保留时长，超时由 cron 清理。

## 审计日志

**审核日志**标签页展示平台作用域日志（Transparent Platform Control）——即所有管理员操作。用户与团队各自拥有独立的作用域日志；完整模型、筛选与作用域化 Webhook 详见 [审核日志](audit-logs.md)。它是一个分页的追加型重要事件列表：

| 事件                                        | 触发条件                                |
| ------------------------------------------- | --------------------------------------- |
| `user.register`                             | 成功注册                                |
| `user.login`                                | 成功登录                                |
| `user.login.failed`                         | 登录失败                                |
| `user.logout`                               | 退出登录                                |
| `user.delete`                               | 账号删除                                |
| `user.password_changed`                     | 通过 资料 → 安全 改密                   |
| `totp.enabled`                              | TOTP 认证器启用                         |
| `totp.disabled`                             | TOTP 认证器移除                         |
| `passkey.registered`                        | 新 Passkey 已添加                       |
| `passkey.deleted`                           | Passkey 已删除                          |
| `gpg.key_added`                             | 注册了 GPG 公钥                         |
| `gpg.key_deleted`                           | 删除了 GPG 公钥                         |
| `gpg.login`                                 | 通过 GPG 签名挑战登录                   |
| `oauth.authorize`                           | 用户批准了 OAuth 应用                   |
| `oauth.token`                               | 令牌已颁发                              |
| `oauth.consent_revoked`                     | 用户撤销了应用授权                      |
| `oauth.2fa.verify`                          | 步骤提升 2FA 完成                       |
| `oauth.2fa.sudo_revoked`                    | 用户主动结束了 sudo 宽限期              |
| `team.created`                              | 团队创建                                |
| `team.member_added`                         | 成员加入（邀请或管理员添加）            |
| `team.member_removed`                       | 成员退出或被移除                        |
| `team.transferred`                          | 团队所有权转移                          |
| `domain.added` / `verified` / `deleted`     | 域名生命周期                            |
| `connection.added` / `removed`              | 社交账号绑定生命周期                    |
| `oauth_source.create` / `update` / `delete` | OAuth 源生命周期                        |
| `invite.create` / `revoke`                  | 站点邀请生命周期                        |
| `admin.config.update`                       | 站点配置已更改                          |
| `admin.user.update`                         | 管理员修改了用户                        |
| `admin.user.delete`                         | 管理员删除了用户                        |
| `admin.app.update`                          | 管理员验证或停用了应用                  |
| `admin.team.delete`                         | 管理员解散了团队                        |
| `admin.secrets.migrate`                     | 触发了 site_config 或 D1 secrets 的迁移 |
| `admin.reset.*`                             | 站点重置请求 / 取消 / 确认              |

每条记录包含操作的 `user_id`（系统操作为 `null`）、`action`、可选的 `resource_type` / `resource_id`、`metadata` JSON 以及 `ip_address`。

OAuth scope 的完整参考见 [OAuth → Scopes](oauth.md#scopes) 与 [团队 → OAuth scope](teams.md#oauth-scope)。
