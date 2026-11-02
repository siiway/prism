---
layout: home

hero:
  name: Prism
  text: 身份认证，化繁为简。
  tagline: 基于 Cloudflare Workers 的自托管 OAuth 2.0 / OpenID Connect 平台。零服务器，全球边缘。
  actions:
    - theme: brand
      text: 快速开始
      link: /zh/getting-started
    - theme: alt
      text: API 文档
      link: /zh/api
    - theme: alt
      text: GitHub
      link: https://github.com/siiway/prism
    - theme: alt
      text: 公开实例
      link: https://prism.siiway.org

features:
  - icon: 🔐
    title: OAuth 2.0 + OpenID Connect
    details: 支持 PKCE 的授权码流程、OIDC Discovery、签名的 ID 令牌、令牌内省与撤销，以及 UserInfo。

  - icon: 🌐
    title: 社交与联邦登录
    details: GitHub、Google、Microsoft、Discord、Telegram、X 和 Cloudflare，还可通过 Generic OIDC 与 OAuth 2 来源接入任意其他提供商。也支持 GPG 登录。

  - icon: 🛡️
    title: 多因素与加强
    details: TOTP 认证器、Passkey、GPG 密钥，以及应用可在敏感操作前请求的加强 2FA。

  - icon: 👥
    title: 团队
    details: OAuth 应用与已验证域名的共享所有权，支持角色、邀请、子团队和加入门槛。

  - icon: 🤖
    title: 机器人防护
    details: Cloudflare Turnstile、hCaptcha、reCAPTCHA v3、GeeTest，或在 Prism 内运行、无需第三方服务的工作量证明 Cap。

  - icon: 🏗️
    title: 应用注册与跨应用 Scope
    details: 用户可注册自己的 OAuth 应用。应用可以发布权限范围，其他应用通过授权页面请求这些范围。

  - icon: 🔔
    title: 审计日志与通知
    details: 为每个用户、每个团队和平台提供审计日志，并支持 Webhook。应用事件流，以及带路由规则的邮件、Telegram 和 Discord 通知。

  - icon: 🪪
    title: 公开资料
    details: 可选启用的 `/u/<username>` 和 `/t/<team-id>` 页面，支持按字段控制可见性。

  - icon: 🔒
    title: 静态加密
    details: 机密数据加密存储，令牌以哈希形式存储，所用密钥保存在 Cloudflare Secrets Store 中。

  - icon: ⚡
    title: 边缘原生
    details: 运行于 Cloudflare Workers、D1 和 KV。一次部署即可全球上线。
---
