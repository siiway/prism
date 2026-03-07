---
layout: home

hero:
  name: Prism
  text: Identity. Simplified.
  tagline: Self-hosted OAuth 2.0 / OpenID Connect platform on Cloudflare Workers. Zero servers, global edge.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: API Reference
      link: /api
    - theme: alt
      text: GitHub
      link: https://github.com/siiway/prism
    - theme: alt
      text: Production Demo
      link: https://prism.siiway.org

features:
  - icon: 🔐
    title: OAuth 2.0 + OpenID Connect
    details: Full authorization code flow with PKCE, OpenID Connect Discovery, token introspection and revocation, and an OpenID Connect–compliant UserInfo endpoint.

  - icon: 🌐
    title: Social Login
    details: Connect GitHub, Google, Microsoft, and Discord accounts out of the box. Users can link multiple providers to a single account.

  - icon: 🛡️
    title: Multi-Factor Auth
    details: TOTP (RFC 6238) with backup codes, and passkeys (WebAuthn / FIDO2) for passwordless login. Both can coexist on the same account.

  - icon: 🤖
    title: Bot Protection
    details: Choose from Cloudflare Turnstile, hCaptcha, reCAPTCHA v3, or a self-contained proof-of-work challenge powered by a Rust WASM module — no third-party service required.

  - icon: 🏗️
    title: App Registry
    details: Users register and manage their own OAuth applications with custom redirect URIs and scopes. Admins can verify apps to show a trust badge on the consent screen.

  - icon: ⚡
    title: Edge-Native
    details: Runs entirely on Cloudflare Workers backed by D1 (SQLite), KV, and R2. Deploy globally with a single command. No servers, no containers, no ops overhead.
---
