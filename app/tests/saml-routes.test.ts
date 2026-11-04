// SAML IdP routes end to end: an SP's AuthnRequest, the sign-in page's API,
// and the signed Response; single logout; against a migrated database.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createPrivateKey, createPublicKey, createVerify } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { DOMParser } from "@xmldom/xmldom";
import { Hono } from "hono";
import { SignedXml } from "xml-crypto";
import adminRoutes from "../src/worker/routes/admin";
import appsRoutes from "../src/worker/routes/apps";
import authRoutes from "../src/worker/routes/auth";
import oauthRoutes from "../src/worker/routes/oauth";
import samlProfileRoutes from "../src/worker/routes/samlProfiles";
import { getRsaKeyPair } from "../src/worker/lib/config";
import { signIdTokenRS256, signJWT } from "../src/worker/lib/jwt";
import { samlApiRoutes, samlProtocolRoutes } from "../src/worker/routes/saml";
import { SAML_LOGOUT_COOKIE, SESSION_COOKIE } from "../src/worker/lib/cookies";
import { selfSignedCertificate, toPem } from "../src/worker/lib/saml/x509";
import { d1, executionCtx, migratedDatabase, MemoryKv } from "./setup/d1";
import type {
  AppSamlInfo,
  SamlPostback,
  SamlRequestInfo,
} from "../src/shared/api";

/** Any JSON body these routes return. */
type Body = SamlRequestInfo & SamlPostback & AppSamlInfo & { error: string };

const jwtSecret = "test-jwt-secret-saml";
const SP = "https://sp.example/metadata";
const ACS = "https://sp.example/acs";
const DSIG = "http://www.w3.org/2000/09/xmldsig#";

let sqlite: Database;
let env: Env;
let app: Hono;

beforeEach(() => {
  sqlite = migratedDatabase();
  env = {
    DB: d1(sqlite),
    APP_URL: "https://prism.example",
    KV_CACHE: new MemoryKv() as unknown as KVNamespace,
    KV_SESSIONS: new MemoryKv({
      "system:jwt_secret": jwtSecret,
    }) as unknown as KVNamespace,
  } as unknown as Env;
  app = new Hono();
  app.route("/saml", samlProtocolRoutes);
  app.route("/api/saml", samlApiRoutes);

  const now = Math.floor(Date.now() / 1000);
  sqlite.run(
    `INSERT INTO users (id, email, username, display_name, email_verified, created_at, updated_at)
     VALUES ('u1', 'alice@example.com', 'alice', 'Alice', 1, ?, ?)`,
    [now, now],
  );
  sqlite.run(
    `INSERT INTO oauth_apps (id, owner_id, name, description, client_id, client_secret, redirect_uris, allowed_scopes, created_at, updated_at)
     VALUES ('a1', 'u1', 'Wiki', '', 'client-1', 'secret', '[]', '["openid","profile","email"]', ?, ?)`,
    [now, now],
  );
  sqlite.run(
    `INSERT INTO saml_service_providers (app_id, entity_id, acs_urls, name_id_format, sign, created_at, updated_at)
     VALUES ('a1', ?, ?, 'persistent', 'assertion', ?, ?)`,
    [SP, JSON.stringify([ACS]), now, now],
  );
});

afterEach(() => sqlite.close());

const call = (path: string, init?: RequestInit) =>
  app.request(path, init, env, executionCtx);

async function sessionCookie(createdAt = Math.floor(Date.now() / 1000)) {
  sqlite.run(
    "INSERT OR REPLACE INTO sessions (id, user_id, token_hash, created_at, expires_at, amr) VALUES ('s1', 'u1', 'hash', ?, ?, '[\"pwd\"]')",
    [createdAt, createdAt + 3600],
  );
  const jwt = await signJWT(
    {
      sub: "u1",
      role: "user",
      sessionId: "s1",
      email: "alice@example.com",
      username: "alice",
      display_name: "Alice",
      avatar_url: null,
    },
    jwtSecret,
    3600,
  );
  return `${SESSION_COOKIE}=${jwt}`;
}

/** A fresh AuthnRequest ID per request: Prism refuses a repeated one. */
let requestCount = 0;
const nextRequestId = () => `_req${++requestCount}`;

function authnRequest(attrs = "", issuer = SP, id = nextRequestId()): string {
  const xml = `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="2026-11-02T10:00:00Z" ${attrs}><saml:Issuer>${issuer}</saml:Issuer></samlp:AuthnRequest>`;
  return encodeURIComponent(
    Buffer.from(deflateRawSync(xml)).toString("base64"),
  );
}

/** Send an AuthnRequest (redirect binding); returns the parked token. */
async function startSso(attrs = "", id?: string): Promise<string> {
  const res = await call(
    `/saml/sso?SAMLRequest=${authnRequest(attrs, SP, id)}&RelayState=back-to-page`,
  );
  expect(res.status).toBe(303);
  const location = new URL(res.headers.get("Location")!, "https://x");
  expect(location.pathname).toBe("/saml/authorize");
  return location.searchParams.get("request")!;
}

/** The stored ID of user u1 at an app, or null before their first sign-in
 *  to it. */
const subjectIdOrNull = (appId: string): string | null =>
  (
    sqlite
      .query(
        `SELECT p.name_id FROM saml_profile_apps b JOIN saml_profiles p ON p.id = b.profile_id
         WHERE b.app_id = ? AND b.user_id = 'u1'`,
      )
      .get(appId) as { name_id: string } | null
  )?.name_id ?? null;

/** The stored ID of user u1 at an app they've signed in to. */
const subjectId = (appId: string): string => subjectIdOrNull(appId)!;

const json = (body: unknown, cookie?: string): RequestInit => ({
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(cookie ? { Cookie: cookie } : {}),
  },
  body: JSON.stringify(body),
});

function parseResponse(samlResponse: string): Document {
  return new DOMParser().parseFromString(
    Buffer.from(samlResponse, "base64").toString("utf8"),
    "text/xml",
  ) as unknown as Document;
}

describe("SAML SSO", () => {
  test("each app gets its own ID for the user, the same every time", async () => {
    const OTHER = "https://other.example/metadata";
    const now = Math.floor(Date.now() / 1000);
    sqlite.run(
      `INSERT INTO oauth_apps (id, owner_id, name, description, client_id, client_secret, redirect_uris, allowed_scopes, created_at, updated_at)
       VALUES ('a3', 'u1', 'Other', '', 'client-3', 'secret', '[]', '[]', ?, ?)`,
      [now, now],
    );
    sqlite.run(
      `INSERT INTO saml_service_providers (app_id, entity_id, acs_urls, name_id_format, sign, created_at, updated_at)
       VALUES ('a3', ?, '["https://other.example/acs"]', 'persistent', 'assertion', ?, ?)`,
      [OTHER, now, now],
    );
    const cookie = await sessionCookie();
    const signIn = async (issuer: string) => {
      const res = await call(
        `/saml/sso?SAMLRequest=${authnRequest("", issuer)}`,
      );
      const token = new URL(
        res.headers.get("Location")!,
        "https://x",
      ).searchParams.get("request")!;
      const body = await (
        await call(
          `/api/saml/requests/${token}`,
          json({ action: "approve", authorization_mode: "once" }, cookie),
        )
      ).json<Body>();
      return parseResponse(body.saml_response).getElementsByTagNameNS(
        "*",
        "NameID",
      )[0].textContent!;
    };

    const wiki = await signIn(SP);
    expect(wiki).toBe(subjectId("a1"));
    expect(await signIn(SP)).toBe(wiki);
    const other = await signIn(OTHER);
    expect(other).toBe(subjectId("a3"));
    expect(other).not.toBe(wiki);
    expect([wiki, other]).not.toContain("u1");
  });

  test("revoking the app and allowing it again keeps the user's ID", async () => {
    app.route("/api/oauth", oauthRoutes);
    const cookie = await sessionCookie();
    const signIn = async () => {
      const token = await startSso();
      const body = await (
        await call(
          `/api/saml/requests/${token}`,
          json({ action: "approve", authorization_mode: "always" }, cookie),
        )
      ).json<Body>();
      return parseResponse(body.saml_response).getElementsByTagNameNS(
        "*",
        "NameID",
      )[0].textContent!;
    };

    const before = await signIn();
    const revoked = await call("/api/oauth/consents/client-1", {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(revoked.status).toBe(200);
    expect(
      sqlite.query("SELECT 1 FROM oauth_consents WHERE user_id = 'u1'").get(),
    ).toBeNull();
    // Asked again, as after any revocation; the app still knows them.
    expect(await signIn()).toBe(before);
  });

  test("refuses an unknown SP and an unregistered ACS URL", async () => {
    let res = await call(
      `/saml/sso?SAMLRequest=${authnRequest("", "https://other.example")}`,
    );
    expect(res.headers.get("Location")).toBe(
      "/saml/authorize?error=saml_unknown_sp",
    );
    res = await call(
      `/saml/sso?SAMLRequest=${authnRequest('AssertionConsumerServiceURL="https://evil.example/acs"')}`,
    );
    expect(res.headers.get("Location")).toBe(
      "/saml/authorize?error=saml_acs_mismatch",
    );
    res = await call(
      `/saml/sso?SAMLRequest=${authnRequest('ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Artifact"')}`,
    );
    expect(res.headers.get("Location")).toBe(
      "/saml/authorize?error=saml_binding_unsupported",
    );
    res = await call(
      `/saml/sso?SAMLRequest=${authnRequest('Destination="https://other-idp.example/sso"')}`,
    );
    expect(res.headers.get("Location")).toBe(
      "/saml/authorize?error=saml_request_invalid",
    );
    // Addressed to this IdP: accepted.
    await startSso('Destination="https://prism.example/saml/sso"');
  });

  test("the same AuthnRequest twice starts only one sign-in", async () => {
    await startSso("", "_dup");
    const res = await call(
      `/saml/sso?SAMLRequest=${authnRequest("", SP, "_dup")}&RelayState=back-to-page`,
    );
    expect(res.headers.get("Location")).toBe(
      "/saml/authorize?error=saml_request_used",
    );
  });

  test("refuses an oversized POST binding body before parsing it", async () => {
    const res = await call("/saml/sso", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `SAMLRequest=${"A".repeat(200 * 1024)}`,
    });
    expect(res.headers.get("Location")).toBe(
      "/saml/authorize?error=saml_request_invalid",
    );
  });

  test("accepts the POST binding", async () => {
    const xml = `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_post1" Version="2.0" IssueInstant="2026-11-02T10:00:00Z"><saml:Issuer>${SP}</saml:Issuer></samlp:AuthnRequest>`;
    const res = await call("/saml/sso", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        SAMLRequest: Buffer.from(xml).toString("base64"),
        RelayState: "rs",
      }).toString(),
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toStartWith("/saml/authorize?request=");
  });

  test("a blocked account can't approve, but can send a refusal", async () => {
    sqlite.run("UPDATE oauth_apps SET access_whitelist_enabled = 1");
    const token = await startSso();
    const cookie = await sessionCookie();
    const info = await (
      await call(`/api/saml/requests/${token}`, { headers: { Cookie: cookie } })
    ).json<Body>();
    expect(info.error).toBe("unauthorized_whitelist");
    const approve = await call(
      `/api/saml/requests/${token}`,
      json({ action: "approve" }, cookie),
    );
    expect(approve.status).toBe(403);
    const deny = await call(
      `/api/saml/requests/${token}`,
      json({ action: "deny" }, cookie),
    );
    expect(deny.status).toBe(200);
    const doc = parseResponse((await deny.json<Body>()).saml_response);
    const codes = Array.from(doc.getElementsByTagNameNS("*", "StatusCode")).map(
      (c) => c.getAttribute("Value"),
    );
    expect(codes[1]).toBe("urn:oasis:names:tc:SAML:2.0:status:RequestDenied");
  });

  test("asks a signed-out user to sign in", async () => {
    const token = await startSso();
    const res = await call(`/api/saml/requests/${token}`);
    expect((await res.json<Body>()).next).toBe("login");
  });

  test("consent, then a signed assertion for the registered ACS", async () => {
    const token = await startSso("", "_req42");
    const cookie = await sessionCookie();

    const info = await (
      await call(`/api/saml/requests/${token}`, { headers: { Cookie: cookie } })
    ).json<Body>();
    expect(info.next).toBe("consent");
    expect(info.scopes).toEqual(["profile", "email"]);

    const res = await call(
      `/api/saml/requests/${token}`,
      json({ action: "approve", authorization_mode: "once" }, cookie),
    );
    expect(res.status).toBe(200);
    const body = await res.json<Body>();
    expect(body.acs_url).toBe(ACS);
    expect(body.relay_state).toBe("back-to-page");

    const xml = Buffer.from(body.saml_response, "base64").toString("utf8");
    const doc = parseResponse(body.saml_response);
    expect(doc.documentElement.getAttribute("InResponseTo")).toBe("_req42");
    // The user's ID for this app, not the Prism user ID.
    const subject = subjectId("a1");
    expect(subject).toMatch(/^[0-9a-f]{32}$/);
    expect(doc.getElementsByTagNameNS("*", "NameID")[0].textContent).toBe(
      subject,
    );
    const attrs = Object.fromEntries(
      Array.from(doc.getElementsByTagNameNS("*", "Attribute")).map((a) => [
        a.getAttribute("Name"),
        a.getElementsByTagNameNS("*", "AttributeValue")[0].textContent,
      ]),
    );
    expect(attrs).toEqual({
      uid: subject,
      username: "alice",
      name: "Alice",
      email: "alice@example.com",
    });

    // The signature checks out against the certificate in the metadata.
    const metadata = await (await call("/saml/metadata")).text();
    const certB64 = new DOMParser()
      .parseFromString(metadata, "text/xml")
      .getElementsByTagNameNS(DSIG, "X509Certificate")[0].textContent!;
    const pem = `-----BEGIN CERTIFICATE-----\n${certB64}\n-----END CERTIFICATE-----`;
    const sig = doc.getElementsByTagNameNS(DSIG, "Signature")[0];
    expect((sig.parentNode as Element).localName).toBe("Assertion");
    const verifier = new SignedXml({ publicCert: pem });
    verifier.loadSignature(sig.toString());
    expect(verifier.checkSignature(xml)).toBe(true);

    const consent = sqlite
      .query(
        "SELECT scopes, auto_authorize FROM oauth_consents WHERE user_id = 'u1'",
      )
      .get() as { scopes: string; auto_authorize: number };
    expect(JSON.parse(consent.scopes)).toEqual(["profile", "email"]);
    expect(consent.auto_authorize).toBe(0);

    // One answer per request.
    const again = await call(
      `/api/saml/requests/${token}`,
      json({ action: "approve" }, cookie),
    );
    expect(again.status).toBe(404);
    expect((await again.json<Body>()).error).toBe("saml_request_expired");
  });

  test("a remembered consent goes straight on", async () => {
    sqlite.run(
      `INSERT INTO oauth_consents (id, user_id, client_id, scopes, granted_at, auto_authorize)
       VALUES ('c1', 'u1', 'client-1', '["profile","email"]', 0, 1)`,
    );
    const token = await startSso();
    const cookie = await sessionCookie();
    const info = await (
      await call(`/api/saml/requests/${token}`, { headers: { Cookie: cookie } })
    ).json<Body>();
    expect(info.next).toBe("continue");
  });

  test("an OAuth consent that covers SAML's scopes goes straight on", async () => {
    sqlite.run(
      `INSERT INTO oauth_consents (id, user_id, client_id, scopes, granted_at, auto_authorize)
       VALUES ('c1', 'u1', 'client-1', '["openid","profile","email"]', 0, 1)`,
    );
    const token = await startSso();
    const cookie = await sessionCookie();
    const info = await (
      await call(`/api/saml/requests/${token}`, { headers: { Cookie: cookie } })
    ).json<Body>();
    expect(info.next).toBe("continue");
  });

  test("approving adds to the shared consent and never forgets Always", async () => {
    const consent = () =>
      sqlite
        .query(
          "SELECT scopes, auto_authorize FROM oauth_consents WHERE user_id = 'u1'",
        )
        .get() as { scopes: string; auto_authorize: number };
    // Remembered for OAuth, but without email: SAML asks again.
    sqlite.run(
      `INSERT INTO oauth_consents (id, user_id, client_id, scopes, granted_at, auto_authorize)
       VALUES ('c1', 'u1', 'client-1', '["openid","profile"]', 0, 1)`,
    );
    const cookie = await sessionCookie();
    let token = await startSso();
    const info = await (
      await call(`/api/saml/requests/${token}`, { headers: { Cookie: cookie } })
    ).json<Body>();
    expect(info.next).toBe("consent");

    // Once: the remembered OAuth consent stays exactly as it was.
    await call(
      `/api/saml/requests/${token}`,
      json({ action: "approve", authorization_mode: "once" }, cookie),
    );
    expect(JSON.parse(consent().scopes)).toEqual(["openid", "profile"]);
    expect(consent().auto_authorize).toBe(1);

    // Always: SAML's scopes join OAuth's.
    token = await startSso();
    await call(
      `/api/saml/requests/${token}`,
      json({ action: "approve", authorization_mode: "always" }, cookie),
    );
    expect(JSON.parse(consent().scopes)).toEqual([
      "openid",
      "profile",
      "email",
    ]);
    expect(consent().auto_authorize).toBe(1);
  });

  test("assertions carry the account as it is now, not the session's copy", async () => {
    sqlite.run(
      `INSERT INTO oauth_consents (id, user_id, client_id, scopes, granted_at, auto_authorize)
       VALUES ('c1', 'u1', 'client-1', '["profile","email"]', 0, 1)`,
    );
    sqlite.run("UPDATE saml_service_providers SET name_id_format = 'email'");
    const cookie = await sessionCookie(); // minted with alice@example.com
    // Since then: a new primary email, and a name with a character XML forbids.
    sqlite.run(
      "UPDATE users SET email = 'alice@new.example', display_name = 'Ali\u0001ce'",
    );
    const token = await startSso();
    const res = await call(
      `/api/saml/requests/${token}`,
      json({ action: "approve" }, cookie),
    );
    expect(res.status).toBe(200);
    const samlResponse = (await res.json<Body>()).saml_response;
    expect(Buffer.from(samlResponse, "base64").toString("utf8")).not.toContain(
      "\u0001",
    );
    const doc = parseResponse(samlResponse);
    expect(doc.getElementsByTagNameNS("*", "NameID")[0].textContent).toBe(
      "alice@new.example",
    );
    const attrs = Object.fromEntries(
      Array.from(doc.getElementsByTagNameNS("*", "Attribute")).map((a) => [
        a.getAttribute("Name"),
        a.getElementsByTagNameNS("*", "AttributeValue")[0].textContent,
      ]),
    );
    expect(attrs.email).toBe("alice@new.example");
    expect(attrs.name).toBe("Alice");

    // An email that's no longer verified can't be the NameID.
    sqlite.run("UPDATE users SET email_verified = 0");
    const next = await startSso();
    const info = await (
      await call(`/api/saml/requests/${next}`, { headers: { Cookie: cookie } })
    ).json<Body>();
    expect(info.error).toBe("saml_email_unverified");
  });

  test("IsPassive without a session is declined with NoPassive", async () => {
    const token = await startSso('IsPassive="true"');
    const info = await (await call(`/api/saml/requests/${token}`)).json<Body>();
    expect(info.next).toBe("decline");
    // Approving isn't possible signed out; declining is.
    expect(
      (await call(`/api/saml/requests/${token}`, json({ action: "approve" })))
        .status,
    ).toBe(401);
    const res = await call(
      `/api/saml/requests/${token}`,
      json({ action: "decline" }),
    );
    const doc = parseResponse((await res.json<Body>()).saml_response);
    const codes = Array.from(doc.getElementsByTagNameNS("*", "StatusCode")).map(
      (c) => c.getAttribute("Value"),
    );
    expect(codes[1]).toBe("urn:oasis:names:tc:SAML:2.0:status:NoPassive");
    expect(doc.getElementsByTagNameNS("*", "Assertion").length).toBe(0);
  });

  test("ForceAuthn asks for a fresh sign-in", async () => {
    const token = await startSso('ForceAuthn="true"');
    const stale = await sessionCookie(Math.floor(Date.now() / 1000) - 600);
    const info = await (
      await call(`/api/saml/requests/${token}`, { headers: { Cookie: stale } })
    ).json<Body>();
    expect(info.next).toBe("reauth");
    // Approving is refused until the user has signed in again.
    const res = await call(
      `/api/saml/requests/${token}`,
      json({ action: "approve" }, stale),
    );
    expect(res.status).toBe(409);
  });

  test("ForceAuthn doesn't accept a session from the same second", async () => {
    const token = await startSso('ForceAuthn="true"');
    const { created_at } = sqlite
      .query("SELECT created_at FROM saml_requests")
      .get() as { created_at: number };
    const sameSecond = await sessionCookie(created_at);
    const info = await (
      await call(`/api/saml/requests/${token}`, {
        headers: { Cookie: sameSecond },
      })
    ).json<Body>();
    expect(info.next).toBe("reauth");
  });

  test("a NameID format other than the configured one is declined", async () => {
    // Persistent is configured; a request (POST binding) for email is refused.
    const xml = `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_req43" Version="2.0" IssueInstant="2026-11-02T10:00:00Z"><saml:Issuer>${SP}</saml:Issuer><samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"/></samlp:AuthnRequest>`;
    const res = await call("/saml/sso", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        SAMLRequest: Buffer.from(xml).toString("base64"),
      }).toString(),
    });
    expect(res.status).toBe(303);
    const token = new URL(
      res.headers.get("Location")!,
      "https://x",
    ).searchParams.get("request")!;
    const cookie = await sessionCookie();
    const info = await (
      await call(`/api/saml/requests/${token}`, {
        headers: { Cookie: cookie },
      })
    ).json<Body>();
    expect(info.next).toBe("decline");
  });
});

describe("app SAML settings", () => {
  const put = (body: unknown, cookie: string) =>
    call("/api/apps/a1/saml", { ...json(body, cookie), method: "PUT" });

  beforeEach(() => {
    app.route("/api/apps", appsRoutes);
  });

  test("validates, refuses a taken entity ID, and turns off", async () => {
    const cookie = await sessionCookie();
    const now = Math.floor(Date.now() / 1000);
    sqlite.run(
      `INSERT INTO oauth_apps (id, owner_id, name, description, client_id, client_secret, redirect_uris, allowed_scopes, created_at, updated_at)
       VALUES ('a2', 'u1', 'Other', '', 'client-2', 'secret', '[]', '[]', ?, ?)`,
      [now, now],
    );
    const valid = {
      entity_id: "urn:example:wiki",
      acs_urls: [ACS, "http://localhost:8080/acs"],
      name_id_format: "email",
      sign: "both",
    };

    let res = await put(
      { ...valid, acs_urls: ["http://sp.example/acs"] },
      cookie,
    );
    expect((await res.json<Body>()).error).toBe("saml_acs_url_invalid");
    res = await put({ ...valid, entity_id: "not a uri" }, cookie);
    expect((await res.json<Body>()).error).toBe("field_invalid");
    res = await put({ ...valid, sign: "none" }, cookie);
    expect((await res.json<Body>()).error).toBe("field_one_of");

    res = await put(valid, cookie);
    expect(res.status).toBe(200);
    expect((await res.json<Body>()).saml).toMatchObject(valid);

    res = await call("/api/apps/a2/saml", {
      ...json(valid, cookie),
      method: "PUT",
    });
    expect(res.status).toBe(409);
    expect((await res.json<Body>()).error).toBe("saml_entity_id_taken");

    const info = await (
      await call("/api/apps/a1/saml", { headers: { Cookie: cookie } })
    ).json<Body>();
    expect(info.idp.sso_url).toBe("https://prism.example/saml/sso");
    expect(info.idp.certificate).toStartWith("-----BEGIN CERTIFICATE-----");
    expect(info.released_scopes).toEqual(["profile", "email"]);

    res = await call("/api/apps/a1/saml", {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const after = await (
      await call("/api/apps/a1/saml", { headers: { Cookie: cookie } })
    ).json<Body>();
    expect(after.saml).toBeNull();
  });
});

describe("admin overrides", () => {
  const siteSaml = (on: boolean) =>
    sqlite.run(
      "INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES ('saml_enabled', ?, 0)",
      [JSON.stringify(on)],
    );
  const owner = (v: number | null) =>
    sqlite.run("UPDATE users SET saml_override = ? WHERE id = 'u1'", [v]);
  const appOverride = (v: number | null) =>
    sqlite.run("UPDATE oauth_apps SET saml_override = ? WHERE id = 'a1'", [v]);
  /** Where a fresh AuthnRequest ends up: a token, or an error code. */
  const outcome = async () => {
    const res = await call(
      `/saml/sso?SAMLRequest=${authnRequest()}&RelayState=back-to-page`,
    );
    const location = new URL(res.headers.get("Location")!, "https://x");
    return location.searchParams.get("error") ?? "ok";
  };

  beforeEach(() => {
    app.route("/api/apps", appsRoutes);
    app.route("/api/admin", adminRoutes);
  });

  test("the app's override beats the owner's, which beats the site's", async () => {
    expect(await outcome()).toBe("ok");
    siteSaml(false);
    expect(await outcome()).toBe("saml_disabled");
    owner(1);
    expect(await outcome()).toBe("ok");
    appOverride(0);
    expect(await outcome()).toBe("saml_disabled_app");

    siteSaml(true);
    appOverride(null);
    owner(0);
    expect(await outcome()).toBe("saml_disabled_user");
    appOverride(1);
    expect(await outcome()).toBe("ok");
    // The metadata never depends on it: some app may be allowed.
    siteSaml(false);
    expect((await call("/saml/metadata")).status).toBe(200);
  });

  test("a stop also blocks pending sign-ins and saving settings", async () => {
    const token = await startSso();
    appOverride(0);
    const pending = await call(`/api/saml/requests/${token}`);
    expect(pending.status).toBe(404);
    expect((await pending.json<Body>()).error).toBe("saml_disabled_app");

    const cookie = await sessionCookie();
    const info = await (
      await call("/api/apps/a1/saml", { headers: { Cookie: cookie } })
    ).json<Body>();
    expect(info.disabled).toBe("saml_disabled_app");
    expect(info.saml?.entity_id).toBe(SP); // kept
    const res = await call("/api/apps/a1/saml", {
      ...json(
        {
          entity_id: SP,
          acs_urls: [ACS],
          name_id_format: "persistent",
          sign: "assertion",
        },
        cookie,
      ),
      method: "PUT",
    });
    expect(res.status).toBe(403);
    expect((await res.json<Body>()).error).toBe("saml_disabled_app");
  });

  test("a team's override covers the apps it owns", async () => {
    sqlite.run(
      "INSERT INTO users (id, email, username, display_name, kind, created_at, updated_at) VALUES ('t1', 'team-t1@teams.invalid', 'team:t1', 'Team', 'team', 0, 0)",
    );
    sqlite.run("UPDATE oauth_apps SET owner_id = 't1'");
    sqlite.run("UPDATE users SET saml_override = 0 WHERE id = 't1'");
    expect(await outcome()).toBe("saml_disabled_user");
  });

  test("only site admins set overrides, and GET says what they follow", async () => {
    const cookie = await sessionCookie();
    const send = (path: string, method: string, body?: unknown) =>
      call(path, {
        ...(body === undefined
          ? { headers: { Cookie: cookie } }
          : json(body, cookie)),
        method,
      });

    expect(
      (await send("/api/admin/apps/a1/saml", "PATCH", { override: false }))
        .status,
    ).toBe(403);
    sqlite.run("UPDATE users SET role = 'admin'");
    expect(
      (await send("/api/admin/users/u1/saml", "PATCH", { override: "no" }))
        .status,
    ).toBe(400);

    // The owner is stopped; the app follows it until it's allowed itself.
    let res = await send("/api/admin/users/u1/saml", "PATCH", {
      override: false,
    });
    expect(await res.json()).toEqual({ override: false, inherited: true });
    res = await send("/api/admin/apps/a1/saml", "GET");
    expect(await res.json()).toEqual({ override: null, inherited: false });
    res = await send("/api/admin/apps/a1/saml", "PATCH", { override: true });
    expect(await res.json()).toEqual({ override: true, inherited: false });
    expect(await outcome()).toBe("ok");
    res = await send("/api/admin/apps/a1/saml", "PATCH", { override: null });
    expect(await res.json()).toEqual({ override: null, inherited: false });
    expect(await outcome()).toBe("saml_disabled_user");
  });
});

describe("single logout", () => {
  const SP2 = "https://crm.example/metadata";
  const SLO1 = "https://sp.example/slo";
  const SLO2 = "https://crm.example/slo";
  const SAMLP = "urn:oasis:names:tc:SAML:2.0:protocol";
  const STATUS = "urn:oasis:names:tc:SAML:2.0:status:";

  beforeEach(() => {
    app.route("/api/auth", authRoutes);
    const now = Math.floor(Date.now() / 1000);
    sqlite.run(
      "UPDATE saml_service_providers SET slo_url = ?, slo_binding = 'redirect' WHERE app_id = 'a1'",
      [SLO1],
    );
    sqlite.run(
      `INSERT INTO oauth_apps (id, owner_id, name, description, client_id, client_secret, redirect_uris, allowed_scopes, created_at, updated_at)
       VALUES ('a2', 'u1', 'CRM', '', 'client-2', 'secret', '[]', '[]', ?, ?)`,
      [now, now],
    );
    sqlite.run(
      `INSERT INTO saml_service_providers (app_id, entity_id, acs_urls, name_id_format, sign, slo_url, slo_binding, created_at, updated_at)
       VALUES ('a2', ?, '["https://crm.example/acs"]', 'persistent', 'assertion', ?, 'post', ?, ?)`,
      [SP2, SLO2, now, now],
    );
    // The user's per-app SAML profiles at the wiki and the CRM.
    sqlite.run(
      `INSERT INTO saml_profiles (id, user_id, name_id, app_id, name, created_at, updated_at)
       VALUES ('p-wiki', 'u1', 'wiki-u1', 'a1', NULL, 0, 0),
              ('p-crm', 'u1', 'crm-u1', 'a2', NULL, 0, 0)`,
    );
    sqlite.run(
      `INSERT INTO saml_profile_apps (app_id, user_id, profile_id, created_at)
       VALUES ('a1', 'u1', 'p-wiki', 0), ('a2', 'u1', 'p-crm', 0)`,
    );
  });

  /** Signed in to the CRM in session s1, as an SSO approval would record. */
  const crmSession = () =>
    sqlite.run(
      `INSERT INTO saml_sessions (session_id, app_id, name_id, name_id_format, session_index, created_at)
       VALUES ('s1', 'a2', 'crm-u1', 'persistent', '_crm-session', 1)`,
    );

  /** Sign in to the wiki (a1) through SSO in session s1. */
  async function wikiSignIn(cookie: string) {
    const token = await startSso();
    const res = await call(
      `/api/saml/requests/${token}`,
      json({ action: "approve", authorization_mode: "once" }, cookie),
    );
    expect(res.status).toBe(200);
    return res.json<Body>();
  }

  const deflate = (xml: string) =>
    encodeURIComponent(Buffer.from(deflateRawSync(xml)).toString("base64"));

  let logoutCount = 0;
  function logoutRequest(nameId: string, issuer = SP) {
    const id = `_logout${++logoutCount}`;
    const xml = `<samlp:LogoutRequest xmlns:samlp="${SAMLP}" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="2026-11-02T10:00:00Z" Destination="https://prism.example/saml/slo"><saml:Issuer>${issuer}</saml:Issuer><saml:NameID>${nameId}</saml:NameID></samlp:LogoutRequest>`;
    return { id, query: deflate(xml) };
  }

  /** An SP's LogoutResponse, posted to /saml/slo. */
  const answer = (xml: string) =>
    call("/saml/slo", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        SAMLResponse: Buffer.from(xml).toString("base64"),
      }).toString(),
    });

  const logoutResponse = (
    inResponseTo: string,
    issuer: string,
    status = "Success",
  ) =>
    `<samlp:LogoutResponse xmlns:samlp="${SAMLP}" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_resp${++logoutCount}" Version="2.0" IssueInstant="2026-11-02T10:00:00Z" InResponseTo="${inResponseTo}"><saml:Issuer>${issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="${STATUS}${status}"/></samlp:Status></samlp:LogoutResponse>`;

  /** The logout page's token, from a redirect to it. */
  function pageToken(res: Response): string {
    expect(res.status).toBe(303);
    const url = new URL(res.headers.get("Location")!, "https://x");
    expect(url.pathname).toBe("/logout");
    return url.searchParams.get("token")!;
  }

  /** The cookie a response binds a begun logout to this browser with. */
  function boundCookie(res: Response): string {
    const set = res.headers.get("Set-Cookie") ?? "";
    const match = new RegExp(`${SAML_LOGOUT_COOKIE}=([^;]+)`).exec(set);
    expect(match).not.toBeNull();
    return `${SAML_LOGOUT_COOKIE}=${match![1]}`;
  }

  type Step =
    | { kind: "confirm"; app: { name: string; icon_url: string | null } | null }
    | { kind: "redirect"; url: string }
    | { kind: "post"; url: string; fields: Record<string, string> };
  /** A step of the /logout page: `token` from its URL, or null for the
   *  logout the browser's cookie names. */
  const step = async (
    token: string | null,
    cookie?: string,
    action?: "confirm" | "cancel",
  ) => {
    const res = await call(
      "/api/saml/logout",
      json({ token: token ?? undefined, action }, cookie),
    );
    return {
      status: res.status,
      res,
      body: await res.json<Step & { error?: string }>(),
    };
  };

  async function metadataCert() {
    const metadata = await (await call("/saml/metadata")).text();
    const b64 = new DOMParser()
      .parseFromString(metadata, "text/xml")
      .getElementsByTagNameNS(DSIG, "X509Certificate")[0].textContent!;
    return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----`;
  }

  /** A redirect-binding message: its XML, after checking the query signature. */
  async function readRedirect(url: string, field: string) {
    const parsed = new URL(url);
    const raw = parsed.search.slice(1);
    const signed = raw.slice(0, raw.indexOf("&Signature="));
    expect(parsed.searchParams.get("SigAlg")).toBe(
      "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    );
    const ok = createVerify("RSA-SHA256")
      .update(signed)
      .verify(
        createPublicKey(await metadataCert()),
        parsed.searchParams.get("Signature")!,
        "base64",
      );
    expect(ok).toBe(true);
    const xml = inflateRawSync(
      Buffer.from(parsed.searchParams.get(field)!, "base64"),
    ).toString("utf8");
    return {
      doc: new DOMParser().parseFromString(
        xml,
        "text/xml",
      ) as unknown as Document,
      relayState: parsed.searchParams.get("RelayState"),
    };
  }

  const statusCodes = (doc: Document) =>
    Array.from(doc.getElementsByTagNameNS(SAMLP, "StatusCode")).map((e) =>
      e.getAttribute("Value")!.replace(STATUS, ""),
    );

  test("an SSO sign-in is remembered with its SessionIndex", async () => {
    const cookie = await sessionCookie();
    const body = await wikiSignIn(cookie);
    const index = parseResponse(body.saml_response)
      .getElementsByTagNameNS("*", "AuthnStatement")[0]
      .getAttribute("SessionIndex");
    const row = sqlite
      .query(
        "SELECT * FROM saml_sessions WHERE session_id = 's1' AND app_id = 'a1'",
      )
      .get() as { name_id: string; session_index: string };
    expect(row.name_id).toBe("wiki-u1");
    expect(row.session_index).toBe(index!);
    expect(index).not.toContain("s1");
  });

  test("an SP's logout visits the other SPs, then answers it", async () => {
    const cookie = await sessionCookie();
    await wikiSignIn(cookie);
    crmSession();

    const request = logoutRequest("wiki-u1");
    const token = pageToken(
      await call(`/saml/slo?SAMLRequest=${request.query}&RelayState=rs1`),
    );
    // Cross-site, the request had no cookie: nothing ends until the page.
    expect(
      sqlite.query("SELECT 1 FROM sessions WHERE id = 's1'").get(),
    ).not.toBeNull();

    // Anyone could have sent that request, so the page asks first, and
    // nothing has ended yet.
    const ask = await step(token, cookie);
    expect(ask.body).toEqual({
      kind: "confirm",
      app: { name: "Wiki", icon_url: null },
    });
    expect(
      sqlite.query("SELECT 1 FROM sessions WHERE id = 's1'").get(),
    ).not.toBeNull();

    // Confirmed, the page's same-site call ends the session and sends the
    // CRM a signed LogoutRequest by POST.
    const first = await step(token, cookie, "confirm");
    expect(first.status).toBe(200);
    expect(first.res.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(
      sqlite.query("SELECT 1 FROM sessions WHERE id = 's1'").get(),
    ).toBeNull();
    // From now on the logout is this browser's; the CRM never sees its token.
    const bound = boundCookie(first.res);
    if (first.body.kind !== "post") throw new Error("expected a POST");
    expect(first.body.url).toBe(SLO2);
    expect(first.body.fields.RelayState).toBeUndefined();
    const xml = Buffer.from(first.body.fields.SAMLRequest, "base64").toString(
      "utf8",
    );
    const doc = new DOMParser().parseFromString(
      xml,
      "text/xml",
    ) as unknown as Document;
    expect(doc.documentElement.localName).toBe("LogoutRequest");
    expect(doc.documentElement.getAttribute("Destination")).toBe(SLO2);
    expect(doc.getElementsByTagNameNS("*", "NameID")[0].textContent).toBe(
      "crm-u1",
    );
    expect(doc.getElementsByTagNameNS("*", "SessionIndex")[0].textContent).toBe(
      "_crm-session",
    );
    const verifier = new SignedXml({ publicCert: await metadataCert() });
    verifier.loadSignature(
      doc.getElementsByTagNameNS(DSIG, "Signature")[0].toString(),
    );
    expect(verifier.checkSignature(xml)).toBe(true);

    // The CRM answers; an answer to a request Prism never sent doesn't count.
    const requestId = doc.documentElement.getAttribute("ID")!;
    const stray = await answer(logoutResponse("_never-sent", SP2));
    expect(stray.headers.get("Location")).toBe(
      "/logout?error=saml_logout_expired",
    );
    const back = await answer(logoutResponse(requestId, SP2));
    expect(back.status).toBe(303);
    expect(back.headers.get("Location")).toBe("/logout");

    // Only this browser moves it on: not the token alone, nor with another
    // logout's cookie.
    expect((await step(token)).status).toBe(404);
    expect((await step(token, `${SAML_LOGOUT_COOKIE}=other`)).status).toBe(404);

    // Last, the wiki gets its LogoutResponse, signed in the query string.
    const last = await step(null, bound);
    expect(last.res.headers.get("Set-Cookie")).toContain(
      `${SAML_LOGOUT_COOKIE}=;`,
    );
    if (last.body.kind !== "redirect") throw new Error("expected a redirect");
    expect(last.body.url.startsWith(`${SLO1}?SAMLResponse=`)).toBe(true);
    const reply = await readRedirect(last.body.url, "SAMLResponse");
    expect(reply.relayState).toBe("rs1");
    expect(reply.doc.documentElement.getAttribute("InResponseTo")).toBe(
      request.id,
    );
    expect(statusCodes(reply.doc)).toEqual(["Success"]);

    // And that's the end of it.
    expect((await step(null, bound)).status).toBe(404);
  });

  test("an answer from the wrong Issuer leaves the SP unconfirmed and goes on", async () => {
    const cookie = await sessionCookie();
    crmSession();
    const token = pageToken(
      await call(`/saml/slo?SAMLRequest=${logoutRequest("wiki-u1").query}`),
    );
    await step(token, cookie);
    const first = await step(token, cookie, "confirm");
    if (first.body.kind !== "post") throw new Error("expected a POST");
    const sent = new DOMParser().parseFromString(
      Buffer.from(first.body.fields.SAMLRequest, "base64").toString("utf8"),
      "text/xml",
    ) as unknown as Document;
    const requestId = sent.documentElement.getAttribute("ID")!;
    // Answered under the wiki's name instead of the CRM's.
    const back = await answer(logoutResponse(requestId, SP));
    expect(back.headers.get("Location")).toBe("/logout");
    const last = await step(null, boundCookie(first.res));
    if (last.body.kind !== "redirect") throw new Error("expected a redirect");
    const reply = await readRedirect(last.body.url, "SAMLResponse");
    expect(statusCodes(reply.doc)).toEqual(["Success", "PartialLogout"]);
  });

  test("an SP that never answers makes it a partial logout", async () => {
    const cookie = await sessionCookie();
    crmSession();
    const request = logoutRequest("wiki-u1");
    const token = pageToken(
      await call(`/saml/slo?SAMLRequest=${request.query}`),
    );
    expect((await step(token, cookie)).body.kind).toBe("confirm");
    const first = await step(token, cookie, "confirm");
    expect(first.body.kind).toBe("post");
    // Back on the page without the CRM's answer.
    const last = await step(null, boundCookie(first.res));
    if (last.body.kind !== "redirect") throw new Error("expected a redirect");
    const reply = await readRedirect(last.body.url, "SAMLResponse");
    expect(reply.relayState).toBeNull();
    expect(statusCodes(reply.doc)).toEqual(["Success", "PartialLogout"]);
  });

  test("a logout for someone else ends nothing", async () => {
    const cookie = await sessionCookie();
    crmSession();
    // Another user; the user's Prism ID, which no app knows them by; and
    // their ID at a different app (the CRM's, sent by the wiki).
    for (const nameId of ["u2", "u1", "crm-u1"]) {
      const token = pageToken(
        await call(`/saml/slo?SAMLRequest=${logoutRequest(nameId).query}`),
      );
      const last = await step(token, cookie);
      expect(last.res.headers.get("Set-Cookie")).toBeNull();
      expect(
        sqlite.query("SELECT 1 FROM sessions WHERE id = 's1'").get(),
      ).not.toBeNull();
      if (last.body.kind !== "redirect") throw new Error("expected a redirect");
      const reply = await readRedirect(last.body.url, "SAMLResponse");
      expect(statusCodes(reply.doc)).toEqual(["Requester", "UnknownPrincipal"]);
    }
  });

  test("staying signed in tells the SP no", async () => {
    const cookie = await sessionCookie();
    crmSession();
    const token = pageToken(
      await call(`/saml/slo?SAMLRequest=${logoutRequest("wiki-u1").query}`),
    );
    expect((await step(token, cookie)).body.kind).toBe("confirm");
    const last = await step(token, cookie, "cancel");
    expect(last.res.headers.get("Set-Cookie")).toBeNull();
    expect(
      sqlite.query("SELECT 1 FROM sessions WHERE id = 's1'").get(),
    ).not.toBeNull();
    if (last.body.kind !== "redirect") throw new Error("expected a redirect");
    // Straight back to the wiki: the CRM wasn't visited.
    expect(last.body.url.startsWith(`${SLO1}?`)).toBe(true);
    const reply = await readRedirect(last.body.url, "SAMLResponse");
    expect(statusCodes(reply.doc)).toEqual(["Responder", "RequestDenied"]);
  });

  test("nobody signed in: answered without asking", async () => {
    const token = pageToken(
      await call(`/saml/slo?SAMLRequest=${logoutRequest("wiki-u1").query}`),
    );
    const last = await step(token);
    if (last.body.kind !== "redirect") throw new Error("expected a redirect");
    const reply = await readRedirect(last.body.url, "SAMLResponse");
    expect(statusCodes(reply.doc)).toEqual(["Success"]);
  });

  test("signing out of Prism visits the session's SPs, then goes on", async () => {
    const cookie = await sessionCookie();
    await wikiSignIn(cookie);
    const out = await call("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(await out.json()).toEqual({ ok: true, next: "/logout" });
    const bound = boundCookie(out);
    // Nobody else can move it on.
    expect((await step(null)).status).toBe(404);

    const first = await step(null, bound);
    if (first.body.kind !== "redirect") throw new Error("expected a redirect");
    const sent = await readRedirect(first.body.url, "SAMLRequest");
    expect(sent.relayState).toBeNull();
    const id = sent.doc.documentElement.getAttribute("ID")!;
    const back = await call(
      `/saml/slo?SAMLResponse=${deflate(logoutResponse(id, SP))}`,
    );
    expect(back.headers.get("Location")).toBe("/logout");
    expect((await step(null, bound)).body).toEqual({
      kind: "redirect",
      url: "/login",
    });
  });

  test("no SP to tell: signing out goes straight on", async () => {
    const cookie = await sessionCookie();
    const out = await call("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(await out.json()).toEqual({ ok: true, next: "/login" });
  });

  test("refuses SPs without a single logout URL, and unknown logouts", async () => {
    sqlite.run(
      "UPDATE saml_service_providers SET slo_url = NULL WHERE app_id = 'a1'",
    );
    let res = await call(
      `/saml/slo?SAMLRequest=${logoutRequest("wiki-u1").query}`,
    );
    expect(res.headers.get("Location")).toBe(
      "/logout?error=saml_slo_not_configured",
    );
    res = await call(
      `/saml/slo?SAMLResponse=${deflate(logoutResponse("_x", SP2))}`,
    );
    expect(res.headers.get("Location")).toBe(
      "/logout?error=saml_logout_expired",
    );
    expect((await step("nope")).status).toBe(404);
  });

  test("an app whose SAML is stopped can't sign anyone out, and isn't told", async () => {
    const cookie = await sessionCookie();
    crmSession();
    sqlite.run("UPDATE oauth_apps SET saml_override = 0 WHERE id = 'a1'");
    const res = await call(
      `/saml/slo?SAMLRequest=${logoutRequest("wiki-u1").query}`,
    );
    expect(res.headers.get("Location")).toBe("/logout?error=saml_disabled_app");
    // Signing out of Prism visits the CRM only; with it stopped too, none.
    sqlite.run(
      "INSERT OR REPLACE INTO saml_sessions (session_id, app_id, name_id, name_id_format, session_index, created_at) VALUES ('s1', 'a1', 'wiki-u1', 'persistent', '_wiki', 0)",
    );
    sqlite.run("UPDATE oauth_apps SET saml_override = 0 WHERE id = 'a2'");
    const out = await call("/api/auth/logout", json({}, cookie));
    expect(await out.json()).toEqual({ ok: true, next: "/login" });
  });

  test("the confirm step takes JSON only", async () => {
    const cookie = await sessionCookie();
    const token = pageToken(
      await call(`/saml/slo?SAMLRequest=${logoutRequest("wiki-u1").query}`),
    );
    const res = await call("/api/saml/logout", {
      method: "POST",
      headers: { "Content-Type": "text/plain", Cookie: cookie },
      body: JSON.stringify({ token, action: "confirm" }),
    });
    expect(res.status).toBe(403);
    expect(
      sqlite.query("SELECT 1 FROM sessions WHERE id = 's1'").get(),
    ).not.toBeNull();
  });

  describe("with the SP's signing certificate on file", () => {
    let spKey: CryptoKey;
    let spKeyPem: string;

    beforeEach(async () => {
      const keys = (await crypto.subtle.generateKey(
        {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        true,
        ["sign", "verify"],
      )) as CryptoKeyPair;
      spKey = keys.privateKey;
      spKeyPem = createPrivateKey({
        key: Buffer.from(
          await crypto.subtle.exportKey("pkcs8", keys.privateKey),
        ),
        format: "der",
        type: "pkcs8",
      })
        .export({ format: "pem", type: "pkcs8" })
        .toString();
      const cert = await selfSignedCertificate(
        keys.publicKey,
        keys.privateKey,
        "sp.example",
      );
      sqlite.run(
        "UPDATE saml_service_providers SET signing_cert = ? WHERE app_id = 'a1'",
        [Buffer.from(cert).toString("base64")],
      );
    });

    const iso = (seconds: number) =>
      new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

    function freshRequest(nameId = "wiki-u1", issuedAgo = 0) {
      const id = `_signed${++logoutCount}`;
      const now = Math.floor(Date.now() / 1000) - issuedAgo;
      return {
        id,
        xml: `<samlp:LogoutRequest xmlns:samlp="${SAMLP}" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${iso(now)}" Destination="https://prism.example/saml/slo"><saml:Issuer>${SP}</saml:Issuer><saml:NameID>${nameId}</saml:NameID></samlp:LogoutRequest>`,
      };
    }

    /** The HTTP-Redirect binding, its query string signed with the key. */
    async function redirectQuery(
      field: "SAMLRequest" | "SAMLResponse",
      xml: string,
      key = spKey,
    ) {
      const signed = `${field}=${deflate(xml)}&RelayState=rs1&SigAlg=${encodeURIComponent("http://www.w3.org/2001/04/xmldsig-more#rsa-sha256")}`;
      const signature = Buffer.from(
        await crypto.subtle.sign(
          "RSASSA-PKCS1-v1_5",
          key,
          new TextEncoder().encode(signed),
        ),
      ).toString("base64");
      return `${signed}&Signature=${encodeURIComponent(signature)}`;
    }

    /** An enveloped XML signature, the HTTP-POST binding's. */
    function signXml(xml: string) {
      const sig = new SignedXml({
        privateKey: spKeyPem,
        canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
        signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
      });
      sig.addReference({
        xpath: "/*",
        digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
        transforms: [
          "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
          "http://www.w3.org/2001/10/xml-exc-c14n#",
        ],
      });
      sig.computeSignature(xml, {
        location: {
          reference: "/*/*[local-name()='Issuer']",
          action: "after",
        },
      });
      return sig.getSignedXml();
    }

    const postSlo = (field: string, xml: string) =>
      call("/saml/slo", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          [field]: Buffer.from(xml).toString("base64"),
        }).toString(),
      });

    const sessionAlive = () =>
      sqlite.query("SELECT 1 FROM sessions WHERE id = 's1'").get() !== null;

    test("an unsigned, stale or wrongly signed request is refused", async () => {
      const refused = "/logout?error=saml_signature_invalid";
      let res = await call(
        `/saml/slo?SAMLRequest=${deflate(freshRequest().xml)}`,
      );
      expect(res.headers.get("Location")).toBe(refused);

      res = await call(
        `/saml/slo?${await redirectQuery("SAMLRequest", freshRequest("wiki-u1", 3600).xml)}`,
      );
      expect(res.headers.get("Location")).toBe(refused);

      const other = (await crypto.subtle.generateKey(
        {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        false,
        ["sign", "verify"],
      )) as CryptoKeyPair;
      res = await call(
        `/saml/slo?${await redirectQuery("SAMLRequest", freshRequest().xml, other.privateKey)}`,
      );
      expect(res.headers.get("Location")).toBe(refused);

      // Signed, but its NameID changed afterwards.
      res = await postSlo(
        "SAMLRequest",
        signXml(freshRequest().xml).replace(">wiki-u1<", ">u2<"),
      );
      expect(res.headers.get("Location")).toBe(refused);
    });

    test("a signed request (Redirect) signs out without asking", async () => {
      const cookie = await sessionCookie();
      const request = freshRequest();
      const token = pageToken(
        await call(
          `/saml/slo?${await redirectQuery("SAMLRequest", request.xml)}`,
        ),
      );
      const done = await step(token, cookie);
      expect(sessionAlive()).toBe(false);
      if (done.body.kind !== "redirect") throw new Error("expected a redirect");
      const reply = await readRedirect(done.body.url, "SAMLResponse");
      expect(reply.relayState).toBe("rs1");
      expect(reply.doc.documentElement.getAttribute("InResponseTo")).toBe(
        request.id,
      );
      expect(statusCodes(reply.doc)).toEqual(["Success"]);
    });

    test("a signed request works once", async () => {
      const query = await redirectQuery("SAMLRequest", freshRequest().xml);
      const first = await call(`/saml/slo?${query}`);
      expect(first.headers.get("Location")).toStartWith("/logout?token=");
      const again = await call(`/saml/slo?${query}`);
      expect(again.headers.get("Location")).toBe(
        "/logout?error=saml_logout_used",
      );
    });

    test("a signed request (POST) signs out without asking, but only its user", async () => {
      const cookie = await sessionCookie();
      // Someone else: nothing ends.
      let token = pageToken(
        await postSlo("SAMLRequest", signXml(freshRequest("u2").xml)),
      );
      let done = await step(token, cookie);
      expect(sessionAlive()).toBe(true);
      if (done.body.kind !== "redirect") throw new Error("expected a redirect");
      expect(
        statusCodes((await readRedirect(done.body.url, "SAMLResponse")).doc),
      ).toEqual(["Requester", "UnknownPrincipal"]);

      token = pageToken(
        await postSlo("SAMLRequest", signXml(freshRequest().xml)),
      );
      done = await step(token, cookie);
      expect(done.body.kind).toBe("redirect");
      expect(sessionAlive()).toBe(false);
    });

    test("only a signed answer confirms the SP signed out", async () => {
      // The CRM (no certificate) starts it; the wiki has one.
      const cookie = await sessionCookie();
      await wikiSignIn(cookie);
      const run = async (
        answer: (id: string) => Response | Promise<Response>,
      ) => {
        const token = pageToken(
          await call(
            `/saml/slo?SAMLRequest=${logoutRequest("crm-u1", SP2).query}`,
          ),
        );
        expect((await step(token, cookie)).body.kind).toBe("confirm");
        const first = await step(token, cookie, "confirm");
        if (first.body.kind !== "redirect")
          throw new Error("expected a redirect");
        const sent = await readRedirect(first.body.url, "SAMLRequest");
        const id = sent.doc.documentElement.getAttribute("ID")!;
        expect((await answer(id)).headers.get("Location")).toBe("/logout");
        const last = await step(null, boundCookie(first.res));
        if (last.body.kind !== "post") throw new Error("expected a POST");
        const xml = Buffer.from(
          last.body.fields.SAMLResponse,
          "base64",
        ).toString("utf8");
        return statusCodes(
          new DOMParser().parseFromString(
            xml,
            "text/xml",
          ) as unknown as Document,
        );
      };
      const response = (id: string) =>
        `<samlp:LogoutResponse xmlns:samlp="${SAMLP}" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_resp${++logoutCount}" Version="2.0" IssueInstant="${iso(Math.floor(Date.now() / 1000))}" Destination="https://prism.example/saml/slo" InResponseTo="${id}"><saml:Issuer>${SP}</saml:Issuer><samlp:Status><samlp:StatusCode Value="${STATUS}Success"/></samlp:Status></samlp:LogoutResponse>`;

      // Unsigned: counted as not confirmed.
      expect(
        await run((id) =>
          call(`/saml/slo?SAMLResponse=${deflate(response(id))}`),
        ),
      ).toEqual(["Success", "PartialLogout"]);

      // Signed: confirmed.
      await sessionCookie();
      await wikiSignIn(cookie);
      expect(
        await run(async (id) =>
          call(
            `/saml/slo?${await redirectQuery("SAMLResponse", response(id))}`,
          ),
        ),
      ).toEqual(["Success"]);
    });
  });
});

describe("SAML profiles", () => {
  const OTHER = "https://other.example/metadata";

  beforeEach(() => {
    app.route("/api/saml/profiles", samlProfileRoutes);
    const now = Math.floor(Date.now() / 1000);
    sqlite.run(
      `INSERT INTO oauth_apps (id, owner_id, name, description, client_id, client_secret, redirect_uris, allowed_scopes, created_at, updated_at)
       VALUES ('a3', 'u1', 'Other', '', 'client-3', 'secret', '[]', '[]', ?, ?)`,
      [now, now],
    );
    sqlite.run(
      `INSERT INTO saml_service_providers (app_id, entity_id, acs_urls, name_id_format, sign, created_at, updated_at)
       VALUES ('a3', ?, '["https://other.example/acs"]', 'persistent', 'assertion', ?, ?)`,
      [OTHER, now, now],
    );
    sqlite.run(
      `INSERT INTO users (id, email, username, display_name, email_verified, created_at, updated_at)
       VALUES ('u2', 'bob@example.com', 'bob', 'Bob', 1, ?, ?)`,
      [now, now],
    );
  });

  type Profile = {
    id: string;
    kind: "app" | "shared";
    name: string | null;
    name_id: string;
    apps: { id: string; name: string }[];
  };

  const profilesApi = (
    cookie: string,
    method: string,
    path = "",
    body?: unknown,
  ) =>
    call(`/api/saml/profiles${path}`, {
      method,
      headers: {
        Cookie: cookie,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  async function createShared(cookie: string, name: string) {
    const res = await profilesApi(cookie, "POST", "", { name });
    expect(res.status).toBe(201);
    return (await res.json<{ profile: Profile }>()).profile;
  }

  /** Start a sign-in to the SP with `issuer`; the parked request's token. */
  async function start(issuer: string, attrs = "") {
    const res = await call(
      `/saml/sso?SAMLRequest=${authnRequest(attrs, issuer)}`,
    );
    return new URL(res.headers.get("Location")!, "https://x").searchParams.get(
      "request",
    )!;
  }

  const info = async (token: string, cookie: string) =>
    (
      await call(`/api/saml/requests/${token}`, { headers: { Cookie: cookie } })
    ).json<
      Body & {
        profile: { kind: string; name: string | null } | null;
        profile_choices: { id: string; name: string; name_id: string }[];
      }
    >();

  /** Approve; the NameID and uid the app receives. */
  async function approve(token: string, cookie: string, profile?: string) {
    const res = await call(
      `/api/saml/requests/${token}`,
      json({ action: "approve", authorization_mode: "once", profile }, cookie),
    );
    expect(res.status).toBe(200);
    const doc = parseResponse((await res.json<Body>()).saml_response);
    const uid = Array.from(doc.getElementsByTagNameNS("*", "Attribute"))
      .find((a) => a.getAttribute("Name") === "uid")!
      .getElementsByTagNameNS("*", "AttributeValue")[0].textContent;
    const nameId = doc.getElementsByTagNameNS("*", "NameID")[0].textContent!;
    expect(uid).toBe(nameId);
    return nameId;
  }

  test("a first sign-in offers the shared profiles; the app keeps the one chosen", async () => {
    const cookie = await sessionCookie();
    const work = await createShared(cookie, "Work");
    expect(work.kind).toBe("shared");
    expect(work.name_id).toMatch(/^[0-9a-f]{32}$/);

    let token = await start(SP);
    let state = await info(token, cookie);
    expect(state.next).toBe("consent");
    expect(state.profile).toBeNull();
    expect(state.profile_choices).toEqual([
      { id: work.id, kind: "shared", name: "Work", name_id: work.name_id },
    ]);
    expect(await approve(token, cookie, work.id)).toBe(work.name_id);

    // Chosen once: no question, and a different choice changes nothing.
    token = await start(SP);
    state = await info(token, cookie);
    expect(state.profile).toMatchObject({ kind: "shared", name: "Work" });
    expect(state.profile_choices).toEqual([]);
    expect(await approve(token, cookie, "new")).toBe(work.name_id);

    // Another app the user picks it for sees the same ID; one they don't,
    // its own.
    expect(await approve(await start(OTHER), cookie, work.id)).toBe(
      work.name_id,
    );
    sqlite.run("DELETE FROM saml_profile_apps WHERE app_id = 'a3'");
    const own = await approve(await start(OTHER), cookie, "new");
    expect(own).not.toBe(work.name_id);
  });

  test("first-party apps ask only when there's a profile to pick", async () => {
    sqlite.run("UPDATE oauth_apps SET is_first_party = 1");
    const cookie = await sessionCookie();
    expect((await info(await start(SP), cookie)).next).toBe("continue");

    const work = await createShared(cookie, "Work");
    sqlite.run("DELETE FROM saml_profile_apps");
    // Only the profile is asked for: choosing one stores no consent.
    const token = await start(SP);
    expect((await info(token, cookie)).next).toBe("profile");
    expect(await approve(token, cookie, work.id)).toBe(work.name_id);
    expect(
      sqlite.query("SELECT COUNT(*) AS n FROM oauth_consents").get(),
    ).toEqual({ n: 0 });
  });

  test("a passive request never chooses the profile for the user", async () => {
    sqlite.run("UPDATE oauth_apps SET is_first_party = 1");
    const cookie = await sessionCookie();
    const work = await createShared(cookie, "Work");
    const bound = () =>
      sqlite.query("SELECT COUNT(*) AS n FROM saml_profile_apps").get();

    // With a profile to pick, IsPassive gets NoPassive and binds nothing.
    let token = await start(SP, 'IsPassive="true"');
    expect((await info(token, cookie)).next).toBe("decline");
    const res = await call(
      `/api/saml/requests/${token}`,
      json({ action: "approve", profile: work.id }, cookie),
    );
    expect(res.status).toBe(409);
    expect(bound()).toEqual({ n: 0 });

    // The next interactive sign-in still asks.
    token = await start(SP);
    expect((await info(token, cookie)).next).toBe("profile");

    // Nothing to pick: IsPassive goes on, with a new per-app profile.
    expect((await profilesApi(cookie, "DELETE", `/${work.id}`)).status).toBe(
      200,
    );
    token = await start(SP, 'IsPassive="true"');
    expect((await info(token, cookie)).next).toBe("continue");
    const nameId = await approve(token, cookie);
    const { profiles } = await (
      await profilesApi(cookie, "GET")
    ).json<{
      profiles: Profile[];
    }>();
    expect(profiles.find((p) => p.name_id === nameId)?.kind).toBe("app");
  });

  test("an app the user always authorizes asks only for the profile", async () => {
    const cookie = await sessionCookie();
    const work = await createShared(cookie, "Work");
    sqlite.run(
      `INSERT INTO oauth_consents (id, user_id, client_id, scopes, granted_at, auto_authorize)
       VALUES ('c1', 'u1', 'client-1', '["profile","email"]', 0, 1)`,
    );
    const token = await start(SP);
    expect((await info(token, cookie)).next).toBe("profile");
    expect(await approve(token, cookie, work.id)).toBe(work.name_id);
    // The remembered consent is left as it was.
    expect(
      sqlite
        .query("SELECT scopes, auto_authorize, granted_at FROM oauth_consents")
        .all(),
    ).toEqual([
      { scopes: '["profile","email"]', auto_authorize: 1, granted_at: 0 },
    ]);
  });

  test("only the user's own shared profiles can be chosen", async () => {
    const cookie = await sessionCookie();
    sqlite.run(
      `INSERT INTO saml_profiles (id, user_id, name_id, app_id, name, created_at, updated_at)
       VALUES ('p-bob', 'u2', 'bob-id', NULL, 'Bob''s', 0, 0),
              ('p-own-app', 'u1', 'own-app-id', 'a3', NULL, 0, 0)`,
    );
    for (const profile of ["p-bob", "p-own-app", "nope"]) {
      const res = await call(
        `/api/saml/requests/${await start(SP)}`,
        json({ action: "approve", profile }, cookie),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "field_invalid",
        params: { field: "profile" },
      });
    }
    expect(subjectIdOrNull("a1")).toBeNull();
  });

  test("a shared profile deleted after the page loaded can't be chosen", async () => {
    const cookie = await sessionCookie();
    const gone = await createShared(cookie, "Gone");
    const token = await start(SP);
    expect((await info(token, cookie)).profile_choices).toHaveLength(1);
    expect((await profilesApi(cookie, "DELETE", `/${gone.id}`)).status).toBe(
      200,
    );
    const res = await call(
      `/api/saml/requests/${token}`,
      json({ action: "approve", profile: gone.id }, cookie),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "field_invalid",
      params: { field: "profile" },
    });
    // The request is still open: the user can choose again.
    expect(await approve(token, cookie, "new")).not.toBe(gone.name_id);
  });

  test("a per-app profile can become shared, keeping its ID", async () => {
    const cookie = await sessionCookie();
    const wikiId = await approve(await start(SP), cookie);
    let { profiles } = await (
      await profilesApi(cookie, "GET")
    ).json<{
      profiles: Profile[];
    }>();
    expect(profiles).toHaveLength(1);
    const perApp = profiles[0];
    expect(perApp).toMatchObject({
      kind: "app",
      name: null,
      name_id: wikiId,
      apps: [{ id: "a1", name: "Wiki" }],
    });

    // It goes with its app: no renaming or deleting it alone.
    expect(
      (await profilesApi(cookie, "PATCH", `/${perApp.id}`, { name: "x" }))
        .status,
    ).toBe(409);
    expect((await profilesApi(cookie, "DELETE", `/${perApp.id}`)).status).toBe(
      409,
    );

    const res = await profilesApi(cookie, "POST", `/${perApp.id}/share`, {
      name: "Main",
    });
    expect(res.status).toBe(200);
    expect((await res.json<{ profile: Profile }>()).profile).toMatchObject({
      id: perApp.id,
      kind: "shared",
      name: "Main",
      name_id: wikiId,
      apps: [{ id: "a1", name: "Wiki" }],
    });
    expect(
      (await profilesApi(cookie, "POST", `/${perApp.id}/share`, { name: "x" }))
        .status,
    ).toBe(409);

    // The wiki sees no change; now another app can be given the same ID.
    expect(await approve(await start(SP), cookie)).toBe(wikiId);
    const token = await start(OTHER);
    expect((await info(token, cookie)).profile_choices).toEqual([
      { id: perApp.id, kind: "shared", name: "Main", name_id: wikiId },
    ]);
    expect(await approve(token, cookie, perApp.id)).toBe(wikiId);
    ({ profiles } = await (
      await profilesApi(cookie, "GET")
    ).json<{
      profiles: Profile[];
    }>());
    expect(profiles[0].apps.map((a) => a.id).sort()).toEqual(["a1", "a3"]);
  });

  test("shared profiles: create, rename, delete when unused, limits", async () => {
    const cookie = await sessionCookie();
    let res = await profilesApi(cookie, "POST", "", { name: "  " });
    expect(await res.json()).toEqual({
      error: "field_required",
      params: { field: "name" },
    });
    res = await profilesApi(cookie, "POST", "", { name: "x".repeat(65) });
    expect(await res.json()).toEqual({
      error: "field_max_length",
      params: { field: "name", max: 64 },
    });

    const spare = await createShared(cookie, "Spare");
    res = await profilesApi(cookie, "PATCH", `/${spare.id}`, {
      name: "Spare 2",
    });
    expect((await res.json<{ profile: Profile }>()).profile.name).toBe(
      "Spare 2",
    );

    // In use: kept, since the app knows the user by it.
    await approve(await start(SP), cookie, spare.id);
    res = await profilesApi(cookie, "DELETE", `/${spare.id}`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "saml_profile_in_use",
      params: { count: 1 },
    });
    sqlite.run("DELETE FROM saml_profile_apps");
    expect((await profilesApi(cookie, "DELETE", `/${spare.id}`)).status).toBe(
      200,
    );
    res = await profilesApi(cookie, "GET", `/${spare.id}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "saml_profile_not_found" });

    // Someone else's profile doesn't exist for this user.
    sqlite.run(
      `INSERT INTO saml_profiles (id, user_id, name_id, app_id, name, created_at, updated_at)
       VALUES ('p-bob', 'u2', 'bob-id', NULL, 'Bob''s', 0, 0)`,
    );
    expect((await profilesApi(cookie, "GET", "/p-bob")).status).toBe(404);
    expect((await profilesApi(cookie, "DELETE", "/p-bob")).status).toBe(404);

    // At most 50 shared profiles.
    for (let i = 0; i < 50; i++)
      sqlite.run(
        `INSERT INTO saml_profiles (id, user_id, name_id, app_id, name, created_at, updated_at)
         VALUES (?, 'u1', ?, NULL, 'n', 0, 0)`,
        [`bulk${i}`, `bulk-id-${i}`],
      );
    res = await profilesApi(cookie, "POST", "", { name: "One more" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "saml_profile_limit",
      params: { max: 50 },
    });

    expect((await call("/api/saml/profiles", { method: "GET" })).status).toBe(
      401,
    );
  });
});

describe("single logout settings", () => {
  test("saves an optional signing certificate, PEM or base64", async () => {
    app.route("/api/apps", appsRoutes);
    const cookie = await sessionCookie();
    const put = (body: unknown) =>
      call("/api/apps/a1/saml", { ...json(body, cookie), method: "PUT" });
    const base = {
      entity_id: SP,
      acs_urls: [ACS],
      slo_url: "https://sp.example/slo",
    };
    const keys = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const cert = await selfSignedCertificate(
      keys.publicKey,
      keys.privateKey,
      "sp.example",
    );

    let res = await put({
      ...base,
      signing_cert: "-----BEGIN CERTIFICATE-----\nnope",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "saml_certificate_invalid" });

    res = await put({
      ...base,
      signing_cert: Buffer.from(cert).toString("base64"),
    });
    expect(res.status).toBe(200);
    expect((await res.json<Body>()).saml?.signing_cert).toBe(toPem(cert));
    expect(
      (
        sqlite
          .query(
            "SELECT signing_cert FROM saml_service_providers WHERE app_id = 'a1'",
          )
          .get() as { signing_cert: string }
      ).signing_cert,
    ).toBe(Buffer.from(cert).toString("base64"));

    res = await put({ ...base, signing_cert: toPem(cert) });
    expect((await res.json<Body>()).saml?.signing_cert).toBe(toPem(cert));
    res = await put({ ...base, signing_cert: "" });
    expect((await res.json<Body>()).saml?.signing_cert).toBeNull();
    // It only checks logout messages: without single logout it isn't kept.
    res = await put({ ...base, slo_url: "", signing_cert: toPem(cert) });
    expect((await res.json<Body>()).saml?.signing_cert).toBeNull();
  });

  test("saves an optional single logout URL and binding", async () => {
    app.route("/api/apps", appsRoutes);
    const cookie = await sessionCookie();
    const put = (body: unknown) =>
      call("/api/apps/a1/saml", { ...json(body, cookie), method: "PUT" });
    const base = { entity_id: SP, acs_urls: [ACS] };

    let res = await put({ ...base, slo_url: "http://sp.example/slo" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "field_invalid",
      params: { field: "slo_url" },
    });
    res = await put({
      ...base,
      slo_url: "https://sp.example/slo",
      slo_binding: "soap",
    });
    expect(res.status).toBe(400);

    res = await put({
      ...base,
      slo_url: "https://sp.example/slo",
      slo_binding: "post",
    });
    expect(res.status).toBe(200);
    const info = await (
      await call("/api/apps/a1/saml", { headers: { Cookie: cookie } })
    ).json<Body>();
    expect(info.saml?.slo_url).toBe("https://sp.example/slo");
    expect(info.saml?.slo_binding).toBe("post");
    expect(info.idp.slo_url).toBe("https://prism.example/saml/slo");

    // Empty turns it off.
    res = await put({ ...base, slo_url: "  " });
    expect((await res.json<Body>()).saml?.slo_url).toBeNull();
  });
});

describe("OIDC end_session", () => {
  beforeEach(() => {
    app.route("/api/oauth", oauthRoutes);
  });

  const sessionAlive = () =>
    sqlite.query("SELECT 1 FROM sessions WHERE id = 's1'").get() !== null;

  async function idToken(sub: string, sid: string | null = "s1") {
    const keys = await getRsaKeyPair(env.KV_SESSIONS);
    return signIdTokenRS256(
      { iss: env.APP_URL, sub, aud: "client-1", ...(sid ? { sid } : {}) },
      keys.privateKey,
      keys.kid,
      3600,
    );
  }

  test("a plain link only asks; the user confirms on the page", async () => {
    const cookie = await sessionCookie();
    const res = await call("/api/oauth/end_session", {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("Location")!);
    expect(url.origin + url.pathname).toBe("https://prism.example/logout");
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(sessionAlive()).toBe(true);

    const token = url.searchParams.get("token")!;
    const ask = await call("/api/saml/logout", json({ token }, cookie));
    expect(await ask.json()).toEqual({ kind: "confirm", app: null });
    const done = await call(
      "/api/saml/logout",
      json({ token, action: "confirm" }, cookie),
    );
    expect(await done.json()).toEqual({
      kind: "redirect",
      url: "https://prism.example/logged-out",
    });
    expect(sessionAlive()).toBe(false);
  });

  test("staying signed in goes home, still signed in", async () => {
    const cookie = await sessionCookie();
    const res = await call("/api/oauth/end_session", {
      headers: { Cookie: cookie },
    });
    const token = new URL(res.headers.get("Location")!).searchParams.get(
      "token",
    )!;
    const done = await call(
      "/api/saml/logout",
      json({ token, action: "cancel" }, cookie),
    );
    expect(await done.json()).toEqual({ kind: "redirect", url: "/" });
    expect(sessionAlive()).toBe(true);
  });

  test("only a hint from this session, of an app still allowed, skips the question", async () => {
    const cookie = await sessionCookie();
    const asks = async (hint: string) => {
      const res = await call(`/api/oauth/end_session?id_token_hint=${hint}`, {
        headers: { Cookie: cookie },
      });
      return new URL(res.headers.get("Location")!).pathname === "/logout";
    };
    const consent = () =>
      sqlite.run(
        `INSERT OR REPLACE INTO oauth_consents (id, user_id, client_id, scopes, granted_at, auto_authorize)
         VALUES ('c1', 'u1', 'client-1', '["openid"]', 1, 0)`,
      );

    // Someone else's token, a token from another session or one without a
    // session, and a token of an app the user revoked (no consent): all ask.
    consent();
    expect(await asks(await idToken("u2"))).toBe(true);
    expect(await asks(await idToken("u1", "s-old"))).toBe(true);
    expect(await asks(await idToken("u1", null))).toBe(true);
    sqlite.run("DELETE FROM oauth_consents");
    expect(await asks(await idToken("u1"))).toBe(true);
    expect(sessionAlive()).toBe(true);

    // This session's token, from an app the user still allows: no question.
    consent();
    const res = await call(
      `/api/oauth/end_session?id_token_hint=${await idToken("u1")}`,
      { headers: { Cookie: cookie } },
    );
    expect(res.headers.get("Location")).toBe(
      "https://prism.example/logged-out",
    );
    expect(sessionAlive()).toBe(false);
  });
});

describe("signing out without asking, first-party only", () => {
  test("other apps' hints then ask; a first-party app's doesn't", async () => {
    app.route("/api/oauth", oauthRoutes);
    sqlite.run(
      "INSERT OR REPLACE INTO site_config (key, value, updated_at) VALUES ('silent_logout_first_party_only', 'true', 0)",
    );
    sqlite.run(
      `INSERT INTO oauth_consents (id, user_id, client_id, scopes, granted_at, auto_authorize)
       VALUES ('c1', 'u1', 'client-1', '["openid"]', 1, 0)`,
    );
    const cookie = await sessionCookie();
    const keys = await getRsaKeyPair(env.KV_SESSIONS);
    const hint = await signIdTokenRS256(
      { iss: env.APP_URL, sub: "u1", aud: "client-1", sid: "s1" },
      keys.privateKey,
      keys.kid,
      3600,
    );
    const endSession = () =>
      call(`/api/oauth/end_session?id_token_hint=${hint}`, {
        headers: { Cookie: cookie },
      });

    let res = await endSession();
    expect(new URL(res.headers.get("Location")!).pathname).toBe("/logout");

    sqlite.run("UPDATE oauth_apps SET is_first_party = 1 WHERE id = 'a1'");
    res = await endSession();
    expect(res.headers.get("Location")).toBe(
      "https://prism.example/logged-out",
    );
  });
});

describe("OIDC end_session by POST", () => {
  test("a cross-site POST comes back as a GET, where the cookie is", async () => {
    app.route("/api/oauth", oauthRoutes);
    const res = await call("/api/oauth/end_session", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "id_token_hint=abc&state=xyz&ignored=1",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(
      "https://prism.example/api/oauth/end_session?id_token_hint=abc&state=xyz",
    );
  });
});
