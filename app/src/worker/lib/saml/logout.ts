// SAML Single Logout, identity-provider side, and the browser sign-outs
// it rides on.
//
// Prism remembers which SPs each of its sessions signed in to (saml_sessions).
// When the session ends in the browser, by signing out of Prism, through
// OIDC end_session, or because one SP sent a LogoutRequest, the browser
// visits every other SP with a single logout URL in turn: Prism sends a
// LogoutRequest, the SP answers with a LogoutResponse at /saml/slo, and the
// /logout page moves on to the next. At the end the SP that started it gets
// its LogoutResponse, or the browser goes where Prism's sign-out goes.
//
// Once begun, a logout belongs to the browser it began in: an HttpOnly
// cookie holds its token, and only a request carrying that cookie moves it
// on. SPs never see the token: an SP's LogoutResponse finds its logout by
// InResponseTo, the ID of the LogoutRequest only that SP got.
//
// A sign-out another site asks for (an SP's LogoutRequest without its
// signing certificate on file, or end_session without a matching
// id_token_hint) could be forged by any page, so the user confirms it on
// /logout first. With the certificate, the request must be signed, and is
// then trusted as is (verify.ts). Only that
// page's same-site request can confirm: the session cookie is SameSite=Lax
// and CORS admits no other origin.
//
// Sessions that end without a browser (expiry, revocation from another
// device) can't reach SPs this way; their rows just go with the session.

import { randomBase64url, sha256Hex } from "../crypto";
import {
  encodeLogoutMessage,
  logoutRequestElement,
  logoutResponseElement,
  type LogoutResponse,
  type NameIdFormat,
  type OutgoingMessage,
  type SloBinding,
} from "./protocol";
import { idpEndpoints } from "./serviceProviders";
import { getSamlSigner } from "./sign";
import { base64ToBytes } from "./x509";

/** How long a logout may take, visits to every SP included. */
export const LOGOUT_TTL_SECONDS = 600;

type LogoutStatus =
  "Success" | "PartialLogout" | "UnknownPrincipal" | "RequestDenied";

interface Participant {
  app_id: string;
  name_id: string;
  name_id_format: NameIdFormat;
  session_index: string;
}

/** A saml_logouts row (see migrations 0087 and 0088). */
export interface LogoutRow {
  token_hash: string;
  origin_app_id: string | null;
  origin_request_id: string | null;
  origin_relay_state: string | null;
  origin_name_id: string | null;
  started: number;
  /** JSON Participant[]. */
  pending: string;
  current_app_id: string | null;
  current_request_id: string | null;
  status: LogoutStatus;
  finish_url: string | null;
  /** 1 when the SP's LogoutRequest that started it was validly signed. */
  verified: number;
  created_at: number;
  expires_at: number;
}

/** The SessionIndex of a Prism session's sign-ins to one SP. Stable, so a
 *  later assertion names the same SP session; derived, so it doesn't give
 *  away the session ID. */
export async function samlSessionIndex(
  sessionId: string,
  appId: string,
): Promise<string> {
  const hash = await sha256Hex(`saml-session:${sessionId}:${appId}`);
  return `_${hash.slice(0, 40)}`;
}

/** Remember that a Prism session signed in to an SP. */
export async function recordSamlSession(
  db: D1Database,
  s: Participant & { session_id: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO saml_sessions (session_id, app_id, name_id, name_id_format, session_index, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, app_id) DO UPDATE SET name_id = excluded.name_id,
         name_id_format = excluded.name_id_format, session_index = excluded.session_index,
         created_at = excluded.created_at`,
    )
    .bind(
      s.session_id,
      s.app_id,
      s.name_id,
      s.name_id_format,
      s.session_index,
      Math.floor(Date.now() / 1000),
    )
    .run();
}

/** The SPs a session signed in to that have a single logout URL, oldest
 *  first, leaving out the SP that started the logout (if one did). */
async function participants(
  db: D1Database,
  sessionId: string,
  exceptAppId: string | null,
): Promise<Participant[]> {
  const { results } = await db
    .prepare(
      `SELECT s.app_id, s.name_id, s.name_id_format, s.session_index
       FROM saml_sessions s
       JOIN saml_service_providers sp ON sp.app_id = s.app_id
       JOIN oauth_apps a ON a.id = s.app_id
       WHERE s.session_id = ? AND s.app_id != ? AND a.is_active = 1
         AND sp.slo_url IS NOT NULL AND sp.slo_url != ''
       ORDER BY s.created_at`,
    )
    .bind(sessionId, exceptAppId ?? "")
    .all<Participant>();
  return results;
}

const logoutPageUrl = (token: string) =>
  `/logout?token=${encodeURIComponent(token)}`;

async function insertLogout(
  db: D1Database,
  fields: Partial<LogoutRow>,
): Promise<string> {
  const token = randomBase64url(32);
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO saml_logouts (token_hash, origin_app_id, origin_request_id, origin_relay_state,
         origin_name_id, started, pending, finish_url, verified, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      await sha256Hex(token),
      fields.origin_app_id ?? null,
      fields.origin_request_id ?? null,
      fields.origin_relay_state ?? null,
      fields.origin_name_id ?? null,
      fields.started ?? 0,
      fields.pending ?? "[]",
      fields.finish_url ?? null,
      fields.verified ?? 0,
      now,
      now + LOGOUT_TTL_SECONDS,
    )
    .run();
  return token;
}

/**
 * The user is signing out of Prism in the browser. Call before the session
 * row goes. Returns the token of a logout, already begun, that tells the
 * session's SPs and then sends the browser to `finishUrl`, or null when
 * there are none. The caller binds it to the browser and sends the browser
 * to /logout.
 */
export async function startIdpLogout(
  db: D1Database,
  sessionId: string,
  finishUrl: string,
): Promise<string | null> {
  const list = await participants(db, sessionId, null);
  if (list.length === 0) return null;
  return insertLogout(db, {
    started: 1,
    pending: JSON.stringify(list),
    finish_url: finishUrl,
  });
}

/**
 * Park an SP's LogoutRequest until the /logout page picks it up. The
 * request itself may have come as a cross-site POST, which carries no
 * session cookie, so who is signed in is only checked from the page.
 * `verified`: it was signed with the SP's certificate on file, so the
 * page signs the user out without asking.
 */
export async function startSpLogout(
  db: D1Database,
  origin: {
    appId: string;
    requestId: string;
    relayState: string | null;
    nameId: string;
    verified: boolean;
  },
): Promise<string> {
  const token = await insertLogout(db, {
    origin_app_id: origin.appId,
    origin_request_id: origin.requestId,
    origin_relay_state: origin.relayState,
    origin_name_id: origin.nameId,
    verified: origin.verified ? 1 : 0,
  });
  return logoutPageUrl(token);
}

/**
 * Park an OIDC end_session request that didn't prove which app sent it,
 * for the user to confirm on the /logout page. `appId` names the app the
 * browser goes back to, when there is one.
 */
export async function startUnverifiedLogout(
  db: D1Database,
  opts: { appId: string | null; finishUrl: string },
): Promise<string> {
  const token = await insertLogout(db, {
    origin_app_id: opts.appId,
    finish_url: opts.finishUrl,
  });
  return logoutPageUrl(token);
}

export async function loadLogout(
  db: D1Database,
  token: string,
): Promise<LogoutRow | null> {
  if (!token) return null;
  return db
    .prepare(
      "SELECT * FROM saml_logouts WHERE token_hash = ? AND expires_at > ?",
    )
    .bind(await sha256Hex(token), Math.floor(Date.now() / 1000))
    .first<LogoutRow>();
}

/** The logout waiting for the answer to the LogoutRequest with this ID. */
export async function loadLogoutAwaiting(
  db: D1Database,
  requestId: string | null,
): Promise<LogoutRow | null> {
  if (!requestId) return null;
  return db
    .prepare(
      "SELECT * FROM saml_logouts WHERE current_request_id = ? AND expires_at > ?",
    )
    .bind(requestId, Math.floor(Date.now() / 1000))
    .first<LogoutRow>();
}

/** Whether an SP's LogoutRequest started this logout (and gets an answer). */
const fromSp = (row: LogoutRow) => row.origin_request_id !== null;

/**
 * - "confirm": ask the user first; nothing has changed.
 * - "end": begun; the caller ends the Prism session now.
 * - "keep": begun without ending anything: nobody was signed in, the SP's
 *   request named someone else, or the user said no.
 * - "raced": another tab began it first.
 */
type BeginOutcome = "confirm" | "end" | "keep" | "raced";

/**
 * Begin a logout another site asked for, from the /logout page, where the
 * browser's session is known. It ends the session only once the user
 * confirms (`action`), or straight away for an SP's signed request; with
 * no session, or for someone else, there's nothing to ask.
 */
export async function beginLogout(
  db: D1Database,
  row: LogoutRow,
  session: { sessionId: string; userId: string; email: string | null } | null,
  action: "confirm" | "cancel" | null,
): Promise<BeginOutcome> {
  let status: LogoutStatus = "Success";
  let list: Participant[] = [];
  let finishUrl = row.finish_url;
  let outcome: BeginOutcome = "keep";
  if (session) {
    // An SP's request names whom to sign out: the ID of the user's SAML
    // profile for that app, their email, or the NameID this session's
    // sign-in sent it (an email since changed). end_session means whoever
    // is signed in.
    const nameId = row.origin_name_id ?? "";
    const known =
      !fromSp(row) ||
      (!!session.email && nameId === session.email) ||
      !!(await db
        .prepare(
          `SELECT 1 FROM saml_profile_apps b JOIN saml_profiles p ON p.id = b.profile_id
           WHERE b.app_id = ?1 AND b.user_id = ?2 AND p.name_id = ?3
           UNION ALL
           SELECT 1 FROM saml_sessions WHERE session_id = ?4 AND app_id = ?1 AND name_id = ?3`,
        )
        .bind(row.origin_app_id, session.userId, nameId, session.sessionId)
        .first());
    if (!known) status = "UnknownPrincipal";
    // The SP's signature shows it really asked: no question.
    else if (action === null && !row.verified) return "confirm";
    else if (action === "cancel") {
      status = "RequestDenied";
      // Still signed in, so not on to the app's signed-out page.
      finishUrl = "/";
    } else {
      list = await participants(
        db,
        session.sessionId,
        fromSp(row) ? row.origin_app_id : null,
      );
      outcome = "end";
    }
  }
  // Nobody signed in: there is nothing left to end, which is a success.
  const claim = await db
    .prepare(
      "UPDATE saml_logouts SET started = 1, pending = ?, status = ?, finish_url = ? WHERE token_hash = ? AND started = 0",
    )
    .bind(JSON.stringify(list), status, finishUrl, row.token_hash)
    .run();
  if (!claim.meta.changes) return "raced";
  row.started = 1;
  row.pending = JSON.stringify(list);
  row.status = status;
  row.finish_url = finishUrl;
  return outcome;
}

/** A status that also records one SP not confirming its logout. */
const partial = (status: LogoutStatus): LogoutStatus =>
  status === "Success" ? "PartialLogout" : status;

interface SloTarget {
  entity_id: string;
  slo_url: string | null;
  slo_binding: SloBinding;
  /** Base64 DER; null when none is on file. */
  signing_cert: string | null;
}

async function sloTarget(
  db: D1Database,
  appId: string,
): Promise<SloTarget | null> {
  return db
    .prepare(
      "SELECT entity_id, slo_url, slo_binding, signing_cert FROM saml_service_providers WHERE app_id = ?",
    )
    .bind(appId)
    .first<SloTarget>();
}

/**
 * Move the logout on: the next SP's LogoutRequest, then the LogoutResponse
 * for the SP that started it (or the finish URL), `done` once the logout is
 * over. Null when another tab moved it on first, or it's already over.
 */
export async function nextLogoutMessage(
  env: Env,
  row: LogoutRow,
): Promise<{ message: OutgoingMessage; done: boolean } | null> {
  const db = env.DB;
  const { entityId } = idpEndpoints(env.APP_URL);
  // Coming back here without the last SP's answer: it didn't confirm.
  let status = row.current_request_id ? partial(row.status) : row.status;
  const pending = JSON.parse(row.pending) as Participant[];

  for (let next = pending.shift(); next; next = pending.shift()) {
    const sp = await sloTarget(db, next.app_id);
    // Its single logout URL was removed since it signed in.
    if (!sp?.slo_url) {
      status = partial(status);
      continue;
    }
    const { id, element } = logoutRequestElement({
      idpEntityId: entityId,
      spEntityId: sp.entity_id,
      destination: sp.slo_url,
      nameId: { format: next.name_id_format, value: next.name_id },
      sessionIndex: next.session_index,
    });
    const moved = await db
      .prepare(
        `UPDATE saml_logouts SET pending = ?, current_app_id = ?, current_request_id = ?, status = ?
         WHERE token_hash = ? AND pending = ? AND current_request_id IS ?`,
      )
      .bind(
        JSON.stringify(pending),
        next.app_id,
        id,
        status,
        row.token_hash,
        row.pending,
        row.current_request_id,
      )
      .run();
    if (!moved.meta.changes) return null;
    const message = await encodeLogoutMessage(element, {
      field: "SAMLRequest",
      binding: sp.slo_binding,
      url: sp.slo_url,
      // No RelayState: the answer finds this logout by InResponseTo.
      relayState: null,
      signer: await getSamlSigner(env),
    });
    return { message, done: false };
  }

  // Every SP visited: finish, once.
  const done = await db
    .prepare(
      "DELETE FROM saml_logouts WHERE token_hash = ? AND pending = ? AND current_request_id IS ?",
    )
    .bind(row.token_hash, row.pending, row.current_request_id)
    .run();
  if (!done.meta.changes) return null;

  if (fromSp(row) && row.origin_app_id) {
    const origin = await sloTarget(db, row.origin_app_id);
    if (origin?.slo_url) {
      const message = await encodeLogoutMessage(
        logoutResponseElement({
          idpEntityId: entityId,
          destination: origin.slo_url,
          inResponseTo: row.origin_request_id!,
          status,
        }),
        {
          field: "SAMLResponse",
          binding: origin.slo_binding,
          url: origin.slo_url,
          relayState: row.origin_relay_state,
          signer: await getSamlSigner(env),
        },
      );
      return { message, done: true };
    }
  }
  return {
    message: { kind: "redirect", url: row.finish_url ?? "/logged-out" },
    done: true,
  };
}

/**
 * An SP's LogoutResponse to the LogoutRequest Prism sent it. False when it
 * isn't the answer this logout is waiting for. With the SP's signing
 * certificate on file, only a validly signed answer (`verify`, given the
 * DER certificate) confirms the logout; any other counts as unconfirmed.
 */
export async function recordLogoutResponse(
  db: D1Database,
  row: LogoutRow,
  response: LogoutResponse,
  verify: (certificate: Uint8Array) => Promise<boolean>,
): Promise<boolean> {
  if (!row.current_app_id || !row.current_request_id) return false;
  const sp = await sloTarget(db, row.current_app_id);
  if (
    !sp ||
    response.issuer !== sp.entity_id ||
    response.inResponseTo !== row.current_request_id
  )
    return false;
  const confirmed =
    response.success &&
    (!sp.signing_cert || (await verify(base64ToBytes(sp.signing_cert))));
  const status = confirmed ? row.status : partial(row.status);
  const saved = await db
    .prepare(
      `UPDATE saml_logouts SET current_app_id = NULL, current_request_id = NULL, status = ?
       WHERE token_hash = ? AND current_request_id = ?`,
    )
    .bind(status, row.token_hash, row.current_request_id)
    .run();
  return saved.meta.changes > 0;
}
