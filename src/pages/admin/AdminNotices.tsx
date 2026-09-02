// Notice board authoring.
//
// The composer is a draft-first editor with a live preview, because the
// alternative — publish and look — means every typo is seen by everyone
// before it is fixed. Publishing is a switch rather than a separate button so
// the same form covers "write it now, publish Tuesday" and "publish this
// immediately", which are the same act at different times.

import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Textarea,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowCounterclockwiseRegular,
  DeleteRegular,
  EditRegular,
  PinRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import type {
  AdminNotice,
  NoticeAudience,
  NoticeInput,
  NoticeLevel,
} from "../../lib/api";
import { renderMarkdown } from "../../lib/markdown";
import { MarkdownText } from "../../components/MarkdownText";
import { Pagination } from "../../components/Pagination";
import { SkeletonTableRows } from "../../components/Skeletons";
import { useToastMessage } from "../../lib/useToastMessage";
import { formatDateTime } from "../../lib/datetime";

const PAGE_SIZE = 20;
const LEVELS: NoticeLevel[] = ["info", "warning", "critical"];
const AUDIENCES: NoticeAudience[] = ["public", "users", "admins", "team"];

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    minWidth: 0,
    flex: 1,
  },
  tableScroll: { overflowX: "auto" },
  muted: { color: tokens.colorNeutralForeground3 },
  row: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
  editor: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    maxHeight: "65vh",
    overflowY: "auto",
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    "@media (max-width: 560px)": { gridTemplateColumns: "1fr" },
  },
  body: { fontFamily: tokens.fontFamilyBase, minHeight: "160px" },
  preview: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: "12px",
    "& p:first-child": { marginTop: 0 },
    "& p:last-child": { marginBottom: 0 },
  },
});

/** A datetime-local value ⇄ unix seconds. Empty string means "no bound",
 *  which is a real state here (publish now / never expire) rather than a
 *  missing value to be defaulted. */
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

const BLANK: NoticeInput & { starts_local: string; ends_local: string } = {
  title: "",
  body: "",
  level: "info",
  audience: "users",
  team_id: null,
  is_published: false,
  is_dismissible: true,
  pinned: false,
  starts_local: "",
  ends_local: "",
};

function NoticeEditor({
  existing,
  onClose,
  onSaved,
}: {
  existing: AdminNotice | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const [form, setForm] = useState(() =>
    existing
      ? {
          title: existing.title,
          body: existing.body,
          level: existing.level,
          audience: existing.audience,
          team_id: existing.team_id,
          is_published: existing.is_published,
          is_dismissible: existing.is_dismissible,
          pinned: existing.pinned,
          starts_local: toLocalInput(existing.starts_at),
          ends_local: toLocalInput(existing.ends_at),
        }
      : BLANK,
  );
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState("");

  useEffect(() => {
    let cancelled = false;
    void renderMarkdown(form.body || "").then((html) => {
      if (!cancelled) setPreview(html);
    });
    return () => {
      cancelled = true;
    };
  }, [form.body]);

  const save = useMutation({
    mutationFn: () => {
      const payload: NoticeInput = {
        title: form.title,
        body: form.body,
        level: form.level,
        audience: form.audience,
        team_id: form.audience === "team" ? form.team_id : null,
        is_published: form.is_published,
        is_dismissible: form.is_dismissible,
        pinned: form.pinned,
        starts_at: fromLocalInput(form.starts_local),
        ends_at: fromLocalInput(form.ends_local),
      };
      return existing
        ? api.adminUpdateNotice(existing.id, payload)
        : api.adminCreateNotice(payload);
    },
    onSuccess: () =>
      onSaved(existing ? t("admin.noticeUpdated") : t("admin.noticeCreated")),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : String(err)),
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 640 }}>
        <DialogBody>
          <DialogTitle>
            {existing ? t("admin.editNotice") : t("admin.newNotice")}
          </DialogTitle>
          <DialogContent className={styles.editor}>
            {error && <MessageBar intent="error">{error}</MessageBar>}

            <Field label={t("admin.noticeTitle")}>
              <Input
                value={form.title}
                maxLength={120}
                onChange={(_, d) => set("title", d.value)}
              />
            </Field>

            <Field
              label={t("admin.noticeBody")}
              hint={t("admin.noticeBodyHint")}
            >
              <Textarea
                className={styles.body}
                resize="vertical"
                value={form.body}
                onChange={(_, d) => set("body", d.value)}
              />
            </Field>

            {/* Shown as the reader will see it, sanitizer included — the
                preview and the board run the same function. */}
            {form.body.trim() && (
              <Field label={t("admin.noticePreview")}>
                <MessageBar
                  intent={
                    form.level === "critical"
                      ? "error"
                      : form.level === "warning"
                        ? "warning"
                        : "info"
                  }
                >
                  <MessageBarBody>
                    <MessageBarTitle>
                      {form.title || t("admin.noticeTitle")}
                    </MessageBarTitle>
                    <span dangerouslySetInnerHTML={{ __html: preview }} />
                  </MessageBarBody>
                </MessageBar>
              </Field>
            )}

            <div className={styles.grid2}>
              <Field label={t("admin.noticeLevel")}>
                <Dropdown
                  value={t(`admin.noticeLevel_${form.level}`)}
                  selectedOptions={[form.level ?? "info"]}
                  onOptionSelect={(_, d) =>
                    set("level", (d.optionValue as NoticeLevel) ?? "info")
                  }
                >
                  {LEVELS.map((l) => (
                    <Option
                      key={l}
                      value={l}
                      text={t(`admin.noticeLevel_${l}`)}
                    >
                      {t(`admin.noticeLevel_${l}`)}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
              <Field
                label={t("admin.noticeAudience")}
                hint={t(`admin.noticeAudienceHint_${form.audience}`)}
              >
                <Dropdown
                  value={t(`admin.noticeAudience_${form.audience}`)}
                  selectedOptions={[form.audience ?? "users"]}
                  onOptionSelect={(_, d) =>
                    set(
                      "audience",
                      (d.optionValue as NoticeAudience) ?? "users",
                    )
                  }
                >
                  {AUDIENCES.map((a) => (
                    <Option
                      key={a}
                      value={a}
                      text={t(`admin.noticeAudience_${a}`)}
                    >
                      {t(`admin.noticeAudience_${a}`)}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
            </div>

            {form.audience === "team" && (
              <Field label={t("admin.noticeTeamId")}>
                <Input
                  value={form.team_id ?? ""}
                  onChange={(_, d) => set("team_id", d.value || null)}
                />
              </Field>
            )}

            <div className={styles.grid2}>
              <Field
                label={t("admin.noticeStarts")}
                hint={t("admin.noticeStartsHint")}
              >
                <Input
                  type="datetime-local"
                  value={form.starts_local}
                  onChange={(_, d) => set("starts_local", d.value)}
                />
              </Field>
              <Field
                label={t("admin.noticeEnds")}
                hint={t("admin.noticeEndsHint")}
              >
                <Input
                  type="datetime-local"
                  value={form.ends_local}
                  onChange={(_, d) => set("ends_local", d.value)}
                />
              </Field>
            </div>

            <Switch
              checked={form.is_dismissible ?? true}
              onChange={(_, d) => set("is_dismissible", d.checked)}
              label={t("admin.noticeDismissible")}
            />
            <Switch
              checked={form.pinned ?? false}
              onChange={(_, d) => set("pinned", d.checked)}
              label={t("admin.noticePinned")}
            />
            <Switch
              checked={form.is_published ?? false}
              onChange={(_, d) => set("is_published", d.checked)}
              label={t("admin.noticePublished")}
            />
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button onClick={onClose}>{t("common.cancel")}</Button>
            </DialogTrigger>
            <Button
              appearance="primary"
              disabled={
                !form.title.trim() || !form.body.trim() || save.isPending
              }
              onClick={() => save.mutate()}
            >
              {t("common.save")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export function AdminNotices() {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { message, showMsg } = useToastMessage();

  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ notice: AdminNotice | null } | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<AdminNotice | null>(null);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["admin-notices", page],
    queryFn: () => api.adminListNotices(page),
    // A 503 here means the migration has not been applied. Retrying will not
    // change that, and the message below says what will.
    retry: false,
  });

  // Distinguished from any other failure because the remedy is specific and
  // an empty table would otherwise read as "no notices yet".
  const migrationsPending = error instanceof ApiError && error.status === 503;

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["admin-notices"] });
    // The board the admin themselves sees is a different query.
    await qc.invalidateQueries({ queryKey: ["notices"] });
  };

  const mutate =
    (fn: () => Promise<{ message?: string } | unknown>) => async () => {
      try {
        const res = (await fn()) as { message?: string } | undefined;
        await invalidate();
        showMsg("success", res?.message ?? t("admin.noticeUpdated"));
      } catch (err) {
        showMsg("error", err instanceof ApiError ? err.message : String(err));
      }
    };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className={styles.root}>
      {message && <MessageBar intent={message.type}>{message.text}</MessageBar>}

      {error && (
        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>
              {migrationsPending
                ? t("admin.noticesUnavailable")
                : t("common.error")}
            </MessageBarTitle>
            {error instanceof ApiError ? error.message : String(error)}
          </MessageBarBody>
        </MessageBar>
      )}

      <MessageBar intent="info">
        <MarkdownText source={t("admin.noticesIntro")} />
      </MessageBar>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          appearance="primary"
          icon={<AddRegular />}
          disabled={!!error}
          onClick={() => setEditing({ notice: null })}
        >
          {t("admin.newNotice")}
        </Button>
      </div>

      <div className={styles.tableScroll}>
        <Table size="small">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>{t("admin.noticeTitle")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.noticeAudience")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.statusHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.noticeWindow")}</TableHeaderCell>
              <TableHeaderCell style={{ width: 1 }} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <SkeletonTableRows rows={6} cols={5} />
            ) : !data || data.notices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <Text className={styles.muted}>
                    {/* Not "no notices yet" when the query failed — that
                        would be a lie about the state of the board. */}
                    {error ? t("admin.noticesUnknown") : t("admin.noNotices")}
                  </Text>
                </TableCell>
              </TableRow>
            ) : (
              data?.notices.map((n) => (
                <TableRow key={n.id}>
                  <TableCell>
                    <div className={styles.row}>
                      {n.pinned && (
                        <Tooltip
                          relationship="label"
                          content={t("admin.noticePinned")}
                        >
                          <PinRegular />
                        </Tooltip>
                      )}
                      <Text weight="semibold">{n.title}</Text>
                      <Badge
                        appearance="tint"
                        size="small"
                        color={
                          n.level === "critical"
                            ? "danger"
                            : n.level === "warning"
                              ? "warning"
                              : "informative"
                        }
                      >
                        {t(`admin.noticeLevel_${n.level}`)}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Text size={200}>
                      {n.audience === "team"
                        ? (n.team_name ?? n.team_id)
                        : t(`admin.noticeAudience_${n.audience}`)}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Badge
                      appearance="tint"
                      color={n.is_published ? "success" : "subtle"}
                    >
                      {n.is_published
                        ? t("admin.noticePublishedBadge")
                        : t("admin.noticeDraftBadge")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Text size={200} className={styles.muted}>
                      {n.starts_at || n.ends_at
                        ? `${n.starts_at ? formatDateTime(n.starts_at) : "—"} → ${
                            n.ends_at ? formatDateTime(n.ends_at) : "—"
                          }`
                        : t("admin.noticeAlways")}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <div style={{ display: "flex", gap: 4 }}>
                      <Tooltip
                        relationship="label"
                        content={
                          n.is_published
                            ? t("admin.unpublishNotice")
                            : t("admin.publishNotice")
                        }
                      >
                        <Switch
                          checked={n.is_published}
                          onChange={mutate(() =>
                            api.adminUpdateNotice(n.id, {
                              is_published: !n.is_published,
                            }),
                          )}
                        />
                      </Tooltip>
                      {/* Editing does not un-dismiss — someone who dismissed a
                          typo does not want it back because it was fixed. */}
                      <Tooltip
                        relationship="label"
                        content={t("admin.resetDismissals", {
                          count: n.dismissal_count ?? 0,
                        })}
                      >
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={<ArrowCounterclockwiseRegular />}
                          disabled={!n.dismissal_count}
                          onClick={mutate(() =>
                            api
                              .adminUpdateNotice(n.id, {
                                reset_dismissals: true,
                              })
                              .then((r) => ({
                                message: t("admin.dismissalsReset", {
                                  count: r.dismissals_reset,
                                }),
                              })),
                          )}
                        />
                      </Tooltip>
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<EditRegular />}
                        aria-label={t("common.edit")}
                        onClick={() => setEditing({ notice: n })}
                      />
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<DeleteRegular />}
                        aria-label={t("common.delete")}
                        onClick={() => setPendingDelete(n)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <Pagination
          page={page}
          pageCount={totalPages}
          total={data?.total}
          disabled={isLoading || isFetching}
          onChange={setPage}
        />
      )}

      {editing && (
        <NoticeEditor
          existing={editing.notice}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            setEditing(null);
            await invalidate();
            showMsg("success", msg);
          }}
        />
      )}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(_, d) => !d.open && setPendingDelete(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.deleteNoticeTitle")}</DialogTitle>
            <DialogContent>
              <Text>
                {t("admin.deleteNoticeBody", {
                  title: pendingDelete?.title ?? "",
                })}
              </Text>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button>{t("common.cancel")}</Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                style={{ background: tokens.colorPaletteRedBackground3 }}
                onClick={async () => {
                  if (!pendingDelete) return;
                  await mutate(() => api.adminDeleteNotice(pendingDelete.id))();
                  setPendingDelete(null);
                }}
              >
                {t("common.delete")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
