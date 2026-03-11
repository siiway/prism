// Minimal IMAP client for Cloudflare Workers using cloudflare:sockets
// Used to poll a mailbox for incoming verification emails.

import { connect } from "cloudflare:sockets";

// ─── Public types ────────────────────────────────────────────────────────────

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean; // true = implicit TLS (993), false = STARTTLS (143)
  user: string;
  password: string;
}

export interface ImapMessage {
  uid: number;
  from: string;
  to: string;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

const CRLF = "\r\n";
const TIMEOUT_MS = 15_000;

/** Escape an IMAP string literal (wrap in quotes, escape backslash & quote). */
function quoted(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Low-level IMAP connection wrapper.  Handles tagged command/response and
 * line-buffered reading over a Cloudflare Workers TCP socket.
 */
class ImapConnection {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private buf = "";
  private tag = 0;
  private socket: ReturnType<typeof connect>;

  constructor(socket: ReturnType<typeof connect>) {
    this.socket = socket;
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  /** Read data from the socket until a full line (ending with CRLF) is available. */
  private async readLine(): Promise<string> {
    while (true) {
      const idx = this.buf.indexOf(CRLF);
      if (idx !== -1) {
        const line = this.buf.slice(0, idx);
        this.buf = this.buf.slice(idx + 2);
        return line;
      }
      const { value, done } = await this.reader.read();
      if (done) throw new Error("IMAP connection closed unexpectedly");
      this.buf += this.decoder.decode(value, { stream: true });
    }
  }

  /**
   * Read lines until we get the tagged response for `tag`.
   * Returns { status, lines } where lines includes all untagged responses.
   */
  private async readResponse(
    tag: string,
  ): Promise<{ status: string; text: string; lines: string[] }> {
    const lines: string[] = [];
    while (true) {
      const line = await this.readLine();
      if (line.startsWith(`${tag} `)) {
        const rest = line.slice(tag.length + 1);
        const sp = rest.indexOf(" ");
        const status = sp === -1 ? rest : rest.slice(0, sp);
        const text = sp === -1 ? "" : rest.slice(sp + 1);
        return { status, text, lines };
      }
      lines.push(line);
    }
  }

  /** Read the server greeting after connect. */
  async readGreeting(): Promise<void> {
    const line = await this.readLine();
    if (!line.startsWith("* OK")) {
      throw new Error(`Unexpected IMAP greeting: ${line}`);
    }
  }

  /** Send a tagged command and wait for its tagged response. */
  async command(
    cmd: string,
  ): Promise<{ status: string; text: string; lines: string[] }> {
    const t = `A${String(++this.tag).padStart(4, "0")}`;
    await this.writer.write(this.encoder.encode(`${t} ${cmd}${CRLF}`));
    const resp = await this.readResponse(t);
    if (resp.status !== "OK") {
      throw new Error(
        `IMAP ${t} ${cmd.split(" ")[0]} failed: ${resp.status} ${resp.text}`,
      );
    }
    return resp;
  }

  /** Upgrade the socket to TLS (STARTTLS). */
  upgradeTls(): ImapConnection {
    // Release current reader/writer before upgrading
    this.reader.releaseLock();
    this.writer.releaseLock();
    const tlsSocket = this.socket.startTls();
    this.socket = tlsSocket;
    this.reader = tlsSocket.readable.getReader();
    this.writer = tlsSocket.writable.getWriter();
    this.buf = "";
    return this;
  }

  /** Close the connection gracefully. */
  async close(): Promise<void> {
    try {
      this.reader.releaseLock();
      this.writer.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      await this.socket.close();
    } catch {
      /* ignore */
    }
  }
}

// ─── Envelope parser helpers ─────────────────────────────────────────────────

/**
 * Extract a bracketed/parenthesised value from an IMAP FETCH response.
 * This is a simplified parser that handles the ENVELOPE structure enough
 * to pull out FROM and TO email addresses.
 *
 * ENVELOPE structure (RFC 3501):
 *   (date subject from sender reply-to to cc bcc in-reply-to message-id)
 * Each address is: (personal-name at-domain-list mailbox host)
 */
function extractEnvelopeAddresses(envStr: string, groupIndex: number): string {
  // Walk the envelope string counting top-level groups
  let depth = 0;
  let group = 0;
  let start = -1;

  for (let i = 0; i < envStr.length; i++) {
    const ch = envStr[i];
    if (ch === "(") {
      depth++;
      if (depth === 1) {
        group++;
        if (group === groupIndex) start = i;
      }
    } else if (ch === ")") {
      if (depth === 1 && group === groupIndex) {
        return envStr.slice(start, i + 1);
      }
      depth--;
    }
  }
  return "NIL";
}

/** Parse an IMAP address-list group into "mailbox@host" for the first address. */
function parseAddressList(addrGroup: string): string {
  // addrGroup looks like ((personal NIL mailbox host)...)
  // We want mailbox@host from the first entry.
  const match = addrGroup.match(
    /\((?:"[^"]*"|NIL)\s+(?:"[^"]*"|NIL)\s+"([^"]*)"\s+"([^"]*)"\)/,
  );
  if (match) return `${match[1]}@${match[2]}`.toLowerCase();
  // Fallback: try unquoted tokens
  const fallback = addrGroup.match(
    /\([^\s]*\s+[^\s]*\s+([^\s)]+)\s+([^\s)]+)\)/,
  );
  if (fallback)
    return `${fallback[1]}@${fallback[2]}`.replace(/"/g, "").toLowerCase();
  return "";
}

/**
 * Parse a UID FETCH ... ENVELOPE response line and extract uid, from, to.
 * Example line:
 *   * 1 FETCH (UID 42 ENVELOPE ("date" "subject" ((from)) ((sender)) ((reply-to)) ((to)) ...))
 */
function parseFetchLine(lines: string[]): ImapMessage[] {
  const results: ImapMessage[] = [];

  // Merge continuation lines (literal strings) into single entries
  const merged: string[] = [];
  for (const line of lines) {
    if (line.startsWith("* ") && line.includes("FETCH")) {
      merged.push(line);
    } else if (merged.length > 0) {
      merged[merged.length - 1] += " " + line;
    }
  }

  for (const line of merged) {
    // Extract UID
    const uidMatch = line.match(/UID\s+(\d+)/i);
    if (!uidMatch) continue;
    const uid = parseInt(uidMatch[1], 10);

    // Extract ENVELOPE (...)
    const envStart = line.indexOf("ENVELOPE ");
    if (envStart === -1) continue;
    // Find the balanced parenthesised envelope starting after "ENVELOPE "
    const envDataStart = line.indexOf("(", envStart + 9);
    if (envDataStart === -1) continue;

    let depth = 0;
    let envEnd = envDataStart;
    for (let i = envDataStart; i < line.length; i++) {
      if (line[i] === "(") depth++;
      else if (line[i] === ")") {
        depth--;
        if (depth === 0) {
          envEnd = i;
          break;
        }
      }
    }
    const envelope = line.slice(envDataStart, envEnd + 1);

    // In the top-level envelope, fields are separated by spaces.
    // Fields: date(1) subject(2) from(3) sender(4) reply-to(5) to(6)
    // But date and subject are strings, not groups — so we need to skip them.
    // Strategy: find the first "(" that starts an address-list group.
    // We count quote-delimited or NIL tokens for date & subject, then take groups.

    // Simpler approach: strip outer parens, skip date & subject tokens, then
    // parse the remaining address-list groups.
    const inner = envelope.slice(1, -1); // strip outer ( )

    // Skip date (quoted string or NIL) and subject (quoted string or NIL)
    let pos = 0;
    for (let skip = 0; skip < 2; skip++) {
      pos = skipWhitespace(inner, pos);
      if (inner[pos] === '"') {
        pos = skipQuotedString(inner, pos);
      } else if (inner.slice(pos, pos + 3) === "NIL") {
        pos += 3;
      } else {
        // Unexpected — skip to next space
        while (pos < inner.length && inner[pos] !== " ") pos++;
      }
    }

    // Now the remaining items are address-list groups: from, sender, reply-to, to, cc, bcc, in-reply-to, message-id
    // from = group 1, to = group 4
    // Each address-list is either NIL or ((...) ...)
    const groups: string[] = [];
    for (let g = 0; g < 6; g++) {
      pos = skipWhitespace(inner, pos);
      if (pos >= inner.length) {
        groups.push("NIL");
        continue;
      }
      if (inner.slice(pos, pos + 3) === "NIL") {
        groups.push("NIL");
        pos += 3;
      } else if (inner[pos] === "(") {
        const start = pos;
        let d = 0;
        for (; pos < inner.length; pos++) {
          if (inner[pos] === "(") d++;
          else if (inner[pos] === ")") {
            d--;
            if (d === 0) {
              pos++;
              break;
            }
          }
        }
        groups.push(inner.slice(start, pos));
      } else if (inner[pos] === '"') {
        // in-reply-to / message-id are strings, not groups
        const start = pos;
        pos = skipQuotedString(inner, pos);
        groups.push(inner.slice(start, pos));
      } else {
        while (pos < inner.length && inner[pos] !== " ") pos++;
        groups.push("NIL");
      }
    }

    const from = groups[0] !== "NIL" ? parseAddressList(groups[0]) : "";
    const to = groups[3] !== "NIL" ? parseAddressList(groups[3]) : "";

    if (from && to) {
      results.push({ uid, from, to });
    }
  }

  return results;
}

function skipWhitespace(s: string, pos: number): number {
  while (pos < s.length && (s[pos] === " " || s[pos] === "\t")) pos++;
  return pos;
}

function skipQuotedString(s: string, pos: number): number {
  if (s[pos] !== '"') return pos;
  pos++; // skip opening quote
  while (pos < s.length) {
    if (s[pos] === "\\") {
      pos += 2;
      continue;
    }
    if (s[pos] === '"') {
      pos++;
      break;
    }
    pos++;
  }
  return pos;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Connects to an IMAP server, searches INBOX for unseen emails to verify-*@<receiveHost>,
 * returns their FROM/TO addresses, and marks them as \Seen.
 */
export async function pollVerifyEmails(
  config: ImapConfig,
  receiveHost: string,
): Promise<ImapMessage[]> {
  const addr = { hostname: config.host, port: config.port };
  const secureTransport = config.secure ? "on" : "starttls";

  const socket = connect(addr, { secureTransport, allowHalfOpen: false });
  let conn = new ImapConnection(socket);

  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const abortCheck = () => {
    if (timeout.aborted) throw new Error("IMAP operation timed out");
  };

  try {
    // Read server greeting
    await conn.readGreeting();
    abortCheck();

    // STARTTLS upgrade if not using implicit TLS
    if (!config.secure) {
      await conn.command("STARTTLS");
      conn = conn.upgradeTls();
      // Some servers send a new greeting after STARTTLS — but per spec they don't.
      // We just continue with LOGIN.
    }

    // Authenticate
    abortCheck();
    await conn.command(
      `LOGIN ${quoted(config.user)} ${quoted(config.password)}`,
    );

    // Select INBOX
    abortCheck();
    await conn.command("SELECT INBOX");

    // Search for unseen messages.
    // IMAP SEARCH TO doesn't support wildcards, so we search UNSEEN and filter
    // envelopes client-side for the verify-*@receiveHost pattern.
    abortCheck();
    const searchResp = await conn.command("UID SEARCH UNSEEN");

    // Parse UIDs from untagged SEARCH response: "* SEARCH 1 2 3"
    const uids: number[] = [];
    for (const line of searchResp.lines) {
      const m = line.match(/^\* SEARCH(.*)$/i);
      if (m && m[1].trim()) {
        for (const tok of m[1].trim().split(/\s+/)) {
          const n = parseInt(tok, 10);
          if (!isNaN(n)) uids.push(n);
        }
      }
    }

    if (uids.length === 0) {
      await conn.command("LOGOUT").catch(() => {});
      return [];
    }

    // Fetch envelopes for all unseen messages
    abortCheck();
    const uidSet = uids.join(",");
    const fetchResp = await conn.command(`UID FETCH ${uidSet} (UID ENVELOPE)`);

    const allMessages = parseFetchLine(fetchResp.lines);

    // Filter to messages where TO matches verify-*@receiveHost
    const host = receiveHost.toLowerCase();
    const pattern = new RegExp(
      `^verify-[^@]+@${host.replace(/\./g, "\\.")}$`,
      "i",
    );
    const matched = allMessages.filter((msg) => pattern.test(msg.to));

    // Mark matched messages as \Seen and \Deleted, then expunge
    if (matched.length > 0) {
      const matchedUids = matched.map((m) => m.uid).join(",");

      abortCheck();
      await conn.command(
        `UID STORE ${matchedUids} +FLAGS.SILENT (\\Seen \\Deleted)`,
      );

      abortCheck();
      await conn.command("EXPUNGE");
    }

    // Logout
    await conn.command("LOGOUT").catch(() => {
      // LOGOUT response may not be clean if server closes early
    });

    return matched;
  } catch (err) {
    // Attempt graceful close on error
    try {
      await conn.command("LOGOUT");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    await conn.close();
  }
}
