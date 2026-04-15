---
title: 快速开始
description: 从零开始在 Cloudflare Workers 上部署 Prism——资源创建、密钥配置、数据库迁移与首次部署。
---

# 快速开始

## 前置条件

- [Bun](https://bun.sh) 1.1+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)（`bun add -g wrangler`）
- 一个 Cloudflare 账号（免费套餐即可）
- _（可选）_ Rust + wasm-pack，用于编译 PoW WASM 加速模块

构建脚本（`scripts/build.sh`、`build.ps1`、`build.py`）会自动安装所有缺失的工具链组件。

## 1. 安装依赖

```bash
bun install
```

## 2. 创建 Cloudflare 资源

### D1 数据库

```bash
wrangler d1 create prism-db
```

将输出的 `database_id` 填入 `wrangler.jsonc`：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "prism-db",
    "database_id": "<粘贴到这里>"
  }
]
```

### KV 命名空间

```bash
wrangler kv namespace create KV_SESSIONS
wrangler kv namespace create KV_CACHE
```

将两个 `id` 值填入 `wrangler.jsonc`。本地开发时每个命名空间还需要一个 `preview_id`——可追加 `--preview` 参数重新创建，或直接复用同一个 ID 用于本地测试。

### R2 存储桶

```bash
wrangler r2 bucket create prism-assets
```

存储桶名称已在 `wrangler.jsonc` 中设置为 `prism-assets`。

## 3. 运行数据库迁移

```bash
bun db:migrate          # 本地 D1
bun db:migrate:prod     # 生产 D1
```

## 5. 启动开发服务器

```bash
bun dev
```

Vite 监听 `http://localhost:5173`。[Cloudflare Vite 插件](https://developers.cloudflare.com/workers/vite-plugin/)在 Vite 进程内运行 Worker——无需单独启动 `wrangler dev`。

## 6. 首次初始化

首次访问时，Prism 会重定向到 `/init`。填写以下信息：

- **Email** — 管理员账号邮箱
- **Username** — 纯字母数字，用于个人主页 URL
- **Display name** — 显示在界面中的名称
- **Password** — 密码
- **Site name** — 显示在浏览器标题和邮件中的站点名称

提交后将创建第一个管理员账号，并将实例标记为已初始化。后续访问将直接跳转到登录页面。

## 7. （可选）编译 PoW WASM

工作量证明机器人防护有一个纯 JS 回退实现，但使用从 `pow/src/lib.rs` 编译的 WASM 模块速度可提升约 10 倍。

```bash
cd pow
wasm-pack build --target no-modules --out-dir ../public/pow-wasm
cp ../public/pow-wasm/prism_pow_bg.wasm ../public/pow.wasm
```

或使用构建脚本自动完成此步骤：

```bash
bash scripts/build.sh --skip-frontend
```

## 8. 部署到生产环境

```bash
bun deploy
```

此命令会先执行 `tsc -b && vite build`，再执行 `wrangler deploy`。Cloudflare Assets 集成负责提供构建后的 SPA，并处理单页应用的回退路由，所有路径均解析到 `index.html`。

部署前请确保已将 `wrangler.jsonc` 中的 `APP_URL` 更新为你的生产域名：

```jsonc
"vars": {
  "APP_URL": "https://auth.yourdomain.com"
}
```

## 社交登录配置

每个提供商都需要注册一个 OAuth 应用。回调 URL 格式请参阅 [OAuth / OIDC 指南](oauth.md)。

获取客户端 ID 和密钥后，前往 **Admin → Settings → Social Login** 填写即可。无需重新部署——配置存储在 D1 中。

## 邮件配置

Prism 支持三种邮件提供商，在 **Admin → Settings → Email** 中配置。

| 提供商       | `email_provider` 值 | 密钥变量                    |
|--------------|---------------------|-----------------------------|
| Resend       | `resend`            | `email_api_key`（管理员界面） |
| Mailchannels | `mailchannels`      | — （无需密钥）                |
| SMTP         | `smtp`              | 见 UI                       |
| 未配置/关闭  | `none`              | —                           |

邮件用于邮箱验证。此功能为可选——将 `require_email_verification` 设为 `false`（默认值）可跳过邮件验证。
