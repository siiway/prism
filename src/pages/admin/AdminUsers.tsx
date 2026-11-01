// Admin user list: one bordered list, a row per account opening its page
// (/admin/users/:id), where every change to an account is made. Rows can be
// selected across pages for bulk activate / deactivate / delete.

import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Skeleton,
  SkeletonItem,
  Spinner,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  ChevronRightRegular,
  DismissRegular,
  PersonRegular,
  SearchRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { formatDate } from "../../lib/datetime";
import { useToastMessage } from "../../lib/useToastMessage";
import { useAuthStore } from "../../store/auth";
import { EmptyState } from "../../components/EmptyState";
import { Pagination } from "../../components/Pagination";
import { SettingsToast } from "../../components/Settings";

const PAGE_SIZE = 20;
/** Mirrors the server's per-request cap so the UI can say why the buttons
 *  are disabled instead of letting the call fail. */
const BULK_LIMIT = 50;
const COLUMNS = "32px minmax(0, 2fr) minmax(0, 1.6fr) 80px 90px 100px 20px";
const NARROW = "@media (max-width: 768px)";

const useStyles = makeStyles({
  toast: { position: "sticky", top: "8px", zIndex: 2, marginBottom: "12px" },
  toolbar: {
    display: "flex",
    gap: "8px",
    marginBottom: "12px",
    flexWrap: "wrap",
  },
  list: {
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
    overflow: "hidden",
  },
  head: {
    display: "grid",
    gridTemplateColumns: COLUMNS,
    gap: "12px",
    alignItems: "center",
    padding: "6px 16px 6px 8px",
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    [NARROW]: { gridTemplateColumns: "32px minmax(0, 1fr)" },
  },
  // Shown in place of the column headings while rows are selected.
  bulk: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "8px",
    minWidth: 0,
    gridColumn: "2 / -1",
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase300,
  },
  bulkWarn: { color: tokens.colorPaletteMarigoldForeground1 },
  bulkActions: { display: "flex", gap: "6px", marginLeft: "auto" },
  row: {
    display: "grid",
    gridTemplateColumns: COLUMNS,
    gap: "12px",
    alignItems: "center",
    padding: "10px 16px 10px 8px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    cursor: "pointer",
    ":hover": { background: tokens.colorNeutralBackground1Hover },
    [NARROW]: { gridTemplateColumns: "32px minmax(0, 1fr) 20px" },
  },
  selected: { background: tokens.colorNeutralBackground1Selected },
  check: { display: "flex", justifyContent: "center" },
  nameCell: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    minWidth: 0,
  },
  nameText: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
  },
  name: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    textDecorationLine: "none",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      borderRadius: "2px",
    },
  },
  sub: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  cell: {
    minWidth: 0,
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    [NARROW]: { display: "none" },
  },
  muted: { color: tokens.colorNeutralForeground3 },
  chevron: { fontSize: "14px", color: tokens.colorNeutralForeground3 },
  dangerPrimary: {
    background: tokens.colorPaletteRedBackground3,
    ":hover": { background: tokens.colorPaletteRedForeground1 },
    ":hover:active": { background: tokens.colorPaletteRedForeground1 },
  },
});

export function AdminUsers() {
  const api = useApi();
  const styles = useStyles();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const me = useAuthStore((s) => s.user?.id);
  const { message, showMsg } = useToastMessage();

  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [query]);

  const { data, isFetching } = useQuery({
    queryKey: ["admin-users", page, search],
    queryFn: () => api.adminListUsers(page, PAGE_SIZE, search),
  });
  const users = data?.users ?? [];
  const total = data?.total ?? 0;

  // ── Selection ──────────────────────────────────────────────────────────────
  // By id, so it survives paging — which is why the count is shown: it can
  // exceed what is on screen. Your own row is never selectable.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const pageIds = users.map((u) => u.id).filter((id) => id !== me);
  const allOnPage =
    pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPage = pageIds.some((id) => selected.has(id));
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const [bulkBusy, setBulkBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const overLimit = selected.size > BULK_LIMIT;

  const runBulk = async (action: "activate" | "deactivate" | "delete") => {
    setBulkBusy(true);
    try {
      const res = await api.adminBulkUsers([...selected], action);
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
      setSelected(new Set());
      setDeleting(false);
      setDeleteConfirm("");
      showMsg(
        "success",
        res.skipped.length
          ? t("admin.bulkDoneSkipped", {
              count: res.affected,
              skipped: res.skipped.map((s) => `@${s.username}`).join(", "),
            })
          : t("admin.bulkDone", { count: res.affected }),
      );
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.error"),
      );
    } finally {
      setBulkBusy(false);
    }
  };

  const head = (
    <div className={styles.head}>
      <span className={styles.check}>
        <Checkbox
          checked={allOnPage ? true : someOnPage ? "mixed" : false}
          disabled={pageIds.length === 0}
          // Only this page's rows: a select-all reaching rows you haven't
          // seen is how bulk actions become accidents.
          onChange={(_, d) =>
            setSelected((prev) => {
              const next = new Set(prev);
              for (const id of pageIds) {
                if (d.checked) next.add(id);
                else next.delete(id);
              }
              return next;
            })
          }
          aria-label={t("admin.selectAllOnPage")}
        />
      </span>
      {selected.size > 0 ? (
        <div className={styles.bulk}>
          <span className={overLimit ? styles.bulkWarn : undefined}>
            {overLimit
              ? t("admin.bulkOverLimit", {
                  count: selected.size,
                  limit: BULK_LIMIT,
                })
              : t("admin.bulkSelected", { count: selected.size })}
          </span>
          <div className={styles.bulkActions}>
            <Button
              size="small"
              disabled={bulkBusy || overLimit}
              onClick={() => void runBulk("activate")}
            >
              {t("admin.bulkActivate")}
            </Button>
            <Button
              size="small"
              disabled={bulkBusy || overLimit}
              onClick={() => void runBulk("deactivate")}
            >
              {t("admin.bulkDeactivate")}
            </Button>
            <Button
              size="small"
              disabled={bulkBusy || overLimit}
              onClick={() => setDeleting(true)}
            >
              {t("admin.bulkDelete")}
            </Button>
            <Button
              size="small"
              appearance="subtle"
              icon={<DismissRegular />}
              aria-label={t("common.clear")}
              disabled={bulkBusy}
              onClick={() => setSelected(new Set())}
            />
          </div>
        </div>
      ) : (
        <>
          <span>{t("admin.userHeader")}</span>
          <span className={styles.cell}>{t("admin.emailHeader")}</span>
          <span className={styles.cell}>{t("admin.roleHeader")}</span>
          <span className={styles.cell}>{t("admin.statusHeader")}</span>
          <span className={styles.cell}>{t("admin.joinedHeader")}</span>
          <span className={styles.cell} />
        </>
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {message && (
        <div className={styles.toast}>
          <SettingsToast message={message} />
        </div>
      )}

      <div className={styles.toolbar}>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("admin.searchUsers")}
          contentBefore={<SearchRegular />}
          contentAfter={
            query ? (
              <Button
                appearance="transparent"
                size="small"
                icon={<DismissRegular />}
                aria-label={t("common.clear")}
                onClick={() => setQuery("")}
              />
            ) : undefined
          }
          style={{ minWidth: 220, flex: "1 1 220px" }}
        />
      </div>

      {isFetching && !data ? (
        <Skeleton aria-busy>
          <div className={styles.list}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className={styles.row}>
                <span />
                <div className={styles.nameCell}>
                  <SkeletonItem shape="circle" size={32} />
                  <SkeletonItem
                    size={12}
                    style={{ width: `${40 + (i % 3) * 12}%` }}
                  />
                </div>
                <SkeletonItem size={12} style={{ width: "70%" }} />
                <SkeletonItem size={12} style={{ width: 40 }} />
                <SkeletonItem size={12} style={{ width: 48 }} />
                <SkeletonItem size={12} style={{ width: 72 }} />
                <span />
              </div>
            ))}
          </div>
        </Skeleton>
      ) : users.length === 0 ? (
        <EmptyState
          icon={<PersonRegular />}
          title={
            search ? t("teams.noResultsMatch") : t("admin.userPage.noUsers")
          }
        />
      ) : (
        <>
          <div className={styles.list}>
            {head}
            {users.map((u) => {
              const isMe = u.id === me;
              const path = `/admin/users/${u.id}`;
              return (
                <div
                  key={u.id}
                  className={mergeClasses(
                    styles.row,
                    selected.has(u.id) && styles.selected,
                  )}
                  onClick={() => navigate(path)}
                >
                  <span
                    className={styles.check}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={selected.has(u.id)}
                      disabled={isMe}
                      onChange={(_, d) => toggle(u.id, !!d.checked)}
                      aria-label={u.username}
                    />
                  </span>
                  <div className={styles.nameCell}>
                    <Avatar
                      image={u.avatar_url ? { src: u.avatar_url } : undefined}
                      name={u.display_name || u.username}
                      size={32}
                    />
                    <div className={styles.nameText}>
                      {/* A real link: keyboard, middle-click, new tab. */}
                      <Link
                        to={path}
                        className={styles.name}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {u.display_name || u.username}
                      </Link>
                      <span className={styles.sub}>
                        @{u.username}
                        {isMe && ` · ${t("admin.userPage.you")}`}
                      </span>
                    </div>
                  </div>
                  <span className={styles.cell}>
                    {u.email}
                    {!u.email_verified && (
                      <Text size={200} className={styles.muted}>
                        {" "}
                        · {t("admin.unverifiedStatus")}
                      </Text>
                    )}
                  </span>
                  <span className={styles.cell}>
                    {u.role === "admin" ? (
                      <Badge appearance="tint" color="brand" size="small">
                        {t("admin.userPage.roleAdmin")}
                      </Badge>
                    ) : (
                      t("admin.userPage.roleUser")
                    )}
                  </span>
                  <span className={styles.cell}>
                    {u.is_active ? (
                      t("admin.activeStatus")
                    ) : (
                      <Badge appearance="tint" color="danger" size="small">
                        {t("admin.disabledStatus")}
                      </Badge>
                    )}
                  </span>
                  <span className={mergeClasses(styles.cell, styles.muted)}>
                    {formatDate(u.created_at)}
                  </span>
                  <ChevronRightRegular className={styles.chevron} />
                </div>
              );
            })}
          </div>
          {(total > PAGE_SIZE || page > 1) && (
            <Pagination
              page={page}
              pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
              total={total}
              onChange={setPage}
              disabled={isFetching}
            />
          )}
        </>
      )}

      {/* Deleting accounts in bulk asks for the count to be typed back: the
          number is the one thing a mis-click can't supply. */}
      <Dialog
        open={deleting}
        onOpenChange={(_, d) => {
          if (!d.open) {
            setDeleting(false);
            setDeleteConfirm("");
          }
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.bulkDeleteTitle")}</DialogTitle>
            <DialogContent>
              <Text block>
                {t("admin.bulkDeleteBody", { count: selected.size })}
              </Text>
              <Field
                label={t("admin.bulkDeleteConfirmLabel", {
                  count: selected.size,
                })}
                style={{ marginTop: 12 }}
              >
                <Input
                  value={deleteConfirm}
                  onChange={(_, d) => setDeleteConfirm(d.value)}
                />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDeleting(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                appearance="primary"
                className={styles.dangerPrimary}
                disabled={
                  bulkBusy || deleteConfirm.trim() !== String(selected.size)
                }
                onClick={() => void runBulk("delete")}
              >
                {bulkBusy ? <Spinner size="tiny" /> : t("common.delete")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
