// Direct storage access: a D1 table browser with an inline row editor, a
// SQL console, and the key-value browser, switched in ?view=.
//
// Everything here talks to /api/admin/db (and /kv), which is admin-only and
// audits every statement. The UI's job is to make the dangerous parts *feel*
// dangerous: write mode is off until you turn it on, destructive actions
// confirm, and the console shows exactly what it is about to run.

import {
  Badge,
  Button,
  Field,
  Input,
  MessageBar,
  Skeleton,
  SkeletonItem,
  Spinner,
  Subtitle2,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Textarea,
  ToggleButton,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowClockwiseRegular,
  CodeRegular,
  DeleteRegular,
  DismissRegular,
  EditRegular,
  LockClosedRegular,
  PlayRegular,
  SearchRegular,
} from "@fluentui/react-icons";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiErrorText } from "../../lib/apiError";
import type { DbColumn, DbQueryResult, DbRowPage } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { useConfirm } from "../../lib/useConfirm";
import { useToastMessage } from "../../lib/useToastMessage";
import { Pagination } from "../../components/Pagination";
import { Segmented } from "../../components/Segmented";
import { Select } from "../../components/Select";
import {
  SettingsBody,
  SettingsCard,
  SettingsFooter,
  SettingsToast,
} from "../../components/Settings";
import { SkeletonTableBodyRows } from "../../components/Skeletons";
import { AdminKvBrowser } from "./AdminKvBrowser";

const PAGE_SIZE = 50;
const NARROW = "@media (max-width: 900px)";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    minWidth: 0,
    flex: 1,
  },
  toast: { position: "sticky", top: "8px", zIndex: 2 },
  split: {
    display: "grid",
    gridTemplateColumns: "240px minmax(0, 1fr)",
    gap: "16px",
    alignItems: "start",
    [NARROW]: { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  // The table list: a bordered column on wide screens, a dropdown on narrow
  // ones (60-odd monospace rows is not a mobile navigation).
  nav: {
    position: "sticky",
    top: "16px",
    display: "flex",
    flexDirection: "column",
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
    overflow: "hidden",
    [NARROW]: { display: "none" },
  },
  navFilter: {
    padding: "8px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  navList: {
    display: "flex",
    flexDirection: "column",
    maxHeight: "65vh",
    overflowY: "auto",
    padding: "4px",
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    padding: "6px 10px",
    border: "none",
    borderRadius: tokens.borderRadiusMedium,
    background: "transparent",
    color: tokens.colorNeutralForeground2,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    textAlign: "left",
    cursor: "pointer",
    ":hover": { background: tokens.colorNeutralBackground1Hover },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "-2px",
    },
  },
  navItemActive: {
    background: tokens.colorNeutralBackground1Selected,
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
    ":hover": { background: tokens.colorNeutralBackground1Selected },
  },
  navName: { overflow: "hidden", textOverflow: "ellipsis" },
  navCount: { color: tokens.colorNeutralForeground3, flexShrink: 0 },
  // Fill the viewport below the sticky top rather than running off it.
  navListTall: { maxHeight: "calc(100vh - 140px)" },
  navEmpty: { padding: "8px 10px", color: tokens.colorNeutralForeground3 },
  navSkeleton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    padding: "8px 10px",
  },
  skeletonHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
  },
  skeletonRow: {
    display: "flex",
    gap: "24px",
    padding: "12px 16px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  narrowPicker: { display: "none", [NARROW]: { display: "block" } },
  pane: { minWidth: 0, display: "flex", flexDirection: "column", gap: "12px" },
  paneHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px 16px",
    flexWrap: "wrap",
  },
  titleLine: {
    display: "flex",
    alignItems: "baseline",
    gap: "8px",
    flexWrap: "wrap",
    minWidth: 0,
  },
  headActions: { display: "flex", alignItems: "center", gap: "4px" },
  whereLabel: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  navLock: { fontSize: "12px", color: tokens.colorNeutralForeground3 },
  navNameLine: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    minWidth: 0,
  },
  navZero: { color: tokens.colorNeutralForeground4 },
  mono: { fontFamily: tokens.fontFamilyMonospace },
  muted: { color: tokens.colorNeutralForeground3 },
  code: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    color: tokens.colorNeutralForeground2,
    margin: "8px 0 0",
    padding: "10px 12px",
    borderRadius: tokens.borderRadiusMedium,
    background: tokens.colorNeutralBackground2,
  },
  // A data grid in the list frame. Columns are whatever the table has, so
  // it scrolls sideways rather than squeezing.
  grid: {
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
    overflowX: "auto",
    // Size columns to their content instead of Fluent's fixed layout, which
    // squeezed a 30-column table into the page width.
    "& table": {
      tableLayout: "auto",
      width: "max-content",
      minWidth: "100%",
    },
    "& th": {
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: tokens.fontSizeBase200,
      color: tokens.colorNeutralForeground3,
      whiteSpace: "nowrap",
    },
    "& th:first-child, & td:first-child": { paddingLeft: "16px" },
    "& tbody tr:last-child": { borderBottomStyle: "none" },
  },
  cell: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "nowrap",
    maxWidth: "320px",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  nullCell: { color: tokens.colorNeutralForeground4, fontStyle: "italic" },
  actions: { display: "flex", gap: "2px", justifyContent: "flex-end" },
  meta: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap",
    alignItems: "center",
  },
  fields: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    alignItems: "start",
    gap: "16px",
    "@media (max-width: 600px)": { gridTemplateColumns: "1fr" },
  },
  sql: { fontFamily: tokens.fontFamilyMonospace, minHeight: "160px" },
  footerStart: { marginRight: "auto" },
  danger: { color: tokens.colorPaletteRedForeground1 },
});

type ShowMsg = (intent: "success" | "error", text: string) => void;

/** Render a cell the way SQLite means it: NULL is a value, not an empty
 *  string, and the two must not look the same in a table you're about to
 *  edit. The full value is in the title for a cell cut short. */
function CellValue({ value }: { value: unknown }) {
  const styles = useStyles();
  if (value === null || value === undefined)
    return <span className={styles.nullCell}>NULL</span>;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return <span title={text}>{text}</span>;
}

/** Text the user typed → the value D1 should bind.
 *
 *  An empty box means NULL; everything else goes across as a string and lets
 *  SQLite apply its own column affinity, which is what a SQL client should
 *  do. Numeric-looking input on a numeric column is converted so integer
 *  columns don't quietly fill with strings. */
function parseInput(raw: string, column: DbColumn | undefined): unknown {
  if (raw === "") return null;
  const type = (column?.type ?? "").toUpperCase();
  if (/INT|REAL|NUM|DEC|DOUB|FLOA/.test(type) && raw.trim() !== "") {
    const n = Number(raw);
    if (!Number.isNaN(n)) return n;
  }
  return raw;
}

function toInputValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

// ─── Row editor ───────────────────────────────────────────────────────────────

/** Inserting or editing one row, in place of the grid. */
function RowEditor({
  page,
  row,
  onDone,
  showMsg,
}: {
  page: DbRowPage;
  /** null = inserting a new row. */
  row: Record<string, unknown> | null;
  /** Back to the grid; `saved` when something was written. */
  onDone: (saved: boolean) => void;
  showMsg: ShowMsg;
}) {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const { confirm, confirmDialog } = useConfirm();
  const isInsert = row === null;
  const original = useMemo(
    () =>
      Object.fromEntries(
        page.columns.map((col) => [
          col.name,
          isInsert ? "" : toInputValue(row?.[col.name]),
        ]),
      ),
    [page.columns, isInsert, row],
  );
  const [draft, setDraft] = useState<Record<string, string>>(original);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const columnByName = useMemo(
    () => new Map(page.columns.map((col) => [col.name, col])),
    [page.columns],
  );
  // On update, only send what actually changed — a table with a trigger or a
  // default shouldn't be rewritten column by column because it was opened.
  // An insert leaves empty fields out, so those columns get their defaults
  // (or NULL) instead of an explicit NULL that a NOT NULL column refuses.
  const changed = Object.entries(draft).filter(([name, value]) =>
    isInsert ? value !== "" : value !== original[name],
  );

  const save = async () => {
    if (saving || !changed.length) return;
    const values = Object.fromEntries(
      changed.map(([name, value]) => [
        name,
        parseInput(value, columnByName.get(name)),
      ]),
    );
    // Show exactly what will be written: every value for an insert, each
    // change (old → new) for an update. Nothing here checks it first.
    const shown = (v: unknown) =>
      v === null || v === undefined ? "NULL" : JSON.stringify(v);
    const lines = Object.entries(values).map(([name, value]) =>
      isInsert
        ? `${name} = ${shown(value)}`
        : `${name}: ${shown(row?.[name])} → ${shown(value)}`,
    );
    const ok = await confirm({
      title: isInsert
        ? t("admin.dbConfirmInsertTitle", { table: page.table })
        : t("admin.dbConfirmUpdateTitle", { table: page.table }),
      body: (
        <>
          <Text>
            {isInsert
              ? t("admin.dbConfirmInsertBody")
              : t("admin.dbConfirmUpdateBody", { count: lines.length })}
          </Text>
          <pre className={styles.code}>{lines.join("\n")}</pre>
        </>
      ),
      confirmLabel: isInsert ? t("admin.dbInsertRow") : t("common.saveChanges"),
    });
    if (!ok) return;
    setSaving(true);
    setError("");
    try {
      if (isInsert) await api.adminDbInsertRow(page.table, values);
      else
        await api.adminDbUpdateRow(
          page.table,
          Object.fromEntries(page.key_columns.map((n) => [n, row?.[n]])),
          values,
        );
      showMsg(
        "success",
        isInsert ? t("admin.dbRowInserted") : t("admin.dbRowUpdated"),
      );
      onDone(true);
    } catch (err) {
      setError(apiErrorText(err, t("common.saveFailed")));
      setSaving(false);
    }
  };

  return (
    <SettingsCard
      title={
        isInsert
          ? t("admin.dbInsertRowInto", { table: page.table })
          : t("admin.dbEditRowIn", { table: page.table })
      }
      description={
        isInsert
          ? t("admin.dbInsertRowDesc")
          : page.key_columns
              .map((n) => `${n} = ${toInputValue(row?.[n]) || "NULL"}`)
              .join(", ")
      }
    >
      <SettingsBody>
        {error && <MessageBar intent="error">{error}</MessageBar>}
        <div className={styles.fields}>
          {page.columns.map((col) => (
            <Field
              key={col.name}
              label={
                <>
                  <span className={styles.mono}>{col.name}</span>{" "}
                  <span className={styles.muted}>
                    {col.type || "ANY"}
                    {col.pk ? " · PK" : ""}
                  </span>
                </>
              }
              hint={
                // An insert skips empty fields, so a column with a default
                // is fine left empty there.
                col.notnull &&
                !col.pk &&
                (!isInsert || col.default_value === null)
                  ? t("admin.dbNotNullHint")
                  : undefined
              }
            >
              <Input
                className={styles.mono}
                value={draft[col.name] ?? ""}
                placeholder="NULL"
                onChange={(_, d) =>
                  setDraft((prev) => ({ ...prev, [col.name]: d.value }))
                }
              />
            </Field>
          ))}
        </div>
      </SettingsBody>
      <SettingsFooter>
        <Button onClick={() => onDone(false)} disabled={saving}>
          {t("common.cancel")}
        </Button>
        <Button
          appearance="primary"
          disabled={saving || !changed.length}
          onClick={() => void save()}
        >
          {saving ? (
            <Spinner size="tiny" />
          ) : isInsert ? (
            t("admin.dbInsertRow")
          ) : (
            t("common.saveChanges")
          )}
        </Button>
      </SettingsFooter>
      {confirmDialog}
    </SettingsCard>
  );
}

// ─── Table browser ────────────────────────────────────────────────────────────

function TableBrowser({
  table,
  rowCount,
  ddl,
  writable: consoleWritable,
  appendOnly,
  showMsg,
}: {
  table: string;
  rowCount: number | null;
  ddl: string | null;
  /** False when D1_CONSOLE puts the instance in read-only mode. */
  writable: boolean;
  /** The audit log: never changed from here, whatever the mode. */
  appendOnly: boolean;
  showMsg: ShowMsg;
}) {
  const writable = consoleWritable && !appendOnly;
  const [showSchema, setShowSchema] = useState(false);
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [page, setPage] = useState(1);
  const [whereDraft, setWhereDraft] = useState("");
  const [where, setWhere] = useState("");
  const [editing, setEditing] = useState<{
    row: Record<string, unknown> | null;
  } | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const queryKey = ["admin-db-rows", table, page, where];
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey,
    queryFn: () =>
      api.adminDbRows(table, {
        page,
        limit: PAGE_SIZE,
        where: where || undefined,
      }),
    retry: false,
  });
  const columns = data?.columns ?? [];

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["admin-db-rows", table] });
    await qc.invalidateQueries({ queryKey: ["admin-db-tables"] });
  };
  const applyWhere = () => {
    setWhere(whereDraft.trim());
    setPage(1);
  };

  const remove = async (row: Record<string, unknown>, index: number) => {
    if (!data) return;
    const key = Object.fromEntries(
      data.key_columns.map((name) => [name, row[name]]),
    );
    const ok = await confirm({
      title: t("admin.dbDeleteRowTitle"),
      body: (
        <>
          <Text>{t("admin.dbDeleteRowBody", { table })}</Text>
          <pre className={styles.code}>{JSON.stringify(key, null, 2)}</pre>
        </>
      ),
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    setDeleting(index);
    try {
      await api.adminDbDeleteRow(table, key);
      await refresh();
      showMsg("success", t("admin.dbRowDeleted"));
    } catch (err) {
      showMsg("error", apiErrorText(err, t("common.error")));
    } finally {
      setDeleting(null);
    }
  };

  if (editing && data)
    return (
      <div className={styles.pane}>
        <RowEditor
          page={data}
          row={editing.row}
          showMsg={showMsg}
          onDone={(saved) => {
            setEditing(null);
            if (saved) void refresh();
          }}
        />
      </div>
    );

  return (
    <div className={styles.pane}>
      <div className={styles.paneHead}>
        <div className={styles.titleLine}>
          <Subtitle2 as="h2" className={styles.mono}>
            {table}
          </Subtitle2>
          {appendOnly && (
            <Badge appearance="tint" size="small" icon={<LockClosedRegular />}>
              {t("admin.dbAppendOnlyBadge")}
            </Badge>
          )}
          {(data?.total ?? rowCount) != null && (
            <Text size={200} className={styles.muted}>
              {t("admin.dbRowCount", { count: data?.total ?? rowCount ?? 0 })}
              {where && ` · ${t("admin.dbFiltered")}`}
            </Text>
          )}
        </div>
        <div className={styles.headActions}>
          {ddl && (
            <ToggleButton
              appearance="subtle"
              icon={<CodeRegular />}
              checked={showSchema}
              onClick={() => setShowSchema((v) => !v)}
            >
              {t("admin.dbSchema")}
            </ToggleButton>
          )}
          <Button
            appearance="subtle"
            icon={<ArrowClockwiseRegular />}
            aria-label={t("common.refresh")}
            onClick={() => void qc.invalidateQueries({ queryKey })}
          />
          {writable && (
            <Button
              icon={<AddRegular />}
              appearance="primary"
              disabled={!data}
              onClick={() => setEditing({ row: null })}
            >
              {t("admin.dbInsertRow")}
            </Button>
          )}
        </div>
      </div>

      {appendOnly && (
        <Text size={200} className={styles.muted}>
          {t("admin.dbAppendOnlyHint")}
        </Text>
      )}
      {showSchema && ddl && <pre className={styles.code}>{ddl}</pre>}

      <Input
        className={styles.mono}
        aria-label={t("admin.dbWhereLabel")}
        value={whereDraft}
        placeholder={t("admin.dbWherePlaceholder")}
        contentBefore={<span className={styles.whereLabel}>WHERE</span>}
        contentAfter={
          whereDraft.trim() !== where ? (
            <Button size="small" appearance="transparent" onClick={applyWhere}>
              {t("admin.dbApplyFilter")}
            </Button>
          ) : where ? (
            <Button
              size="small"
              appearance="transparent"
              icon={<DismissRegular />}
              aria-label={t("common.clear")}
              onClick={() => {
                setWhereDraft("");
                setWhere("");
                setPage(1);
              }}
            />
          ) : undefined
        }
        onChange={(_, d) => setWhereDraft(d.value)}
        onKeyDown={(e) => e.key === "Enter" && applyWhere()}
      />

      {error && (
        <MessageBar intent="error">
          {apiErrorText(error, t("common.error"))}
        </MessageBar>
      )}
      {writable && data && !data.editable && (
        <MessageBar intent="warning">{t("admin.dbNotEditable")}</MessageBar>
      )}

      <div className={styles.grid}>
        <Table size="small">
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHeaderCell key={col.name}>
                  {col.name}
                  {col.pk && (
                    <Badge
                      appearance="tint"
                      size="small"
                      style={{ marginInlineStart: 6 }}
                    >
                      PK
                    </Badge>
                  )}
                </TableHeaderCell>
              ))}
              {writable && data?.editable && (
                <TableHeaderCell style={{ width: 72 }} />
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <SkeletonTableBodyRows
                rows={6}
                cols={Math.max(columns.length, 4)}
              />
            ) : data && data.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + 1}>
                  <Text className={styles.muted}>
                    {where ? t("admin.dbNoRowsMatch") : t("admin.dbNoRows")}
                  </Text>
                </TableCell>
              </TableRow>
            ) : (
              data?.rows.map((row, i) => (
                <TableRow key={i}>
                  {columns.map((col) => (
                    <TableCell key={col.name} className={styles.cell}>
                      <CellValue value={row[col.name]} />
                    </TableCell>
                  ))}
                  {writable && data.editable && (
                    <TableCell>
                      <div className={styles.actions}>
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={<EditRegular />}
                          aria-label={t("common.edit")}
                          disabled={deleting !== null}
                          onClick={() => setEditing({ row })}
                        />
                        {deleting === i ? (
                          <Spinner size="tiny" />
                        ) : (
                          <Button
                            size="small"
                            appearance="subtle"
                            icon={<DeleteRegular />}
                            className={styles.danger}
                            aria-label={t("common.delete")}
                            disabled={deleting !== null}
                            onClick={() => void remove(row, i)}
                          />
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {data && (
        <Pagination
          page={page}
          total={data.total}
          pageSize={data.limit}
          onChange={setPage}
          disabled={isFetching}
        />
      )}
      {confirmDialog}
    </div>
  );
}

/** The table view's shape while the table list loads: a title and actions,
 *  the filter, and a grid of placeholder rows. */
function TableSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton aria-busy className={styles.pane}>
      <div className={styles.skeletonHead}>
        <SkeletonItem size={20} style={{ width: 180 }} />
        <SkeletonItem size={32} style={{ width: 120 }} />
      </div>
      <SkeletonItem size={32} />
      <div className={styles.grid}>
        <div className={styles.skeletonRow} style={{ borderTop: "none" }}>
          {[60, 90, 80, 110, 70].map((w, i) => (
            <SkeletonItem key={i} size={12} style={{ width: w }} />
          ))}
        </div>
        {Array.from({ length: 6 }).map((_, r) => (
          <div key={r} className={styles.skeletonRow}>
            {[60, 90, 80, 110, 70].map((w, i) => (
              <SkeletonItem key={i} size={12} style={{ width: w }} />
            ))}
          </div>
        ))}
      </div>
    </Skeleton>
  );
}

/** Pick a table: a filterable list on wide screens, a dropdown on narrow. */
function TablePicker({
  tables,
  active,
  onSelect,
  loading,
  appendOnly,
}: {
  tables: { name: string; row_count: number | null }[];
  active: string | null;
  onSelect: (name: string) => void;
  loading: boolean;
  /** Tables marked with a lock: the audit log. */
  appendOnly: string[];
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const shown = tables.filter((tbl) =>
    tbl.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  return (
    <>
      <nav className={styles.nav} aria-label={t("admin.dbTablesLabel")}>
        <div className={styles.navFilter}>
          <Input
            size="small"
            style={{ width: "100%" }}
            value={filter}
            onChange={(_, d) => setFilter(d.value)}
            placeholder={t("admin.dbFilterTables")}
            contentBefore={<SearchRegular />}
          />
        </div>
        <div className={mergeClasses(styles.navList, styles.navListTall)}>
          {loading && (
            <Skeleton aria-busy>
              {Array.from({ length: 14 }).map((_, i) => (
                <div key={i} className={styles.navSkeleton}>
                  <SkeletonItem
                    size={12}
                    style={{ width: `${45 + ((i * 37) % 40)}%` }}
                  />
                  <SkeletonItem size={12} style={{ width: 18 }} />
                </div>
              ))}
            </Skeleton>
          )}
          {shown.map((tbl) => (
            <button
              key={tbl.name}
              type="button"
              aria-current={tbl.name === active ? "true" : undefined}
              className={mergeClasses(
                styles.navItem,
                tbl.name === active && styles.navItemActive,
              )}
              onClick={() => onSelect(tbl.name)}
            >
              <span className={styles.navNameLine}>
                <span className={styles.navName}>{tbl.name}</span>
                {appendOnly.includes(tbl.name) && (
                  <LockClosedRegular
                    className={styles.navLock}
                    aria-label={t("admin.dbAppendOnlyBadge")}
                  />
                )}
              </span>
              <span
                className={mergeClasses(
                  styles.navCount,
                  tbl.row_count === 0 && styles.navZero,
                )}
              >
                {tbl.row_count ?? "?"}
              </span>
            </button>
          ))}
          {!loading && !shown.length && (
            <Text size={200} className={styles.navEmpty}>
              {t("admin.dbNoTables")}
            </Text>
          )}
        </div>
      </nav>
      <div className={styles.narrowPicker}>
        <Field label={t("admin.dbTablesLabel")}>
          <Select value={active ?? ""} onChange={(_, d) => onSelect(d.value)}>
            {tables.map((tbl) => (
              <option key={tbl.name} value={tbl.name}>
                {`${tbl.name} (${tbl.row_count ?? "?"})`}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </>
  );
}

// ─── SQL console ──────────────────────────────────────────────────────────────

function SqlConsole({
  tables,
  appendOnly,
  writable,
  showMsg,
}: {
  tables: string[];
  /** Tables no statement here may change. */
  appendOnly: string[];
  /** False when D1_CONSOLE puts the instance in read-only mode. */
  writable: boolean;
  showMsg: ShowMsg;
}) {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [sql, setSql] = useState("SELECT * FROM users LIMIT 20;");
  const [allowWrite, setAllowWrite] = useState(false);
  const [results, setResults] = useState<DbQueryResult[] | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (running || !sql.trim()) return;
    if (
      allowWrite &&
      !(await confirm({
        title: t("admin.dbConfirmWriteTitle"),
        body: (
          <>
            <Text>{t("admin.dbConfirmWriteBody")}</Text>
            <pre className={styles.code}>{sql.trim()}</pre>
          </>
        ),
        confirmLabel: t("admin.dbRunAnyway"),
      }))
    )
      return;
    setRunning(true);
    try {
      const res = await api.adminDbQuery(sql, { allowWrite });
      setError("");
      setResults(res.results);
      const written = res.results.reduce((n, r) => n + r.rows_written, 0);
      if (written > 0) {
        showMsg("success", t("admin.dbRowsWritten", { count: written }));
        // A write can invalidate anything on screen — including the row
        // counts in the table list.
        void qc.invalidateQueries({ queryKey: ["admin-db-tables"] });
        void qc.invalidateQueries({ queryKey: ["admin-db-rows"] });
      }
    } catch (err) {
      setResults(null);
      setError(apiErrorText(err, t("common.error")));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className={styles.pane}>
      <SettingsCard
        title={t("admin.dbSqlTitle")}
        description={
          <>
            {t("admin.dbSqlHint", { tables: tables.length })}
            {/* The one rule no setting relaxes, said where someone about
                to write SQL will read it. */}
            {writable &&
              appendOnly.length > 0 &&
              ` ${t("admin.dbAppendOnlyNotice", {
                tables: appendOnly
                  .filter((n) => !n.startsWith("sqlite_"))
                  .join(", "),
              })}`}
          </>
        }
      >
        <SettingsBody>
          <Field label={t("admin.dbSqlLabel")}>
            <Textarea
              className={styles.sql}
              resize="vertical"
              value={sql}
              onChange={(_, d) => setSql(d.value)}
              onKeyDown={(e) => {
                // Ctrl/Cmd+Enter runs, as in most SQL clients.
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void run();
                }
              }}
            />
          </Field>
          {allowWrite && (
            <MessageBar intent="warning">
              {t("admin.dbWriteWarning")}
            </MessageBar>
          )}
          {error && <MessageBar intent="error">{error}</MessageBar>}
        </SettingsBody>
        <SettingsFooter>
          {writable && (
            <div className={styles.footerStart}>
              <Segmented
                label={t("admin.dbWriteMode")}
                value={allowWrite}
                options={[
                  { value: false, label: t("admin.dbModeRead") },
                  { value: true, label: t("admin.dbModeWrite") },
                ]}
                onChange={setAllowWrite}
              />
            </div>
          )}
          <Button
            appearance="primary"
            icon={running ? undefined : <PlayRegular />}
            disabled={running || !sql.trim()}
            onClick={() => void run()}
          >
            {running ? <Spinner size="tiny" /> : t("admin.dbRun")}
          </Button>
        </SettingsFooter>
      </SettingsCard>

      {results?.map((res, i) => (
        <div key={i} className={styles.pane}>
          <div className={styles.meta}>
            {results.length > 1 && (
              <Badge appearance="tint">{`#${i + 1}`}</Badge>
            )}
            <Text size={200} className={styles.muted}>
              {t("admin.dbResultMeta", {
                read: res.row_count,
                written: res.rows_written,
              })}
              {res.duration_ms !== null &&
                ` · ${t("admin.dbDuration", { ms: res.duration_ms })}`}
            </Text>
            {res.truncated && (
              <Badge color="warning" appearance="tint">
                {t("admin.dbTruncated")}
              </Badge>
            )}
          </div>
          {res.columns.length > 0 && (
            <div className={styles.grid}>
              <Table size="small">
                <TableHeader>
                  <TableRow>
                    {res.columns.map((col) => (
                      <TableHeaderCell key={col}>{col}</TableHeaderCell>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {res.rows.map((row, r) => (
                    <TableRow key={r}>
                      {res.columns.map((col) => (
                        <TableCell key={col} className={styles.cell}>
                          <CellValue value={row[col]} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      ))}
      {confirmDialog}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type View = "tables" | "sql" | "kv";

export function AdminDatabase() {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const { message, showMsg } = useToastMessage();
  const [params, setParams] = useSearchParams();

  const {
    data,
    isLoading,
    error: tablesError,
  } = useQuery({
    queryKey: ["admin-db-tables"],
    queryFn: () => api.adminDbTables(),
    // 404s when D1_CONSOLE is off, which is the default. The views below
    // simply aren't offered in that case; retrying would only make noise.
    retry: false,
  });
  // D1_CONSOLE can put the whole surface in read-only mode. Assume writable
  // until told otherwise so the controls don't flicker in on load; the server
  // refuses the write either way, so a wrong guess costs an error toast.
  const { data: status } = useQuery({
    queryKey: ["admin-db-status"],
    queryFn: () => api.adminDbStatus(),
    staleTime: 5 * 60 * 1000,
  });
  const writable = status?.writable ?? true;
  // The two halves are configured independently, so either can be absent.
  const { data: kvStatus } = useQuery({
    queryKey: ["admin-kv-status"],
    queryFn: () => api.adminKvStatus(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const dbAvailable = status ? status.mode !== "off" : true;
  const kvAvailable = kvStatus ? kvStatus.mode !== "off" : true;

  const requested = params.get("view");
  // Land on whichever half exists rather than an empty D1 pane.
  const view: View = !dbAvailable
    ? "kv"
    : requested === "sql" || (requested === "kv" && kvAvailable)
      ? requested
      : "tables";
  const setView = (next: View) =>
    setParams(next === "tables" ? {} : { view: next }, { replace: true });

  const tables = data?.tables ?? [];
  const appendOnly = status?.append_only ?? [];
  const requestedTable = params.get("table");
  // A table named in the URL opens at once: its rows load in well under a
  // second, while the list (which counts every table) can take several.
  // Once the list is in, an unknown name falls back to the first table.
  const active = data
    ? (tables.find((tbl) => tbl.name === requestedTable)?.name ??
      tables[0]?.name ??
      null)
    : requestedTable;
  const activeTable = tables.find((tbl) => tbl.name === active) ?? null;
  const selectTable = (name: string) =>
    setParams({ table: name }, { replace: true });

  const views = [
    ...(dbAvailable
      ? [
          { value: "tables" as const, label: t("admin.dbBrowseTab") },
          { value: "sql" as const, label: t("admin.dbSqlTab") },
        ]
      : []),
    ...(kvAvailable ? [{ value: "kv" as const, label: t("admin.kvTab") }] : []),
  ];

  return (
    <div className={styles.root}>
      {dbAvailable && view !== "kv" && (
        <MessageBar intent={writable ? "warning" : "info"}>
          {writable ? t("admin.dbDangerNotice") : t("admin.dbReadOnlyNotice")}
        </MessageBar>
      )}
      {message && (
        <div className={styles.toast}>
          <SettingsToast message={message} />
        </div>
      )}

      {views.length > 1 && (
        <div>
          <Segmented
            label={t("admin.dbViewLabel")}
            value={view}
            onChange={(v) => setView(v as View)}
            options={views}
          />
        </div>
      )}

      {view === "kv" ? (
        <AdminKvBrowser showMsg={showMsg} />
      ) : view === "sql" ? (
        <SqlConsole
          tables={tables.map((tbl) => tbl.name)}
          appendOnly={appendOnly}
          writable={writable}
          showMsg={showMsg}
        />
      ) : tablesError && dbAvailable ? (
        <MessageBar intent="error">
          {apiErrorText(tablesError, t("common.error"))}
        </MessageBar>
      ) : (
        <div className={styles.split}>
          <TablePicker
            tables={tables}
            active={active}
            onSelect={selectTable}
            loading={isLoading}
            appendOnly={appendOnly}
          />
          {active ? (
            <TableBrowser
              key={active}
              table={active}
              rowCount={activeTable?.row_count ?? null}
              ddl={activeTable?.sql ?? null}
              writable={writable}
              appendOnly={appendOnly.includes(active)}
              showMsg={showMsg}
            />
          ) : isLoading ? (
            <TableSkeleton />
          ) : (
            <Text className={styles.muted}>{t("admin.dbNoTables")}</Text>
          )}
        </div>
      )}
    </div>
  );
}
