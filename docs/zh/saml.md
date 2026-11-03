---
title: SAML
description: 让使用 SAML 2.0 的应用以 Prism 作为身份提供方完成登录。
---

# SAML

Prism 既是 SAML 2.0 身份提供方，也是 OAuth / OIDC 提供方。许多 SaaS 工具只支持
SAML，这类应用也可以借助 Prism 完成登录。

## 设置应用

1. 在 **我的应用 → 新建应用** 中创建应用，或打开已有应用。
2. 在应用的 **SAML** 标签页中，选择 **设置 SAML**，然后填写服务提供方一侧的信息：
   - **服务提供方实体 ID**：即应用所称的 Entity ID、Audience URI 或 SP Issuer。
   - **断言消费服务（ACS）URL**：Prism 向此处 POST 响应，每行一个。必须使用
     https；http 仅适用于 `localhost`。
   - **NameID**：应用用来标识用户的方式。可选择永不变化的 Prism 用户 ID，或邮箱地址
     （仅对已验证邮箱的账户有效）。
   - **签名**：Prism 签名的内容。大多数应用希望签名断言。错误响应始终签名。
3. 在同一标签页中，把 Prism 的信息提供给应用。通常只需元数据 URL：

| 设置                     | 值                                        |
| ------------------------ | ----------------------------------------- |
| 元数据 URL / IdP 实体 ID | `https://your-prism-domain/saml/metadata` |
| 单点登录 URL             | `https://your-prism-domain/saml/sso`      |
| 签名证书                 | 从 SAML 标签页下载                        |

单点登录 URL 同时支持 HTTP-Redirect 和 HTTP-POST 绑定。

## 属性

| 属性               | 发送条件                                                   |
| ------------------ | ---------------------------------------------------------- |
| `uid`              | 始终发送。Prism 用户 ID                                    |
| `username`、`name` | 应用允许 `profile`                                         |
| `email`            | 应用允许 `email` 且邮箱已验证                              |
| `teams`            | 应用允许 `teams:read`。团队 ID                             |
| `groups`           | 应用允许 `teams:read`。身份组，格式为 `team-id:group-slug` |

属性名称使用 `basic` 名称格式。在应用的 **登录** 标签页中选择应用的 scope。

## 登录流程

- 登录由应用发起（SP-initiated）。Prism 不发送未经请求的响应（IdP-initiated
  登录）。
- 响应只通过 HTTP-POST 绑定发送到为该应用注册的 ACS URL。Prism 不校验请求上的
  签名。
- 授权同意的流程与 OAuth 相同。用户首次使用时批准应用，之后 **始终授权** 即可跳过
  该询问。在应用的 OAuth 登录中选择的 **始终授权** 同样适用于 SAML，只要其中
  包含 SAML 发送的范围。第一方应用从不询问。应用的
  [访问白名单](app-access-whitelist.md) 依然生效，应用会出现在用户的已授权应用中。
- `ForceAuthn` 会要求用户重新登录。若用户需要先登录或批准应用，`IsPassive` 会得到
  一个 `NoPassive` 响应。
- 如果请求的 NameID 格式与配置的不同，将收到 `InvalidNameIDPolicy` 响应。
- 不支持单点登出。

该证书为自签名证书，有效期至 2049 年。它封装了同时用于签名 Prism ID token 的
密钥。
