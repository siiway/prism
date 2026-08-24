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
- **机器人防护** — Cloudflare Turnstile、hCaptcha、reCAPTCHA v3 或工作量证明（Rust→WASM）；同时可门禁 2FA
- **Webhook 与通知** — 用户 + 管理员 webhook、应用事件流（webhook / SSE / WebSocket）、邮件 + Telegram 通知，规则引擎做精细路由
- **公开资料** — 可选启用 `/u/<username>` 与 `/t/<team-id>`，按字段控制可见性，支持 GPG 公钥与 GitHub README 同步
- **数据库加密** — AES-GCM 信封 + keyed HMAC，根植于 Cloudflare Secrets Store 绑定
- **管理面板** — 用户/应用/团队审核、审计日志、请求日志、登录错误、完整站点配置
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
| PoW 求解器  | Rust → WASM（Web Worker 回退） |

## 快速开始

```bash
# 1. 克隆并安装依赖
git clone https://github.com/siiway/prism
cd prism
bun install

# 2. 创建 Cloudflare 资源
wrangler d1 create prism-db
wrangler kv namespace create KV_SESSIONS
wrangler kv namespace create KV_CACHE
wrangler r2 bucket create prism-assets

# 3. 将资源 ID 填入 wrangler.jsonc

# 4. 执行数据库迁移
bun run db:migrate

# 5. 启动开发服务器
bun run dev   # Wrangler 监听 :8787
```

打开 <http://localhost:5173>，系统会自动跳转到首次运行配置页面以创建管理员账号。

## 构建

```bash
# 跨平台（需要 Python 3）
python scripts/build.py

# Linux / macOS
bash scripts/build.sh

# Windows PowerShell
.\scripts\build.ps1
```

所有脚本均可自动安装缺失的工具链依赖（Rust、wasm-pack、Node.js、bun）。

可选参数：`--skip-wasm`（跳过 PoW WASM 编译）、`--skip-frontend`（跳过 Vite 构建）

## 部署

```bash
bun run deploy   # 类型检查 + 构建前端 + wrangler 部署
```

## 文档

- [快速开始](https://prism.wss.moe/zh/getting-started) — 完整配置流程
- [配置说明](https://prism.wss.moe/zh/configuration) — 所有站点配置项 + Wrangler 绑定
- [架构说明](https://prism.wss.moe/zh/architecture) — 系统设计、数据模型、密钥存储策略
- [管理员指南](https://prism.wss.moe/zh/admin) — 用户、应用、团队与配置管理
- [API 参考](https://prism.wss.moe/zh/api) — REST API 文档
- [OAuth / OIDC 指南](https://prism.wss.moe/zh/oauth) — 将 Prism 作为身份提供商集成
- [团队](https://prism.wss.moe/zh/teams) — 共享应用与域名的所有权
- [通知](https://prism.wss.moe/zh/notifications) — 邮件与 Telegram 通知规则
- [Webhook](https://prism.wss.moe/zh/webhooks) 与 [应用通知](https://prism.wss.moe/zh/app-notifications)
- [跨应用权限](https://prism.wss.moe/zh/app-permissions) — 把 scope 暴露给其他应用
- [个人访问令牌](https://prism.wss.moe/zh/personal-access-tokens) 与 [公开资料](https://prism.wss.moe/zh/public-profile)

## 项目结构

```text
prism/
├── worker/                  # Cloudflare Worker（后端）
│   ├── index.ts             # Hono 应用入口
│   ├── types.ts             # 共享 TypeScript 类型
│   ├── db/migrations/       # D1 SQL 迁移文件
│   ├── lib/                 # 加密、JWT、TOTP、WebAuthn、邮件、配置
│   ├── middleware/          # 认证、验证码、限流
│   ├── cron/                # 定时任务（域名重新验证等）
│   └── routes/              # init、auth、oauth、apps、domains、connections、user、admin
├── src/                     # React 前端
│   ├── App.tsx              # 路由 + 守卫
│   ├── components/          # 布局、主题、验证码
│   ├── pages/               # 所有页面组件
│   ├── lib/                 # API 客户端、PoW 求解器
│   └── store/               # Zustand 认证状态
├── pow/                     # Rust PoW WASM crate
│   └── src/lib.rs
├── scripts/                 # 跨平台构建脚本
│   ├── build.sh
│   ├── build.ps1
│   └── build.py
├── public/                  # 静态资源（构建后 pow.wasm 输出至此）
├── wrangler.jsonc           # Cloudflare Worker 配置
├── tsconfig.app.json        # 前端 TypeScript 配置
├── tsconfig.worker.json     # Worker TypeScript 配置
└── tsconfig.node.json       # Node 工具链 TypeScript 配置
```

## 许可证

GNU 通用公共许可证 3.0，详见 [LICENSE](./LICENSE)。

### 图标

本项目使用 Microsoft 的 [fluentui-system-icons](https://github.com/microsoft/fluentui-system-icons) 作为图标库。
详见 [THIRD_PARTY_LICENSES/fluentui-system-icons](./THIRD_PARTY_LICENSES/fluentui-system-icons)。

### FluentUI

本项目使用 Microsoft 的 [fluentui](https://github.com/microsoft/fluentui) 作为 UI 框架。
详见 [THIRD_PARTY_LICENSES/fluentui](./THIRD_PARTY_LICENSES/fluentui)。

### worker-mailer

本项目使用 zou-yu 的 [worker-mailer](https://github.com/zou-yu/worker-mailer/blob/main/LICENSE) 处理邮件发送。
详见 [THIRD_PARTY_LICENSES/worker-mailer](./THIRD_PARTY_LICENSES/worker-mailer)。
