# Prism

[English](./README.md)

基于 Cloudflare Workers 构建的自托管 OAuth 2.0 / OpenID Connect 身份认证平台。无需服务器，几分钟内即可全球部署。

## 功能特性

- **OAuth 2.0 授权服务器** — 授权码 + PKCE、OpenID Connect、令牌内省与吊销
- **社会化登录** — GitHub、Google、Microsoft、Discord
- **多因素认证** — TOTP（RFC 6238）、通行密钥（WebAuthn）
- **应用注册表** — 用户自助注册和管理 OAuth 应用
- **域名验证** — 基于 DNS TXT 记录，支持自动周期性重新验证
- **机器人防护** — Cloudflare Turnstile、hCaptcha、reCAPTCHA v3 或工作量证明（WASM）
- **管理面板** — 用户管理、应用审核、审计日志、完整站点配置
- **高度可定制** — 站点名称、图标、主题色、自定义 CSS、邮件服务商
- **边缘原生** — Cloudflare Workers + D1 + KV + R2，无服务器

## 技术栈

| 层级         | 技术                              |
| ------------ | --------------------------------- |
| 运行时       | Cloudflare Workers                |
| 路由框架     | Hono v4                           |
| 数据库       | Cloudflare D1（SQLite）           |
| 缓存 / 会话  | Cloudflare KV                     |
| 文件存储     | Cloudflare R2                     |
| 前端         | React 19 + FluentUI v9            |
| 前端路由     | React Router v7                   |
| 状态管理     | Zustand v5 + TanStack Query v5    |
| PoW 求解器   | Rust → WASM（Web Worker 回退）    |

## 快速开始

```bash
# 1. 克隆并安装依赖
git clone https://github.com/siiway/prism
cd prism
pnpm install

# 2. 创建 Cloudflare 资源
wrangler d1 create prism-db
wrangler kv namespace create KV_SESSIONS
wrangler kv namespace create KV_CACHE
wrangler r2 bucket create prism-assets

# 3. 将资源 ID 填入 wrangler.jsonc

# 4. 执行数据库迁移
pnpm db:migrate

# 5. 启动开发服务器
pnpm dev   # Wrangler 监听 :8787
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

所有脚本均可自动安装缺失的工具链依赖（Rust、wasm-pack、Node.js、pnpm）。

可选参数：`--skip-wasm`（跳过 PoW WASM 编译）、`--skip-frontend`（跳过 Vite 构建）

## 部署

```bash
pnpm deploy   # 类型检查 + 构建前端 + wrangler 部署
```

## 文档

- [快速开始](https://prism.wss.moe/zh/getting-started) — 完整配置流程
- [配置说明](https://prism.wss.moe/zh/configuration) — 所有站点配置项
- [API 参考](https://prism.wss.moe/zh/api) — REST API 文档
- [OAuth / OIDC 指南](https://prism.wss.moe/zh/oauth) — 将 Prism 作为身份提供商集成
- [架构说明](https://prism.wss.moe/zh/architecture) — 系统设计与数据模型
- [管理员指南](https://prism.wss.moe/zh/admin) — 用户、应用与配置管理

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
