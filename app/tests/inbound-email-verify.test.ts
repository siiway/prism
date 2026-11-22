import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { d1, MemoryKv, migratedDatabase } from "./setup/d1";

// The IMAP fetch is the only network step; it hands back these messages.
let inbox: { from: string; subject: string }[] = [];
mock.module("../src/worker/lib/imap", () => ({
  pollVerifyEmails: async () => inbox,
}));

const { runImapPoll } = await import("../src/worker/cron/imap-poll");
const { handleEmailWorker } = await import("../src/worker/handlers/email");

let sqlite: Database;

beforeEach(() => {
  sqlite = migratedDatabase();
  // b added x@example.com as an alternate; a then signed up with it, which
  // is allowed while the alternate is unverified. c has an alternate of its
  // own to verify.
  sqlite.exec(`
    INSERT INTO users (id, username, email, created_at, updated_at) VALUES
      ('a', 'a', 'x@example.com', 0, 0),
      ('b', 'b', 'b@example.com', 0, 0),
      ('c', 'c', 'c@example.com', 0, 0);
    INSERT INTO user_emails (id, user_id, email, verified, verify_code, created_at) VALUES
      ('bx', 'b', 'x@example.com', 0, 'aaaa', 0),
      ('cy', 'c', 'y@example.com', 0, 'bbbb', 0);
    INSERT INTO site_config (key, value, updated_at) VALUES
      ('email_receive_provider', '"imap"', 0),
      ('imap_host', '"imap.example.com"', 0),
      ('imap_user', '"receive"', 0),
      ('imap_password', '"secret"', 0);
  `);
});

afterEach(() => sqlite.close());

const env = () =>
  ({ DB: d1(sqlite), KV_CACHE: new MemoryKv() }) as unknown as Env;
const verified = (id: string) =>
  sqlite.query("SELECT verified FROM user_emails WHERE id = ?").get(id) as {
    verified: number;
  };

test("the IMAP poll won't verify another account's address, and goes on to the next message", async () => {
  inbox = [
    { from: "x@example.com", subject: "aaaa" },
    { from: "y@example.com", subject: "bbbb" },
  ];
  await runImapPoll(env(), new MemoryKv() as unknown as KVNamespace);
  expect(verified("bx").verified).toBe(0);
  expect(verified("cy").verified).toBe(1);
});

test("an inbound email won't verify another account's address", async () => {
  let rejected = "";
  await handleEmailWorker(
    {
      to: "verify-aaaa@prism.example",
      from: "x@example.com",
      setReject: (reason: string) => {
        rejected = reason;
      },
    } as unknown as EmailMessage & { setReject(reason: string): void },
    env(),
  );
  expect(rejected).not.toBe("");
  expect(verified("bx").verified).toBe(0);
});
