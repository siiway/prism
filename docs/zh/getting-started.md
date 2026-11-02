---
title: 快速开始
description: 从零开始在 Cloudflare Workers 上设置 Prism — 资源创建、密钥配置、数据库迁移与首次部署。
---

# 快速开始

## 前置条件

- [Bun](https://bun.sh) 1.1+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)（`bun add -g wrangler`）
- 一个 Cloudflare 账号（免费套餐即可）
- _（可选）_ Rust 和 wasm-pack，用于更快的工作量证明求解器

构建脚本（`scripts/build.sh`、`build.ps1`、`build.py`）会为你安装任何缺失的工具链组件。

## 1. 安装依赖

```bash
bun install
```

## 2. 创建 Cloudflare 资源

### D1 数据库

```bash
wrangler d1 create prism-db
```

将 `database_id` 复制到 `wrangler.jsonc`：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "prism-db",
    "database_id": "<paste here>",
    "migrations_dir": "src/worker/db/migrations"
  }
]
```

### KV 命名空间

```bash
wrangler kv namespace create KV_SESSIONS
wrangler kv namespace create KV_CACHE
```

将两个 `id` 值复制到 `wrangler.jsonc`。每个命名空间还需要一个 `preview_id` 用于本地开发；用 `--preview` 运行相同命令，或复用相同的 ID。

### R2 存储桶 _（可选）_

R2 存储因过大而无法保存在 D1 中的已上传头像和应用图标。该绑定默认被注释掉，因此不启用也能部署。启用方式：

```bash
wrangler r2 bucket create prism-assets
```

然后取消 `wrangler.jsonc` 中 `r2_buckets` 块的注释。

### Secrets Store（强烈推荐）

Cloudflare Secrets Store 中的主密钥会加密敏感值（OAuth 客户端密钥、验证码密钥、SMTP/IMAP 密码），并以带密钥的哈希形式存储访问令牌和授权码。生成一个 32 字节密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

在 Cloudflare 控制台创建 Secrets Store，将该值以名称 `prism-secrets-key` 保存，并将绑定添加到 `wrangler.jsonc`：

```jsonc
"secrets_store_secrets": [
  {
    "binding": "SECRETS_KEY",
    "store_id": "<your-store-id>",
    "secret_name": "prism-secrets-key"
  }
]
```

没有此绑定时，Prism 仍可正常工作，但会以明文存储。你可以稍后再添加。

## 3. 运行迁移

```bash
bun db:migrate          # local D1
bun db:migrate:prod     # production D1
```

## 4. 设置 `APP_URL`

在 `wrangler.jsonc` 中设置 Worker 的对外 origin：

```jsonc
"vars": {
  "APP_URL": "https://auth.yourdomain.com"
}
```

本地开发时，保持默认值（`http://localhost:5173`）。

同一个块还包含可选设置，例如 `LOCKDOWN_USERS` / `LOCKDOWN_TEAMS`（任何人都无法删除的账号和团队）以及 `ENABLE_RESET`（显示 **站点重置** 按钮）。参见[配置](configuration.md#wrangler-绑定与变量)。

## 5. 启动开发服务器

```bash
bun dev
```

Vite 在 `http://localhost:5173` 启动，并同时运行 Worker，因此不需要单独运行 `wrangler dev`。

## 6. 首次初始化

首次访问时，Prism 会重定向到 `/init`。请填写：

- **邮箱** — 管理员账号的邮箱
- **用户名** — 字母和数字，用于公开资料 URL
- **显示名称**
- **密码**
- **站点名称** — 显示在浏览器标题和邮件中

这会创建首个管理员账号。之后访问会直接进入登录页。

## 7. 部署到生产

```bash
bash scripts/deploy.sh          # or: pwsh scripts/deploy.ps1
                                # or: python scripts/deploy.py
```

脚本会按顺序执行构建、应用待处理的 D1 迁移，然后发布 Worker。它会在要求你确认之前列出待处理的迁移。

| 选项                | 作用                      |
| ------------------- | ------------------------- |
| `--dry-run`         | 打印每条命令而不执行      |
| `-y`, `--yes`       | 跳过确认提示（用于 CI）   |
| `--migrations-only` | 仅应用迁移，不部署        |
| `--skip-migrations` | 发布而不改动数据库        |
| `--skip-build`      | 部署 `dist/` 中已有的内容 |

`bun deploy` 也可用，但**不会应用迁移**。请先运行 `bun db:migrate:prod`。部署新代码前务必先应用迁移；部分安全功能在其数据表存在之前会失败关闭。

### CI

仓库的 GitHub Actions 会在每次推送到 `main` 时部署，并在拉取请求上运行检查。部署需要一个 `CLOUDFLARE_API_TOKEN` Secret，具有 **Workers Scripts:Edit**、**D1:Edit**、**Workers KV Storage:Edit** 和 **Secrets Store:Read** 权限；如果使用自定义域名，还需要 **Workers Routes:Edit** 和 **Zone:Read**。如果仓库还连接了 Cloudflare Workers Builds，请断开连接，否则每次推送都会部署两次。

## 8. 部署后：加密密钥

如果你绑定了 `SECRETS_KEY`，请以管理员身份登录，并打开 **管理 → 维护 → 危险区域**。运行以下操作一次；两者都可安全重复执行：

- **迁移密钥到 Secret Store** — 加密现有密钥。
- **哈希并加密已存储的令牌** — 将已存储的令牌和授权码替换为带密钥的哈希。

## 社交登录

在 **管理 → OAuth 来源** 下添加提供商。参见[社交登录配置](social-login.md)。

## 邮件

Prism 可通过 Resend、Mailchannels 或 SMTP 发送邮件，配置位于 **管理 → 设置 → 邮件**。邮件用于验证、密码重置和通知。

| 提供商       | `email_provider` |
| ------------ | ---------------- |
| Resend       | `resend`         |
| Mailchannels | `mailchannels`   |
| SMTP         | `smtp`           |
| 关闭         | `none`           |

默认情况下，用户可在验证邮箱前登录；开启 `require_email_verification` 可改变这一点。若要允许用户通过向 Prism 发送邮件来完成验证，请使用 Cloudflare Email Workers 或 IMAP 邮箱（参见[管理指南](admin.md#邮件)）。
