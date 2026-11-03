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
   - **NameID**: how the app identifies the user. Choose either the Prism user
     ID, which never changes, or the email address, which works only for
     accounts with a verified email.
   - **Signature**: what Prism signs. Most apps want the assertion signed.
3. Give the app Prism's details from the same tab. Usually the metadata URL is
   enough:

| Setting                      | Value                                     |
| ---------------------------- | ----------------------------------------- |
| Metadata URL / IdP entity ID | `https://your-prism-domain/saml/metadata` |
| Single sign-on URL           | `https://your-prism-domain/saml/sso`      |
| Signing certificate          | Download it from the SAML tab             |

The single sign-on URL accepts both the HTTP-Redirect and the HTTP-POST
binding.

## Attributes

| Attribute          | Sent when                                                           |
| ------------------ | ------------------------------------------------------------------- |
| `uid`              | Always. The Prism user ID                                           |
| `username`, `name` | The app allows `profile`                                            |
| `email`            | The app allows `email` and the email is verified                    |
| `teams`            | The app allows `teams:read`. Team IDs                               |
| `groups`           | The app allows `teams:read`. Member groups, as `team-id:group-slug` |

Attribute names use the `basic` name format. Choose the app's scopes on its
**Sign-in** tab.

## How sign-in works

- Sign-in starts at the app (SP-initiated). Prism doesn't send unsolicited
  responses (IdP-initiated sign-in).
- Responses go only to an ACS URL registered for the app, using the HTTP-POST
  binding. Prism doesn't check signatures on requests.
- Consent works as it does for OAuth. People approve an app the first time,
  and **Always authorize** skips the question afterwards. First-party apps
  never ask. The app's [access whitelist](app-access-whitelist.md) applies,
  and the app appears under the user's connected apps.
- `ForceAuthn` makes the user sign in again. `IsPassive` gets a `NoPassive`
  response if the user would have to sign in or approve the app first.
- A request for a different NameID format than the one configured gets an
  `InvalidNameIDPolicy` response.
- Single logout isn't supported.

The certificate is self-signed and valid until 2049. It wraps the key that
also signs Prism's ID tokens.
