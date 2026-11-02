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
      text: Public Instance
      link: https://prism.siiway.org

features:
  - icon: 🔐
    title: OAuth 2.0 + OpenID Connect
    details: Authorization code flow with PKCE, OIDC Discovery, signed ID tokens, token introspection and revocation, and UserInfo.

  - icon: 🌐
    title: Social & Federated Login
    details: GitHub, Google, Microsoft, Discord, Telegram, X and Cloudflare, plus Generic OIDC and OAuth 2 sources for any other provider. GPG sign-in too.

  - icon: 🛡️
    title: Multi-Factor & Step-Up
    details: TOTP authenticators, passkeys, GPG keys, and step-up 2FA that apps can request before sensitive actions.

  - icon: 👥
    title: Teams
    details: Shared ownership of OAuth apps and verified domains, with roles, invites, sub-teams and join requirements.

  - icon: 🤖
    title: Bot Protection
    details: Cloudflare Turnstile, hCaptcha, reCAPTCHA v3, GeeTest, or Cap, a proof-of-work that runs inside Prism with no third-party service.

  - icon: 🏗️
    title: App Registry & Cross-App Scopes
    details: Users register their own OAuth apps. Apps can publish permission scopes that other apps request through the consent screen.

  - icon: 🔔
    title: Audit Logs & Notifications
    details: Audit logs for each user, team and the platform, with webhooks. App event streams, and email, Telegram and Discord notifications with routing rules.

  - icon: 🪪
    title: Public Profiles
    details: Opt-in `/u/<username>` and `/t/<team-id>` pages with per-field visibility controls.

  - icon: 🔒
    title: Encrypted at Rest
    details: Secrets are encrypted and tokens are stored hashed, using a key held in a Cloudflare Secrets Store.

  - icon: ⚡
    title: Edge-Native
    details: Runs on Cloudflare Workers, D1 and KV. One deploy ships everything globally.
---
