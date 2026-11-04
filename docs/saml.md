---
title: SAML
description: Sign people in to apps that use SAML 2.0, with Prism as the identity provider.
---

# SAML

Prism is a SAML 2.0 identity provider as well as an OAuth / OIDC provider.
Apps that only support SAML, as many SaaS tools do, can sign people in with
Prism.

## Setting up an app

1. Create an app under **Apps → New Application**, or open an existing one.
2. On the app's **SAML** tab, choose **Set up SAML** and fill in the service
   provider's side:
   - **Service provider entity ID**: what the app calls its Entity ID,
     Audience URI or SP Issuer.
   - **Assertion Consumer Service URLs**: where Prism posts the response, one
     per line. They must use https; http works only for `localhost`.
   - **NameID**: how the app identifies the user. Choose either an ID for
     this app, or the email address, which works only for accounts with a
     verified email. See [User IDs](#user-ids).
   - **Signature**: what Prism signs. Most apps want the assertion signed.
     Error responses are always signed.
   - **Single logout URL** (optional): the app's SingleLogoutService URL,
     and the binding its metadata lists for it. See
     [Single logout](#single-logout).
   - **Signing certificate** (optional, with single logout): the certificate
     the app signs its logout messages with, from its metadata, as PEM or
     base64. It must hold an RSA key, or an EC key on P-256, P-384 or P-521.
3. Give the app Prism's details from the same tab. Usually the metadata URL is
   enough:

| Setting                      | Value                                     |
| ---------------------------- | ----------------------------------------- |
| Metadata URL / IdP entity ID | `https://your-prism-domain/saml/metadata` |
| Single sign-on URL           | `https://your-prism-domain/saml/sso`      |
| Single logout URL            | `https://your-prism-domain/saml/slo`      |
| Signing certificate          | Download it from the SAML tab             |

The single sign-on and single logout URLs accept both the HTTP-Redirect and
the HTTP-POST binding.

## User IDs

The persistent NameID and the `uid` attribute carry the ID of the user's
SAML profile for the app, never their Prism user ID:

- By default, each app gets a new random ID for the user at their first
  sign-in, so apps can't match people across each other.
- Users can make shared profiles under **SAML profiles**. At their first
  sign-in to an app, they can choose one instead, and every app they choose
  it for gets the same ID. Apps that skip consent still ask this once.
- Either way, the app keeps that ID: it never changes, revoking the app
  included.

## Attributes

| Attribute          | Sent when                                                           |
| ------------------ | ------------------------------------------------------------------- |
| `uid`              | Always. The user's ID for this app, as in the NameID                |
| `username`, `name` | The app allows `profile`                                            |
| `email`            | The app allows `email` and the email is verified                    |
| `teams`            | The app allows `teams:read`. Team IDs                               |
| `groups`           | The app allows `teams:read`. Member groups, as `team-id:group-slug` |

Attribute names use the `basic` name format. Choose the app's scopes on its
**Permissions** tab. SAML sign-in ignores the app's other scopes, except
[other apps' permissions](app-permissions.md#app-b-with-saml): the app trades
the assertion for an access token with those.

## How sign-in works

- Sign-in starts at the app (SP-initiated). Prism doesn't send unsolicited
  responses (IdP-initiated sign-in).
- Responses go only to an ACS URL registered for the app, using the HTTP-POST
  binding. Prism doesn't check signatures on requests.
- Consent works as it does for OAuth. People approve an app the first time,
  and **Always authorize** skips the question afterwards. An **Always
  authorize** given at the app's OAuth sign-in also covers SAML, as long as it
  includes the scopes SAML releases. First-party apps never ask for consent.
  The app's [access whitelist](app-access-whitelist.md) applies, and the app
  appears under the user's connected apps.
- `ForceAuthn` makes the user sign in again. `IsPassive` gets a `NoPassive`
  response if the user would have to sign in, approve the app or choose its
  profile first.
- A request for a different NameID format than the one configured gets an
  `InvalidNameIDPolicy` response.

The certificate is self-signed and valid until 2049. It wraps the key that
also signs Prism's ID tokens.

## Single logout

Apps with a single logout URL are signed out together:

- Signing out of such an app signs the user out of Prism, then out of the
  other apps with single logout that they signed in to with SAML in the same
  browser session. Then the app gets its LogoutResponse.
- Without the app's signing certificate, Prism can't tell who sent a logout
  request, so any site could send one. Before one ends the Prism session,
  Prism asks the user. If they stay signed in, the app gets a
  `RequestDenied` response.
- With the app's signing certificate, its logout requests must be signed
  with it (RSA or ECDSA, with SHA-256 or stronger), carry a `Destination` of Prism's
  single logout URL, and be no more than 5 minutes old. Each request works
  once. Prism refuses any other request, and signs the user out without
  asking for one that passes.
  The app's logout responses must be signed too, or Prism counts the logout
  as not confirmed (`PartialLogout`).
- Signing out of Prism, from the account menu or through OIDC
  `end_session`, signs the user out of those apps before going on.
- The browser visits each app in turn. If an app doesn't answer, the app that
  started the logout is told it was partial (`PartialLogout`).
- A logout request for someone other than the user signed in to Prism signs
  nobody out, and gets an `UnknownPrincipal` response.
- Prism signs its logout messages: the XML with HTTP-POST, the query string
  with HTTP-Redirect.
- A session that ends without the browser, by expiring or being signed out
  from another device, doesn't reach the apps.

## Turning SAML off

Site admins decide which apps may use SAML:

- **Admin → Settings → Users & teams → SAML** sets the site default.
- A user's or team's admin page overrides it for the apps they own.
- An app's **Moderation** tab overrides both for that app.

Each override can follow the level above, allow SAML or stop it. While SAML
is stopped for an app, sign-in and single logout from it fail, it isn't sent
logout requests, and its owner can't change its SAML settings. The settings
are kept for when it's allowed again.
