---
title: 快速开始
description: 从零开始在 Cloudflare Workers 上部署 Prism — 资源创建、密钥配置、数据库迁移与首次部署。
---

# 快速开始

## 前置条件

- [Bun](https://bun.sh) 1.1+（也可用 `pnpm`，两份 lockfile 同步维护）
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

把返回的 `database_id` 复制到 `wrangler.jsonc`：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "prism-db",
    "database_id": "<paste here>",
    "migrations_dir": "worker/db/migrations"
  }
]
```

### KV namespace

```bash
wrangler kv namespace create KV_SESSIONS
wrangler kv namespace create KV_CACHE
```

把两个 `id` 复制到 `wrangler.jsonc`。本地开发也需要 `preview_id` — 可以加 `--preview` 重跑命令，或直接复用相同 ID。

### R2 桶 _（可选）_

R2 仅用于存放超过 D1 内联限制的头像/应用图标；较小的上传直接写入 D1。默认 `wrangler.jsonc` 中绑定被注释，无 R2 也能直接部署。开启 R2：

```bash
wrangler r2 bucket create prism-assets
```

…然后取消 `r2_buckets` 块的注释。

### Secrets Store（强烈推荐）

生成一把 32 字节主密钥，保存进 Cloudflare Secrets Store。所有敏感字段会因此在数据库中加密（OAuth `client_secret`、验证码 secret、SMTP/IMAP 密码、GitHub README PAT，以及 [架构 → 数据库中的密钥](architecture.md#数据库中的密钥) 列出的所有 bearer 类机密）。

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

在 Cloudflare 控制台创建 Secrets Store，把生成的值以 `prism-secrets-key` 为名存入，然后在 `wrangler.jsonc` 中加入绑定：

```jsonc
"secrets_store_secrets": [
  {
    "binding": "SECRETS_KEY",
    "store_id": "<your-store-id>",
    "secret_name": "prism-secrets-key"
  }
]
```

不绑定也没问题：加密/哈希将退化为 no-op，Prism 会以明文存储继续运行。可以日后再启用 — **Admin → Settings → Danger Zone** 中的迁移按钮是幂等的。

## 3. 运行迁移

```bash
bun db:migrate          # 本地 D1
bun db:migrate:prod     # 线上 D1
```

## 4. 设置 `APP_URL`

更新 `wrangler.jsonc`，让 Worker 知道自己的对外 origin：

```jsonc
"vars": {
  "APP_URL": "https://auth.yourdomain.com"
}
```

本地开发可保持默认，开发服务器使用 `http://localhost:5173`。

`vars` 块中还包含三个可选的零配置开关：

- `LOCKDOWN_USERS` / `LOCKDOWN_TEAMS` — 逗号分隔的用户名/团队名称列表，
  列表中的记录将永久受保护，无法删除（API 返回 403）。留空即禁用。
- `ENABLE_RESET` — 设为 `"true"` 后在管理面板 Danger Zone 中显示 **站点重置** 按钮。
  为防误操作，默认隐藏。`NO_RESET_COOLDOWN` 可跳过确认前的 30 分钟等待。

详见 [配置](configuration.md#wrangler-绑定与变量) 了解所有 Wrangler 变量与绑定。

## 5. 启动开发服务器

```bash
bun dev
```

Vite 监听 `http://localhost:5173`。[Cloudflare Vite 插件](https://developers.cloudflare.com/workers/vite-plugin/) 把 Worker 与 Vite 一起跑在同一个进程里 — 无需另起 `wrangler dev`，`entry-server.tsx`（SSR）也会随客户端一起热更新。

## 6. 首次初始化

首次访问时 Prism 会跳到 `/init`，请填写：

- **邮箱** — 管理员账号邮箱
- **用户名** — 字母数字组合，会出现在公开资料 URL 中
- **显示名称** — UI 上展示的名字
- **密码**
- **站点名称** — 浏览器标题与邮件中使用

提交后会创建首个管理员账号并把站点标记为已初始化；后续访问直接跳到登录页。

## 7. （可选）编译 PoW WASM

PoW 防机器人有纯 JS 兜底，但用 `pow/src/lib.rs` 编译出的 WASM 模块快约 10 倍。

```bash
cd pow
wasm-pack build --target no-modules --out-dir ../public/pow-wasm
cp ../public/pow-wasm/prism_pow_bg.wasm ../public/pow.wasm
```

或直接用任意一个构建脚本（自动完成上述步骤）：

```bash
bash scripts/build.sh --skip-frontend
```

## 8. 部署到生产

```bash
bash scripts/deploy.sh          # 或：pwsh scripts/deploy.ps1
                                # 或：python scripts/deploy.py
```

部署脚本会依次执行构建、应用待处理的 D1 迁移、发布 Worker。顺序是刻意安排的：编译失败会在任何东西进入生产环境之前中断整个流程；迁移先于依赖它的代码上线。Prism 的迁移都是增量式的，因此在部署完成前，线上正在运行的 Worker 仍能正常使用新库结构。

确认提示之前会先列出待应用的迁移，方便你确认即将执行的内容。常用参数：

| 参数                | 作用                             |
| ------------------- | -------------------------------- |
| `--dry-run`         | 只打印将要执行的命令，不实际执行 |
| `-y`、`--yes`       | 跳过确认提示（用于 CI）          |
| `--migrations-only` | 只应用迁移，不部署               |
| `--skip-migrations` | 只部署，不改动数据库             |
| `--skip-build`      | 直接部署 `dist/` 中已有的产物    |

Cloudflare Workers Builds 在每次推送到 `main` 时执行同一套脚本：构建命令为 `bash scripts/build.sh`，部署命令为 `bash scripts/deploy.sh --skip-build --yes`，因此 CI 部署与本地部署一样会应用待处理的迁移。

`bun deploy` 仍然可用，它会跑 `tsc -b && vite build` 再执行 `wrangler deploy` — 但它**不会**应用迁移，使用它时请自行执行 `bun db:migrate:prod`。

部署与迁移是两条命令，没有任何机制让它们变成原子操作。因此，存储来自迁移的功能都按「能撑过这个空档」来编写：如果它的表还不存在，该功能会声明自己不可用，其他一切不受影响。[公告板](admin.md#公告板)是目前的例子 —— 公告板读取为空，**Admin → Notices** 返回 503 并写明需要执行的命令，而不是让缺失的表拖垮每一个渲染公告板的页面。

两种方式都会生成可直接部署的 `dist/prism/wrangler.json` — 生产部署必须使用它，否则 `wrangler deploy` 会重新打包源码并丢失 Vite 的 SSR 处理。提供的构建脚本会自动把生成的配置拷回原位。

## 9. 部署后：迁移密钥

如果你绑定了 `SECRETS_KEY`，请以管理员身份登录，进入 **Admin → Settings → Danger Zone** 并依次执行：

- **Migrate secrets to Secrets Store** — 加密历史 site_config 字段以及 OAuth 应用/源的 `client_secret`。
- **Migrate D1 secrets** — 把 bearer 类明文（PAT、OAuth token/code、邀请 token、邮箱验证码、二次验证码、单条备用码）替换为 HMAC-SHA256 哈希。

两者都是幂等的，重复执行安全。

## 非生产环境（staging 与 preview）

`wrangler.jsonc` 定义了两个非生产环境 —— `staging` 与 `preview`，每个都是独立的
Worker，拥有各自隔离的 D1 数据库与 KV 命名空间，因此测试永远不会触及生产数据。它们
与生产位于同一个 Cloudflare 账号，通过各自的 `*.workers.dev` 子域访问（不使用自定义
域名，且关闭了域名重新核验的定时任务）。

| 任务 | staging                  | preview                  |
| ---- | ------------------------ | ------------------------ |
| 开发 | `bun dev:staging`        | `bun dev:preview`        |
| 迁移 | `bun db:migrate:staging` | `bun db:migrate:preview` |
| 部署 | `bun deploy:staging`     | `bun deploy:preview`     |

环境在构建时通过 `CLOUDFLARE_ENV` 变量选择（`dev:*` / `deploy:*` 脚本会替你设置）。这
也是部署走生成的 `dist/prism/wrangler.json` 而非 `wrangler deploy --env <name>` 的原因
—— Vite 插件每次构建只解析一个环境，因此产出的配置本身就是环境专属的。与 `bun deploy`
一样，`deploy:*` 脚本**不会**自动执行迁移，请先运行对应的 `db:migrate:*`。

每个环境都有各自的 `SECRETS_KEY` —— 生产、staging、preview 分别指向三个不同的 Secret
Store 条目（`prism-secrets-key`、`prism-staging-secrets-key`、`prism-preview-secrets-key`，
都在同一个 store 中）。这样一来，某个一次性非生产环境的泄漏或失误，绝不会暴露由其他
环境密钥加密的数据。请为每个环境生成一把独立的 32 字节 base64url 密钥（见步骤 2），并在
`env` 块中通过 `secret_name` 引用它。

要从零搭建另一个非生产环境，先创建资源，并把 ID 填入 `wrangler.jsonc` 中新的 `env` 块：

```bash
wrangler d1 create prism-staging-db
wrangler kv namespace create prism-staging-sessions
wrangler kv namespace create prism-staging-cache
```

……然后在首次 `bun deploy:staging` 之前运行 `bun db:migrate:staging`。

## 社交登录配置

每个 provider 都需要先到对应平台创建 OAuth 应用。在 **Admin → OAuth Sources** 添加 OAuth 源 — 同一类型可以加多个，每个有独立 slug。详见 [社交登录配置](social-login.md)；回调 URL 的格式见 [OAuth / OIDC 指南](oauth.md)。

## 邮件配置

Prism 支持三种发送方式与两种接收方式，均在 **Admin → Settings → Email** 中配置。

| Provider     | `email_provider` 值 | 关键字段                    |
| ------------ | ------------------- | --------------------------- |
| Resend       | `resend`            | `email_api_key`（管理面板） |
| Mailchannels | `mailchannels`      | `email_api_key`（管理面板） |
| SMTP         | `smtp`              | 见管理面板                  |
| 关闭         | `none`              | —                           |

邮件用于邮箱验证、改密、通知。设置 `require_email_verification = false`（默认）允许用户在未验证邮箱时也登录。

入站邮件（用户主动发邮件验证）走 Cloudflare Email Workers，或把 `email_receive_provider` 设为 `imap` 并填入轮询邮箱。
