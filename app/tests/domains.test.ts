import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import {
  copyDomain,
  createDomain,
  parseDomainInput,
  verifiedParentDomain,
} from "../src/worker/lib/domains";
import { runReverification } from "../src/worker/cron/reverify";
import { checkMemberAdd } from "../src/worker/lib/teamRequirements";
import { setConfigValue } from "../src/worker/lib/config";
import type { DomainRow } from "../src/worker/types";
import { d1, migratedDatabase } from "./setup/d1";

let sqlite: Database;
let db: D1Database;
const now = Math.floor(Date.now() / 1000);

function addUser(id: string) {
  sqlite
    .query(
      "INSERT INTO users (id, email, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?)",
    )
    .run(id, `${id}@example.com`, id, now, now);
}

function addTeam(id: string, parent: string | null = null) {
  sqlite
    .query(
      "INSERT INTO teams (id, name, parent_team_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(id, id, parent, now, now);
}

function addVerifiedDomain(
  id: string,
  domain: string,
  owner: { userId: string; teamId?: string },
  nextReverify: number | null = null,
) {
  sqlite
    .query(
      `INSERT INTO domains (id, user_id, team_id, domain, verification_token,
         verified, verified_at, next_reverify_at, created_at)
       VALUES (?, ?, ?, ?, 'tok', 1, ?, ?, ?)`,
    )
    .run(
      id,
      owner.userId,
      owner.teamId ?? null,
      domain,
      now,
      nextReverify,
      now,
    );
}

const domainRow = (id: string) =>
  sqlite.query("SELECT * FROM domains WHERE id = ?").get(id) as DomainRow;

beforeEach(() => {
  sqlite = migratedDatabase();
  db = d1(sqlite);
  addUser("alice");
  addUser("bob");
});

describe("parseDomainInput", () => {
  test("cleans pasted URLs, case and trailing dots", () => {
    expect(parseDomainInput("https://Example.COM/path?q=1")).toBe(
      "example.com",
    );
    expect(parseDomainInput("  sub.example.org.  ")).toBe("sub.example.org");
    expect(parseDomainInput("example.com/foo")).toBe("example.com");
  });

  test("rejects what isn't a domain name", () => {
    expect(parseDomainInput("localhost")).toBeNull();
    expect(parseDomainInput("-bad-.com")).toBeNull();
    expect(parseDomainInput("")).toBeNull();
  });
});

describe("verifiedParentDomain", () => {
  test("finds the owner's verified parent, not someone else's", async () => {
    addVerifiedDomain("d1", "example.com", { userId: "alice" });
    expect(
      await verifiedParentDomain(db, { userId: "alice" }, "a.b.example.com"),
    ).toBe("example.com");
    expect(
      await verifiedParentDomain(db, { userId: "bob" }, "a.example.com"),
    ).toBeNull();
    // A domain is not its own parent, and a bare TLD is never one.
    expect(
      await verifiedParentDomain(db, { userId: "alice" }, "example.com"),
    ).toBeNull();
  });

  test("a team counts its ancestors' domains unless inheritance is off", async () => {
    addTeam("parent");
    addTeam("child", "parent");
    addVerifiedDomain("d1", "example.com", {
      userId: "alice",
      teamId: "parent",
    });
    expect(
      await verifiedParentDomain(db, { teamId: "child" }, "x.example.com"),
    ).toBe("example.com");

    await setConfigValue(db, "inherit_team_domains", false);
    expect(
      await verifiedParentDomain(db, { teamId: "child" }, "x.example.com"),
    ).toBeNull();
  });
});

describe("createDomain and copyDomain", () => {
  test("a domain under a verified parent is verified on creation", async () => {
    addVerifiedDomain("d1", "example.com", { userId: "alice" });
    const created = await createDomain(db, {
      userId: "alice",
      teamId: null,
      domain: "app.example.com",
    });
    expect(created.verified).toBe(true);
    expect(created.verified_by_parent).toBe("example.com");
    const row = domainRow(created.id);
    expect(row.verified).toBe(1);
    expect(row.created_by).toBe("alice");
    expect(row.next_reverify_at).toBeGreaterThan(now);

    const plain = await createDomain(db, {
      userId: "alice",
      teamId: null,
      domain: "other.org",
    });
    expect(plain.verified).toBe(false);
    expect(plain.txt_record).toBe("_prism-verify.other.org");
  });

  test("a copy keeps the verification state under a new token", async () => {
    addTeam("t");
    addVerifiedDomain("d1", "example.com", { userId: "alice" });
    const copy = await copyDomain(db, domainRow("d1"), {
      userId: "alice",
      teamId: "t",
    });
    const row = domainRow(copy.id);
    expect(row.team_id).toBe("t");
    expect(row.verified).toBe(1);
    expect(row.verification_token).not.toBe("tok");
  });
});

describe("runReverification", () => {
  test("keeps a sub-team domain an ancestor's parent domain vouches for", async () => {
    addTeam("parent");
    addTeam("child", "parent");
    addVerifiedDomain("d1", "example.com", {
      userId: "alice",
      teamId: "parent",
    });
    addVerifiedDomain(
      "d2",
      "app.example.com",
      { userId: "alice", teamId: "child" },
      now - 60,
    );
    await runReverification(db);
    const row = domainRow("d2");
    expect(row.verified).toBe(1);
    expect(row.next_reverify_at).toBeGreaterThan(now);
    expect(row.verification_method).toBeNull();
  });
});

describe("checkMemberAdd", () => {
  test("refuses a user below the team's requirements unless elevated", async () => {
    addTeam("t");
    sqlite.query("UPDATE teams SET require_2fa = 1 WHERE id = 't'").run();

    expect(await checkMemberAdd(db, "t", "bob", false)).toEqual({
      ok: false,
      error: "join_requirements_unmet_user",
      unmet_requirements: ["2fa"],
    });
    expect(await checkMemberAdd(db, "t", "bob", true)).toEqual({
      ok: true,
      bypassed: ["2fa"],
    });
  });

  test("lets an ordinary user into a team with no requirements", async () => {
    addTeam("t");
    expect(await checkMemberAdd(db, "t", "bob", false)).toEqual({
      ok: true,
      bypassed: [],
    });
  });
});
