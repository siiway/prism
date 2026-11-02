# Prism

[English](./README.md)

基于 Cloudflare Workers 构建的自托管 OAuth 2.0 / OpenID Connect 身份认证平台。无需服务器，几分钟内即可全球部署。

## 功能特性

- **OAuth 2.0 + OpenID Connect** — 授权码 + PKCE、RS256 ID Token、令牌内省 / 撤销、UserInfo、Discovery、JWKS
- **步骤提升 2FA** — 服务端发起、行动钉死的二次确认；为高风险操作提供 sudo 宽限期
- **社交与联邦登录** — GitHub、Google、Microsoft、Discord、Telegram、X、Cloudflare，Generic OIDC、Generic OAuth 2 — 同一类型可多源
- **多因素认证** — 单账号多 TOTP 认证器、Passkey（WebAuthn）、GPG 公钥（含 ML-DSA）、备用码
- **团队** — OAuth 应用与域名的共享所有权；角色、邀请、所有权转移、站点级加入门槛
- **应用注册** — 用户自助创建 OAuth 应用；管理员可验证；支持跨应用 scope
- **域名验证** — 每个域名可在 DNS TXT、HTML meta、`.well-known` 中任选一种，自动重新核验
- **机器人防护** — Cloudflare Turnstile、hCaptcha、reCAPTCHA v3、极验或 Cap（工作量证明）；同时可门禁 2FA
- **Webhook 与通知** — 用户 + 管理员 webhook、应用事件流（webhook / SSE / WebSocket）、邮件 + Telegram 通知，规则引擎做精细路由
- **公开资料** — 可选启用 `/u/<username>` 与 `/t/<team-id>`，按字段控制可见性，支持 GPG 公钥与 GitHub README 同步
- **数据库加密** — AES-GCM 信封 + keyed HMAC，根植于 Cloudflare Secrets Store 绑定
- **管理面板** — 用户/应用/团队审核、审计日志、登录错误、完整站点配置
- **高度可定制** — 站点名称、图标、主题色、自定义 CSS、邮件 / 验证码 provider
- **边缘原生 + SSR** — Cloudflare Workers + D1 + KV + R2，React 19 服务端渲染，零服务器

## 技术栈

| 层级        | 技术                           |
| ----------- | ------------------------------ |
| 运行时      | Cloudflare Workers             |
| 路由框架    | Hono v4                        |
| 数据库      | Cloudflare D1（SQLite）        |
| 缓存 / 会话 | Cloudflare KV                  |
| 文件存储    | Cloudflare R2                  |
| 前端        | React 19 + FluentUI v9         |
| 前端路由    | React Router v7                |
| 状态管理    | Zustand v5 + TanStack Query v5 |

## 快速开始

你需要 [Bun](https://bun.sh) 和一个 Cloudflare 账号（免费套餐即可）。

```bash
git clone https://github.com/siiway/prism
cd prism/app
bun install
bun run setup
```

setup 会登录你的 Cloudflare 账号、询问你的 URL、创建数据库和存储，然后部署。打开你的 URL 创建管理员账号。详见[快速开始](https://prism.wss.moe/zh/getting-started)。

更新：在 `app/` 中运行 `git pull`、`bun install`、`bun run deploy`。

参与 Prism 开发请参阅 [CONTRIBUTING.md](./.github/CONTRIBUTING.md)。

## 文档

- [快速开始](https://prism.wss.moe/zh/getting-started) — 完整配置流程
- [配置说明](https://prism.wss.moe/zh/configuration) — 所有站点配置项 + Wrangler 绑定

- [管理员指南](https://prism.wss.moe/zh/admin) — 用户、应用、团队与配置管理
- [API 参考](https://prism.wss.moe/zh/api) — REST API 文档
- [OAuth / OIDC 指南](https://prism.wss.moe/zh/oauth) — 将 Prism 作为身份提供商集成
- [团队](https://prism.wss.moe/zh/teams) — 共享应用与域名的所有权
- [通知](https://prism.wss.moe/zh/notifications) — 邮件与 Telegram 通知规则
- [Webhook](https://prism.wss.moe/zh/webhooks) 与 [应用通知](https://prism.wss.moe/zh/app-notifications)
- [跨应用权限](https://prism.wss.moe/zh/app-permissions) — 把 scope 暴露给其他应用
- [个人访问令牌](https://prism.wss.moe/zh/personal-access-tokens) 与 [公开资料](https://prism.wss.moe/zh/public-profile)

## 许可证

GNU 通用公共许可证 3.0，详见 [LICENSE](./LICENSE)。第三方许可证见 [NOTICE.md](./NOTICE.md)。
