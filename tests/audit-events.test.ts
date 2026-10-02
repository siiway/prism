import { describe, expect, test } from "bun:test";
import { AUDIT_EVENT_CATALOG, parseEvents } from "../src/lib/auditEvents";

describe("audit event catalog", () => {
  test("includes team invite and member-group writes", () => {
    expect(AUDIT_EVENT_CATALOG.team.team).toContain("invite.create");
    expect(AUDIT_EVENT_CATALOG.team.team).toContain("invite.revoke");
    expect(AUDIT_EVENT_CATALOG.team.team).toContain("group.create");
    expect(AUDIT_EVENT_CATALOG.team.team).toContain("member.groups_change");
    expect(parseEvents("team.invite.create", "team").ok).toBe(true);
  });

  test("includes site invite writes", () => {
    expect(AUDIT_EVENT_CATALOG.platform.invite).toEqual(["create", "revoke"]);
    expect(parseEvents("invite.*", "platform").ok).toBe(true);
  });

  test("includes elevated resource actions in both scope catalogs", () => {
    expect(parseEvents("admin.app.update", "user").ok).toBe(true);
    expect(parseEvents("admin.app.update", "team").ok).toBe(true);
    expect(parseEvents("admin.team.invite_registration", "team").ok).toBe(true);
    expect(parseEvents("admin.team.invite_registration", "platform").ok).toBe(
      true,
    );
  });
});
