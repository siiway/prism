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
      text: 线上演示
      link: https://prism.siiway.org

features:
  - icon: 🔐
    title: OAuth 2.0 + OpenID Connect
    details: 完整的授权码流程（支持 PKCE）、OpenID Connect Discovery、令牌内省与撤销，以及符合 OIDC 规范的 UserInfo 端点。

  - icon: 🌐
    title: 社交登录
    details: 开箱即用支持 GitHub、Google、Microsoft 和 Discord 账号登录，用户可将多个提供商绑定至同一账号。

  - icon: 🛡️
    title: 多因素认证
    details: TOTP（RFC 6238）含备用码，以及 Passkeys（WebAuthn / FIDO2）无密码登录，两者可在同一账号共存。

  - icon: 🤖
    title: 机器人防护
    details: 支持 Cloudflare Turnstile、hCaptcha、reCAPTCHA v3，或由 Rust WASM 模块驱动的内置工作量证明——无需第三方服务。

  - icon: 🏗️
    title: 应用注册
    details: 用户可注册和管理自己的 OAuth 应用，自定义重定向 URI 和权限范围。管理员可验证应用，在授权页面展示信任徽章。

  - icon: ⚡
    title: 边缘原生
    details: 完全运行于 Cloudflare Workers，依托 D1（SQLite）、KV 和 R2。一条命令全球部署，无服务器、无容器、零运维。
---
