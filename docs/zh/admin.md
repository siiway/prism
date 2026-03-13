---
title: 管理员指南
description: 在 Prism 管理面板中管理用户、应用、OAuth 来源、设置和审计日志。
---

# 管理员指南

管理面板位于 `/admin`，仅对 `role = admin` 的用户可见。第一个管理员账号在首次初始化时创建。后续管理员可通过 **Admin → Users → Edit User → Role → Admin** 提升权限。

## 仪表盘

显示四个汇总统计数据：

| 统计项       | 说明                    |
|--------------|-------------------------|
| 总用户数     | 所有已注册账号          |
| OAuth 应用数 | 所有已注册应用          |
| 已验证域名数 | 通过 DNS 验证的域名     |
| 活跃令牌数   | 未过期的 OAuth 访问令牌 |

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

### 机器人防护

选择一个验证码提供商：

| 提供商               | 说明                                              |
|----------------------|---------------------------------------------------|
| 无                   | 不启用机器人防护                                  |
| Cloudflare Turnstile | 需要 Turnstile 站点密钥 + 密钥，提供免费套餐       |
| hCaptcha             | 需要 hCaptcha 站点密钥 + 密钥                     |
| reCAPTCHA v3         | 需要 Google reCAPTCHA v3 站点密钥 + 密钥，无感验证 |
| 工作量证明           | 无需第三方服务，难度 20 在现代硬件上约需 0.1–2 秒  |

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

- **Domain reverify interval（天）** — Prism 重新检查已验证域名 DNS TXT 记录的频率，默认 30 天。

## OAuth 来源

**Admin → OAuth Sources** 是配置所有社交登录提供商的地方。与简单的开关不同，每个*来源*是一个独立命名的 OAuth 连接，拥有自己的 slug、凭据和显示名称，支持同一提供商类型的多个来源（例如两个 GitHub 应用，或 Keycloak 与 Google 并存）。

### 来源字段

| 字段          | 说明                                                                      |
|---------------|---------------------------------------------------------------------------|
| Slug          | 唯一 URL 键 — 出现在回调 URL 中，格式为 `/api/connections/<slug>/callback` |
| 提供商        | 基础 OAuth 类型（GitHub、Google、Microsoft、Discord、通用 OIDC、通用 OAuth 2）   |
| 显示名称      | 显示在登录/注册按钮上的标签                                               |
| Client ID     | OAuth 应用的客户端 ID                                                     |
| Client Secret | OAuth 应用的客户端密钥                                                    |
| 启用          | 切换是否在登录页面显示该来源，禁用不会删除数据                             |

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

| 操作           | 效果                                               |
|----------------|----------------------------------------------------|
| 更改角色       | 在 `user` 和 `admin` 之间切换                      |
| 停用           | 阻止登录；现有令牌在过期前仍然有效                  |
| 标记邮箱已验证 | 手动验证而无需发送邮件                             |
| 删除           | 永久删除用户及其所有数据（级联删除会话、应用、关联等） |

删除用户不可逆。其 OAuth 应用也会一并删除，这将导致使用这些应用的所有第三方集成失效。

## 应用

应用列表显示所有用户的全部 OAuth 应用，包括：

- 所有者用户名
- 验证状态
- 启用/停用状态

### 应用审核

| 操作 | 效果                                      |
|------|-------------------------------------------|
| 验证 | 在授权页面上为应用添加已验证徽章          |
| 停用 | 阻止应用完成新的授权流程，现有令牌继续有效 |

已验证的应用在授权页面上显示对勾标记，表示已由管理员审核。

## 审计日志

审计日志是一个分页的追加型重要事件列表：

| 事件                  | 触发条件              |
|-----------------------|-----------------------|
| `user.register`       | 成功注册              |
| `user.login`          | 成功登录              |
| `user.login.failed`   | 登录失败              |
| `user.logout`         | 退出登录              |
| `user.delete`         | 账号删除              |
| `totp.enabled`        | TOTP 设置完成         |
| `totp.disabled`       | TOTP 已禁用           |
| `passkey.registered`  | 新 Passkey 已添加     |
| `passkey.deleted`     | Passkey 已删除        |
| `oauth.authorize`     | 用户批准了 OAuth 应用 |
| `oauth.token`         | 令牌已颁发            |
| `admin.config.update` | 站点配置已更改        |
| `admin.user.update`   | 管理员修改了用户      |
| `admin.user.delete`   | 管理员删除了用户      |

每条记录包含操作的 `user_id`、`action`、可选的 `resource_type` / `resource_id`、`metadata` JSON 对象以及 `ip_address`。

## OAuth 权限范围参考

Prism 注册的 OAuth 应用和个人访问令牌可申请的所有权限范围：

### 标准范围

| 范围             | 说明                                     |
|------------------|------------------------------------------|
| `openid`         | OIDC 身份——启用 `id_token` 和 `sub` 声明 |
| `profile`        | 读取显示名称、用户名、头像                 |
| `profile:write`  | 更新显示名称和头像                       |
| `email`          | 读取邮箱地址及验证状态                   |
| `offline_access` | 颁发刷新令牌                             |

### 应用范围

| 范围         | 说明                                   |
|--------------|----------------------------------------|
| `apps:read`  | 列出令牌所有者的 OAuth 应用            |
| `apps:write` | 创建、更新和删除令牌所有者的 OAuth 应用 |

### 团队范围

| 范围           | 说明                        |
|----------------|-----------------------------|
| `teams:read`   | 查看团队成员身份和角色      |
| `teams:create` | 创建新团队                  |
| `teams:write`  | 更新团队设置；添加和移除成员 |
| `teams:delete` | 删除团队（仅限所有者）        |

### 域名范围

| 范围            | 说明                            |
|-----------------|---------------------------------|
| `domains:read`  | 列出已验证域名                  |
| `domains:write` | 添加域名、触发 DNS 验证、移除域名 |

### GPG 密钥

| 范围        | 说明                          |
|-------------|-------------------------------|
| `gpg:read`  | 列出令牌所有者注册的 GPG 公钥 |
| `gpg:write` | 添加或删除 GPG 公钥           |

### 社交连接

| 范围           | 说明                           |
|----------------|--------------------------------|
| `social:read`  | 列出令牌所有者已关联的社交账号 |
| `social:write` | 断开令牌所有者的社交提供商账号 |

### 管理员范围（要求令牌所有者 `role = admin`）

| 范围                    | 说明                              |
|-------------------------|-----------------------------------|
| `admin:users:read`      | 列出并查看所有用户账号            |
| `admin:users:write`     | 更新用户角色、状态、显示名称和头像  |
| `admin:users:delete`    | 永久删除用户账号                  |
| `admin:config:read`     | 读取全站配置（凭据字段已脱敏）      |
| `admin:config:write`    | 更新站点设置（注册策略、外观等）     |
| `admin:invites:read`    | 列出所有站点邀请链接              |
| `admin:invites:create`  | 生成新的站点邀请链接              |
| `admin:invites:delete`  | 撤销站点邀请链接                  |
| `admin:webhooks:read`   | 列出 Webhook 并查看投递历史       |
| `admin:webhooks:write`  | 创建、更新并发送测试请求至 Webhook |
| `admin:webhooks:delete` | 永久删除 Webhook                  |
