---
title: 快速开始
description: 用一条命令将 Prism 部署到你的 Cloudflare 账号。
---

# 快速开始

## 前置条件

- [Bun](https://bun.sh) 1.3+
- 一个 Cloudflare 账号（免费套餐即可）
- _（可选）_ [Rust](https://rustup.rs)，用于更快的工作量证明求解器。
  没有它时，浏览器会使用较慢的 JavaScript 求解器。

## 部署

```bash
git clone https://github.com/siiway/prism
cd prism/app
bun install
bun run setup
```

setup 会：

1. 登录你的 Cloudflare 账号（会打开浏览器）。
2. 询问 Worker 名称和公开 URL：可以是 Cloudflare 账号下的域名，例如
   `https://auth.example.com`，也可以是 `workers.dev` 地址。
3. 创建 D1 数据库和 KV 命名空间，并按需创建用于上传图片的 R2
   存储桶，以及用于加密已存储密钥的 Secrets Store 密钥。
4. 将它们的 ID、你的 URL 和账号写入 `app/wrangler.jsonc`。
5. 构建、应用数据库迁移并部署。

setup 会复用已存在的资源，因此你可以再次运行它，例如稍后添加 R2。
`bun run setup --dry-run` 会显示它将执行的操作，而不做任何更改。

## 首次初始化

首次访问时，Prism 会重定向到 `/init`。请输入管理员账号的
邮箱、用户名、显示名称和密码，以及站点名称。之后
访问会直接进入登录页。

## 更新

在 `app/` 中运行：

```bash
git pull
bun install
bun run deploy
```

`bun run deploy` 会构建、应用待处理的数据库迁移，然后发布 Worker。它会
列出待处理的迁移，并在改动生产环境前请求确认。请用它
代替 `wrangler deploy`，后者会跳过迁移。

| 选项                | 作用                      |
| ------------------- | ------------------------- |
| `--dry-run`         | 打印每条命令而不执行      |
| `-y`, `--yes`       | 跳过确认提示（用于 CI）   |
| `--migrations-only` | 仅应用迁移，不部署        |
| `--skip-migrations` | 发布而不改动数据库        |
| `--skip-build`      | 部署 `dist/` 中已有的内容 |

### CI

仓库的 GitHub Actions 会在每次推送到 `main` 时部署，并在拉取请求上运行检查。
部署需要一个 `CLOUDFLARE_API_TOKEN` Secret，具有 **Workers Scripts:Edit**、
**D1:Edit**、**Workers KV Storage:Edit** 和 **Secrets Store:Read** 权限；
如果使用自定义域名，还需要 **Workers Routes:Edit** 和 **Zone:Read**。如果仓库还连接了
Cloudflare Workers Builds，请断开连接，否则每次推送都会部署两次。

## `app/wrangler.jsonc` 中的设置

`vars` 块包含可选设置，例如 `LOCKDOWN_USERS` /
`LOCKDOWN_TEAMS`（任何人都无法删除的账号和团队）以及 `ENABLE_RESET`
（显示 **站点重置** 按钮）。参见
[配置](configuration.md#wrangler-绑定与变量)。

## 稍后添加 Secrets Store 密钥

如果你要为已有数据的站点添加该密钥，请以管理员身份登录，并
打开 **管理 → 维护 → 危险区域**。运行以下操作一次；两者都可安全重复执行：

- **迁移密钥到 Secret Store**：加密现有密钥。
- **哈希并加密已存储的令牌**：将令牌和授权码存储为带密钥的哈希。

## 社交登录

在 **管理 → OAuth 来源** 下添加提供商。参见
[社交登录配置](social-login.md)。

## 邮件

Prism 可通过 Resend、Mailchannels 或 SMTP 发送邮件，配置位于
**管理 → 设置 → 邮件**。邮件用于验证、密码重置和通知。

| 提供商       | `email_provider` |
| ------------ | ---------------- |
| Resend       | `resend`         |
| Mailchannels | `mailchannels`   |
| SMTP         | `smtp`           |
| 关闭         | `none`           |

默认情况下，用户可在验证邮箱前登录；开启 `require_email_verification`
可改变这一点。若要允许用户通过向 Prism 发送邮件来完成验证，请使用
Cloudflare Email Workers 或 IMAP 邮箱（参见[管理指南](admin.md#邮件)）。
