// SAML IdP routes end to end: an SP's AuthnRequest, the sign-in page's API,
// and the signed Response, against a migrated database.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { deflateRawSync } from "node:zlib";
import { DOMParser } from "@xmldom/xmldom";
import { Hono } from "hono";
import { SignedXml } from "xml-crypto";
import appsRoutes from "../src/worker/routes/apps";
import { samlApiRoutes, samlProtocolRoutes } from "../src/worker/routes/saml";
import { signJWT } from "../src/worker/lib/jwt";
import { SESSION_COOKIE } from "../src/worker/lib/cookies";
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

function authnRequest(attrs = "", issuer = SP): string {
  const xml = `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_req42" Version="2.0" IssueInstant="2026-11-02T10:00:00Z" ${attrs}><saml:Issuer>${issuer}</saml:Issuer></samlp:AuthnRequest>`;
  return encodeURIComponent(
    Buffer.from(deflateRawSync(xml)).toString("base64"),
  );
}

/** Send an AuthnRequest (redirect binding); returns the parked token. */
async function startSso(attrs = ""): Promise<string> {
  const res = await call(
    `/saml/sso?SAMLRequest=${authnRequest(attrs)}&RelayState=back-to-page`,
  );
  expect(res.status).toBe(303);
  const location = new URL(res.headers.get("Location")!, "https://x");
  expect(location.pathname).toBe("/saml/authorize");
  return location.searchParams.get("request")!;
}

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
    const token = await startSso();
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
    expect(doc.getElementsByTagNameNS("*", "NameID")[0].textContent).toBe("u1");
    const attrs = Object.fromEntries(
      Array.from(doc.getElementsByTagNameNS("*", "Attribute")).map((a) => [
        a.getAttribute("Name"),
        a.getElementsByTagNameNS("*", "AttributeValue")[0].textContent,
      ]),
    );
    expect(attrs).toEqual({
      uid: "u1",
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
