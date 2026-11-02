// The notice form shared by the new-notice page and a notice's own page:
// every field as typed (dates as datetime-local strings), how it maps to and
// from the API, and what's wrong with it.

import type { TFunction } from "i18next";
import type {
  AdminNotice,
  NoticeAudience,
  NoticeInput,
  NoticeLevel,
} from "../../../lib/api";
import { NOTICE_AUDIENCES, NOTICE_LEVELS } from "../../../lib/api";
import { formatDateTime } from "../../../lib/datetime";

export const LEVELS = NOTICE_LEVELS;
export const AUDIENCES = NOTICE_AUDIENCES;

export interface NoticeForm {
  title: string;
  body: string;
  level: NoticeLevel;
  audience: NoticeAudience;
  team_id: string;
  /** Shown in the team picker; never sent. */
  team_name: string;
  /** datetime-local values; empty means no bound. */
  starts: string;
  ends: string;
}

export const BLANK: NoticeForm = {
  title: "",
  body: "",
  level: "info",
  audience: "users",
  team_id: "",
  team_name: "",
  starts: "",
  ends: "",
};

/** Each card on the notice page saves its own fields. */
export type Section = "content" | "audience";
export const SECTION_FIELDS: Record<Section, (keyof NoticeForm)[]> = {
  content: ["title", "body", "level"],
  audience: ["audience", "team_id", "team_name", "starts", "ends"],
};

/** Unix seconds ⇄ a datetime-local value in the viewer's time zone. */
function toLocalInput(unix: number | null): string {
  if (!unix) return "";
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export function formFromNotice(n: AdminNotice): NoticeForm {
  return {
    title: n.title,
    body: n.body,
    level: n.level,
    audience: n.audience,
    team_id: n.team_id ?? "",
    team_name: n.team_name ?? "",
    starts: toLocalInput(n.starts_at),
    ends: toLocalInput(n.ends_at),
  };
}

/** The request fields for the given sections of the form. */
export function payloadFor(
  form: NoticeForm,
  sections: Section[] = ["content", "audience"],
): Partial<NoticeInput> {
  const out: Partial<NoticeInput> = {};
  if (sections.includes("content")) {
    out.title = form.title.trim();
    out.body = form.body;
    out.level = form.level;
  }
  if (sections.includes("audience")) {
    out.audience = form.audience;
    out.team_id = form.audience === "team" ? form.team_id || null : null;
    out.starts_at = fromLocalInput(form.starts);
    out.ends_at = fromLocalInput(form.ends);
  }
  return out;
}

export function sectionDirty(
  section: Section,
  form: NoticeForm,
  saved: NoticeForm,
): boolean {
  return (
    JSON.stringify(payloadFor(form, [section])) !==
    JSON.stringify(payloadFor(saved, [section]))
  );
}

/** Problems with the form, by field. */
export function formErrors(
  t: TFunction,
  form: NoticeForm,
): Partial<Record<keyof NoticeForm, string>> {
  const errors: Partial<Record<keyof NoticeForm, string>> = {};
  if (!form.title.trim()) errors.title = t("admin.noticeTitleRequired");
  if (!form.body.trim()) errors.body = t("admin.noticeBodyRequired");
  if (form.audience === "team" && !form.team_id)
    errors.team_id = t("admin.noticeTeamRequired");
  const starts = fromLocalInput(form.starts);
  const ends = fromLocalInput(form.ends);
  if (starts !== null && ends !== null && ends <= starts)
    errors.ends = t("admin.noticeWindowInvalid");
  return errors;
}

/** Badge colour for a level. */
export const levelColor = (level: NoticeLevel) =>
  level === "critical"
    ? "danger"
    : level === "warning"
      ? "warning"
      : "informative";

/** When a notice shows, in a few words. */
export function noticeWindow(
  t: TFunction,
  n: Pick<AdminNotice, "starts_at" | "ends_at">,
): string {
  if (n.starts_at && n.ends_at)
    return `${formatDateTime(n.starts_at)} – ${formatDateTime(n.ends_at)}`;
  if (n.starts_at)
    return t("admin.noticeFrom", { date: formatDateTime(n.starts_at) });
  if (n.ends_at)
    return t("admin.noticeUntil", { date: formatDateTime(n.ends_at) });
  return t("admin.noticeAlways");
}
