---
title: 管理员指南
description: 在 Prism 管理面板中管理用户、应用、设置和审计日志。
---

# 管理员指南

管理面板位于 `/admin`，仅对 `role = admin` 的用户可见。第一个管理员账号在首次初始化时创建。后续管理员可通过 **Admin → Users → Edit User → Role → Admin** 提升权限。

## 仪表盘

显示四个汇总统计数据：

| 统计项         | 说明                         |
| -------------- | ---------------------------- |
| 总用户数       | 所有已注册账号               |
| OAuth 应用数   | 所有已注册应用               |
| 已验证域名数   | 通过 DNS 验证的域名          |
| 活跃令牌数     | 未过期的 OAuth 访问令牌      |

## 设置

设置按标签页分组。所有更改立即生效——无需重新部署。

### 通用

- **Site name** — 显示在浏览器标签和邮件模板中
- **Site description** — 显示在登录页面
- **Site icon URL** — PNG/SVG Logo 的链接
- **Allow registration** — 开启/关闭自助注册。禁用时，只有管理员才能创建账号（功能尚未实现——请联系实例管理员）
- **Require email verification** — 用户必须点击验证链接后才能登录

### 外观

- **Accent color** — 驱动整个 FluentUI 主题的十六进制颜色。保存后立即生效。
- **Custom CSS** — 注入到每个页面的 `<style>` 块，适合在不修改源码的情况下进行品牌定制。

### 安全 / 会话

- **Session TTL（天）** — 登录会话的有效期
- **Access token TTL（分钟）** — OAuth 访问令牌有效期
- **Refresh token TTL（天）** — OAuth 刷新令牌有效期

### 机器人防护

选择一个验证码提供商：

| 提供商               | 说明                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| 无                   | 不启用机器人防护                                                       |
| Cloudflare Turnstile | 需要 Turnstile 站点密钥 + 密钥。提供免费套餐。                         |
| hCaptcha             | 需要 hCaptcha 站点密钥 + 密钥。                                        |
| reCAPTCHA v3         | 需要 Google reCAPTCHA v3 站点密钥 + 密钥。无感验证。                  |
| 工作量证明           | 无需第三方服务。难度 20 在现代硬件上约需 0.1–2 秒。                   |

### 社交登录

为每个提供商填写客户端 ID 和密钥。两个字段均留空则禁用该提供商。各提供商开发者控制台需注册的回调 URL 请参阅[配置文档](configuration.md#社交登录)。

### 邮件

- **Email provider** — `none`、`resend` 或 `mailchannels`
- **Email API key** — Resend 或 Mailchannels 的 API 密钥
- **From address** — 验证邮件的发件地址

### 域名重新验证

- **Domain reverify interval（天）** — Prism 重新检查已验证域名 DNS TXT 记录的频率。默认为 30 天。

## 用户

用户列表支持搜索和排序。点击用户行可打开详情视图。

### 用户操作

| 操作             | 效果                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------- |
| 更改角色         | 在 `user` 和 `admin` 之间切换                                                                |
| 停用             | 阻止登录；现有令牌在过期前仍然有效                                                           |
| 标记邮箱已验证   | 手动验证而无需发送邮件                                                                       |
| 删除             | 永久删除用户及其所有数据（级联删除会话、应用、关联等）                                       |

删除用户不可逆。其 OAuth 应用也会一并删除，这将导致使用这些应用的所有第三方集成失效。

## 应用

应用列表显示所有用户的全部 OAuth 应用，包括：

- 所有者用户名
- 验证状态
- 启用/停用状态

### 应用审核

| 操作   | 效果                                                                     |
| ------ | ------------------------------------------------------------------------ |
| 验证   | 在授权页面上为应用添加已验证徽章                                         |
| 停用   | 阻止应用完成新的授权流程。现有令牌继续有效。                             |

已验证的应用在授权页面上显示对勾标记，表示已由管理员审核。

## 审计日志

审计日志是一个分页的追加型重要事件列表：

| 事件                  | 触发条件             |
| --------------------- | -------------------- |
| `user.register`       | 成功注册             |
| `user.login`          | 成功登录             |
| `user.login.failed`   | 登录失败             |
| `user.logout`         | 退出登录             |
| `user.delete`         | 账号删除             |
| `totp.enabled`        | TOTP 设置完成        |
| `totp.disabled`       | TOTP 已禁用          |
| `passkey.registered`  | 新 Passkey 已添加    |
| `passkey.deleted`     | Passkey 已删除       |
| `oauth.authorize`     | 用户批准了 OAuth 应用|
| `oauth.token`         | 令牌已颁发           |
| `admin.config.update` | 站点配置已更改       |
| `admin.user.update`   | 管理员修改了用户     |
| `admin.user.delete`   | 管理员删除了用户     |

每条记录包含操作的 `user_id`、`action`、可选的 `resource_type` / `resource_id`、`metadata` JSON 对象以及 `ip_address`。
