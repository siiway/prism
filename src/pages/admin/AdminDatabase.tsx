// Direct D1 access: a table browser with an inline row editor, and a SQL
// console.
//
// Everything here talks to /api/admin/db, which is admin-only and audits
// every statement. The UI's job is to make the dangerous parts *feel*
// dangerous: write mode is off until you turn it on, destructive actions
// confirm, and the console shows exactly what it is about to run.

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
  Option,
  Spinner,
  Switch,
  Tab,
  TabList,
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
  ArrowClockwiseRegular,
  DeleteRegular,
  EditRegular,
  PlayRegular,
} from "@fluentui/react-icons";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../lib/api";
import type { DbColumn, DbQueryResult, DbRowPage } from "../../lib/api";
import { Pagination } from "../../components/Pagination";
import { SkeletonTableRows } from "../../components/Skeletons";
import { useToastMessage } from "../../lib/useToastMessage";
import { AdminKvBrowser } from "./AdminKvBrowser";

const PAGE_SIZE = 50;

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    minWidth: 0,
    flex: 1,
  },
  split: {
    display: "grid",
    gridTemplateColumns: "260px 1fr",
    // Let the single browse row fill the pane height so the result
    // pagination can sit at the bottom like every other list page. The
    // sidebar stays top-aligned; only the pane stretches (below).
    gridTemplateRows: "minmax(0, 1fr)",
    gap: "16px",
    minWidth: 0,
    minHeight: 0,
    flex: 1,
    alignItems: "start",
    "@media (max-width: 900px)": {
      gridTemplateColumns: "1fr",
      gridTemplateRows: "none",
    },
  },
  tableList: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    maxHeight: "70vh",
    overflowY: "auto",
    paddingRight: "4px",
  },
  tableButton: {
    justifyContent: "space-between",
    width: "100%",
    fontFamily: tokens.fontFamilyMonospace,
  },
  pane: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    // Fill the (1fr) grid row even though the grid aligns items to start,
    // so resultMeta's margin-top:auto can pin pagination to the bottom.
    alignSelf: "stretch",
  },
  toolbar: {
    display: "flex",
    gap: "8px",
    alignItems: "flex-end",
    flexWrap: "wrap",
  },
  grow: { flexGrow: 1, minWidth: "200px" },
  tableScroll: { overflowX: "auto" },
  cell: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "nowrap",
    maxWidth: "320px",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  nullCell: { color: tokens.colorNeutralForeground4, fontStyle: "italic" },
  sql: {
    fontFamily: tokens.fontFamilyMonospace,
    minHeight: "160px",
    width: "100%",
  },
  ddl: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "pre-wrap",
    color: tokens.colorNeutralForeground3,
    margin: 0,
  },
  editorGrid: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    maxHeight: "60vh",
    overflowY: "auto",
  },
  resultMeta: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap",
    alignItems: "center",
    // Pin the row-count + pagination bar to the bottom of the pane.
    marginTop: "auto",
  },
});

/** Render a cell the way SQLite means it: NULL is a value, not an empty
 *  string, and the two must not look the same in a table you're about to
 *  edit. */
function CellValue({ value }: { value: unknown }) {
  const styles = useStyles();
  if (value === null || value === undefined)
    return <span className={styles.nullCell}>NULL</span>;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return (
    <Tooltip content={text} relationship="description" withArrow>
      <span>{text}</span>
    </Tooltip>
  );
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

function RowEditor({
  page,
  row,
  onClose,
  onSaved,
}: {
  page: DbRowPage;
  /** null = inserting a new row. */
  row: Record<string, unknown> | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const isInsert = row === null;
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      page.columns.map((col) => [
        col.name,
        isInsert ? "" : toInputValue(row?.[col.name]),
      ]),
    ),
  );
  const [error, setError] = useState<string | null>(null);

  const columnByName = useMemo(
    () => new Map(page.columns.map((col) => [col.name, col])),
    [page.columns],
  );

  const save = useMutation({
    mutationFn: async () => {
      const values = Object.fromEntries(
        Object.entries(draft)
          // On update, only send what actually changed — a table with a
          // trigger or a default shouldn't be rewritten column by column
          // just because the dialog was opened.
          .filter(
            ([name, value]) =>
              isInsert || value !== toInputValue(row?.[name] ?? null),
          )
          .map(([name, value]) => [
            name,
            parseInput(value, columnByName.get(name)),
          ]),
      );
      if (!Object.keys(values).length)
        throw new ApiError(400, t("admin.dbNoChanges"));
      if (isInsert) return api.adminDbInsertRow(page.table, values);
      const key = Object.fromEntries(
        page.key_columns.map((name) => [name, row?.[name]]),
      );
      return api.adminDbUpdateRow(page.table, key, values);
    },
    onSuccess: () =>
      onSaved(isInsert ? t("admin.dbRowInserted") : t("admin.dbRowUpdated")),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : String(err)),
  });

  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>
            {isInsert
              ? t("admin.dbInsertRowInto", { table: page.table })
              : t("admin.dbEditRowIn", { table: page.table })}
          </DialogTitle>
          <DialogContent className={styles.editorGrid}>
            {error && <MessageBar intent="error">{error}</MessageBar>}
            {page.columns.map((col) => (
              <Field
                key={col.name}
                label={`${col.name}  ·  ${col.type || "ANY"}${col.pk ? "  ·  PK" : ""}`}
                hint={
                  col.notnull && !col.pk ? t("admin.dbNotNullHint") : undefined
                }
              >
                <Input
                  value={draft[col.name] ?? ""}
                  placeholder={draft[col.name] === "" ? "NULL" : undefined}
                  onChange={(_, d) =>
                    setDraft((prev) => ({ ...prev, [col.name]: d.value }))
                  }
                />
              </Field>
            ))}
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="secondary" onClick={onClose}>
                {t("common.cancel")}
              </Button>
            </DialogTrigger>
            <Button
              appearance="primary"
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? <Spinner size="tiny" /> : t("common.save")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ─── Table browser ────────────────────────────────────────────────────────────

function TableBrowser({
  table,
  ddl,
  writable,
  showMsg,
}: {
  table: string;
  ddl: string | null;
  /** False when D1_CONSOLE puts the instance in read-only mode. */
  writable: boolean;
  showMsg: (intent: "success" | "error", text: string) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [whereDraft, setWhereDraft] = useState("");
  const [where, setWhere] = useState("");
  const [editing, setEditing] = useState<{
    row: Record<string, unknown> | null;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Record<
    string,
    unknown
  > | null>(null);

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

  const del = useMutation({
    mutationFn: (key: Record<string, unknown>) =>
      api.adminDbDeleteRow(table, key),
    onSuccess: () => {
      setPendingDelete(null);
      showMsg("success", t("admin.dbRowDeleted"));
      void qc.invalidateQueries({ queryKey: ["admin-db-rows", table] });
      void qc.invalidateQueries({ queryKey: ["admin-db-tables"] });
    },
    onError: (err) =>
      showMsg("error", err instanceof ApiError ? err.message : String(err)),
  });

  const columns = data?.columns ?? [];

  return (
    <div className={styles.pane}>
      <div className={styles.toolbar}>
        <Field
          className={styles.grow}
          label={t("admin.dbWhereLabel")}
          hint={t("admin.dbWhereHint")}
        >
          <Input
            value={whereDraft}
            placeholder="is_active = 0"
            onChange={(_, d) => setWhereDraft(d.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setWhere(whereDraft.trim());
                setPage(1);
              }
            }}
          />
        </Field>
        <Button
          onClick={() => {
            setWhere(whereDraft.trim());
            setPage(1);
          }}
        >
          {t("admin.dbApplyFilter")}
        </Button>
        <Button
          icon={<ArrowClockwiseRegular />}
          onClick={() => void qc.invalidateQueries({ queryKey })}
        >
          {t("common.refresh")}
        </Button>
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

      {ddl && <pre className={styles.ddl}>{ddl}</pre>}

      {error && (
        <MessageBar intent="error">
          {error instanceof ApiError ? error.message : String(error)}
        </MessageBar>
      )}

      {writable && data && !data.editable && (
        <MessageBar intent="warning">{t("admin.dbNotEditable")}</MessageBar>
      )}

      <div className={styles.tableScroll}>
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
              {writable && (
                <TableHeaderCell>{t("admin.actionsHeader")}</TableHeaderCell>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <SkeletonTableRows
                rows={6}
                cols={columns.length + (writable ? 1 : 0)}
              />
            ) : (
              data?.rows.map((row, i) => (
                <TableRow key={i}>
                  {columns.map((col) => (
                    <TableCell key={col.name} className={styles.cell}>
                      <CellValue value={row[col.name]} />
                    </TableCell>
                  ))}
                  {writable && (
                    <TableCell>
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<EditRegular />}
                        disabled={!data.editable}
                        aria-label={t("common.edit")}
                        onClick={() => setEditing({ row })}
                      />
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<DeleteRegular />}
                        disabled={!data.editable}
                        aria-label={t("common.delete")}
                        onClick={() =>
                          setPendingDelete(
                            Object.fromEntries(
                              data.key_columns.map((name) => [name, row[name]]),
                            ),
                          )
                        }
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {data && (
        <div className={styles.resultMeta}>
          <Text size={200}>{t("admin.dbRowCount", { count: data.total })}</Text>
          {isFetching && <Spinner size="tiny" />}
          <Pagination
            page={page}
            pageCount={Math.max(1, Math.ceil(data.total / data.limit))}
            total={data.total}
            disabled={isFetching}
            onChange={setPage}
          />
        </div>
      )}

      {editing && data && (
        <RowEditor
          page={data}
          row={editing.row}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            showMsg("success", message);
            void qc.invalidateQueries({ queryKey: ["admin-db-rows", table] });
            void qc.invalidateQueries({ queryKey: ["admin-db-tables"] });
          }}
        />
      )}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(_, d) => !d.open && setPendingDelete(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.dbDeleteRowTitle")}</DialogTitle>
            <DialogContent>
              <Text>{t("admin.dbDeleteRowBody", { table })}</Text>
              <pre className={styles.ddl}>
                {JSON.stringify(pendingDelete, null, 2)}
              </pre>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="secondary">{t("common.cancel")}</Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                disabled={del.isPending}
                onClick={() => pendingDelete && del.mutate(pendingDelete)}
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

// ─── SQL console ──────────────────────────────────────────────────────────────

function SqlConsole({
  tables,
  writable,
  showMsg,
}: {
  tables: string[];
  /** False when D1_CONSOLE puts the instance in read-only mode. */
  writable: boolean;
  showMsg: (intent: "success" | "error", text: string) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [sql, setSql] = useState("SELECT * FROM users LIMIT 20;");
  const [allowWrite, setAllowWrite] = useState(false);
  const [results, setResults] = useState<DbQueryResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmWrite, setConfirmWrite] = useState(false);

  const run = useMutation({
    mutationFn: () => api.adminDbQuery(sql, { allowWrite }),
    onSuccess: (res) => {
      setError(null);
      setResults(res.results);
      const written = res.results.reduce((n, r) => n + r.rows_written, 0);
      if (written > 0) {
        showMsg("success", t("admin.dbRowsWritten", { count: written }));
        // A write can invalidate anything on screen — including the row
        // counts in the table list.
        void qc.invalidateQueries({ queryKey: ["admin-db-tables"] });
        void qc.invalidateQueries({ queryKey: ["admin-db-rows"] });
      }
    },
    onError: (err) => {
      setResults(null);
      setError(err instanceof ApiError ? err.message : String(err));
    },
  });

  function submit() {
    if (allowWrite) {
      setConfirmWrite(true);
      return;
    }
    run.mutate();
  }

  return (
    <div className={styles.pane}>
      <Field
        label={t("admin.dbSqlLabel")}
        hint={t("admin.dbSqlHint", { tables: tables.length })}
      >
        <Textarea
          className={styles.sql}
          resize="vertical"
          value={sql}
          onChange={(_, d) => setSql(d.value)}
        />
      </Field>

      <div className={styles.toolbar}>
        <Button
          appearance="primary"
          icon={<PlayRegular />}
          disabled={run.isPending || !sql.trim()}
          onClick={submit}
        >
          {run.isPending ? <Spinner size="tiny" /> : t("admin.dbRun")}
        </Button>
        {writable && (
          <Switch
            checked={allowWrite}
            onChange={(_, d) => setAllowWrite(d.checked)}
            label={t("admin.dbWriteMode")}
          />
        )}
      </div>

      {allowWrite && (
        <MessageBar intent="warning">{t("admin.dbWriteWarning")}</MessageBar>
      )}
      {error && <MessageBar intent="error">{error}</MessageBar>}

      {results?.map((res, i) => (
        <div key={i} className={styles.pane}>
          <div className={styles.resultMeta}>
            <Badge appearance="tint">{`#${i + 1}`}</Badge>
            <Text size={200}>
              {t("admin.dbResultMeta", {
                read: res.row_count,
                written: res.rows_written,
              })}
            </Text>
            {res.truncated && (
              <Badge color="warning" appearance="tint">
                {t("admin.dbTruncated")}
              </Badge>
            )}
          </div>
          {res.columns.length > 0 && (
            <div className={styles.tableScroll}>
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

      <Dialog
        open={confirmWrite}
        onOpenChange={(_, d) => !d.open && setConfirmWrite(false)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.dbConfirmWriteTitle")}</DialogTitle>
            <DialogContent>
              <Text>{t("admin.dbConfirmWriteBody")}</Text>
              <pre className={styles.ddl}>{sql.trim()}</pre>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="secondary">{t("common.cancel")}</Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                onClick={() => {
                  setConfirmWrite(false);
                  run.mutate();
                }}
              >
                {t("admin.dbRunAnyway")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function AdminDatabase() {
  const styles = useStyles();
  const { t } = useTranslation();
  const { message, showMsg } = useToastMessage();
  const [tab, setTab] = useState<"browse" | "sql" | "kv">("browse");
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-db-tables"],
    queryFn: () => api.adminDbTables(),
    // 404s when D1_CONSOLE is off, which is the default. The tabs below
    // simply aren't rendered in that case; retrying would only make noise.
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
  // Land on whichever half exists rather than an empty D1 pane.
  const activeTab = !dbAvailable && tab !== "kv" ? "kv" : tab;

  const tables = data?.tables ?? [];
  const active = selected ?? tables[0]?.name ?? null;
  const activeTable = tables.find((tbl) => tbl.name === active) ?? null;

  return (
    <div className={styles.root}>
      {dbAvailable && (
        <MessageBar intent={writable ? "warning" : "info"}>
          {writable ? t("admin.dbDangerNotice") : t("admin.dbReadOnlyNotice")}
        </MessageBar>
      )}
      {/* The one rule no setting relaxes, said where someone about to write
          SQL will read it. */}
      {dbAvailable && writable && status?.append_only?.length ? (
        <MessageBar intent="info">
          {t("admin.dbAppendOnlyNotice", {
            tables: status.append_only.join(", "),
          })}
        </MessageBar>
      ) : null}
      {message && <MessageBar intent={message.type}>{message.text}</MessageBar>}

      <TabList
        selectedValue={activeTab}
        onTabSelect={(_, d) => setTab(d.value as "browse" | "sql" | "kv")}
      >
        {dbAvailable && <Tab value="browse">{t("admin.dbBrowseTab")}</Tab>}
        {dbAvailable && <Tab value="sql">{t("admin.dbSqlTab")}</Tab>}
        {kvAvailable && <Tab value="kv">{t("admin.kvTab")}</Tab>}
      </TabList>

      {activeTab === "kv" && kvAvailable ? (
        <AdminKvBrowser showMsg={showMsg} />
      ) : activeTab === "browse" ? (
        <div className={styles.split}>
          <div>
            <Field label={t("admin.dbTablesLabel")}>
              {/* On narrow screens the list becomes a dropdown — 60-odd
                  monospace rows is not a mobile navigation. */}
              <Dropdown
                value={active ?? ""}
                selectedOptions={active ? [active] : []}
                onOptionSelect={(_, d) => setSelected(d.optionValue ?? null)}
              >
                {tables.map((tbl) => (
                  <Option key={tbl.name} value={tbl.name} text={tbl.name}>
                    {`${tbl.name} (${tbl.row_count ?? "?"})`}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <div className={styles.tableList}>
              {isLoading && <Spinner size="tiny" />}
              {tables.map((tbl) => (
                <Button
                  key={tbl.name}
                  className={styles.tableButton}
                  appearance={tbl.name === active ? "primary" : "subtle"}
                  size="small"
                  onClick={() => setSelected(tbl.name)}
                >
                  <span>{tbl.name}</span>
                  <Text size={200}>{tbl.row_count ?? "?"}</Text>
                </Button>
              ))}
            </div>
          </div>

          {active ? (
            <TableBrowser
              key={active}
              table={active}
              ddl={activeTable?.sql ?? null}
              writable={writable}
              showMsg={showMsg}
            />
          ) : (
            !isLoading && <Text>{t("admin.dbNoTables")}</Text>
          )}
        </div>
      ) : (
        <SqlConsole
          tables={tables.map((tbl) => tbl.name)}
          writable={writable}
          showMsg={showMsg}
        />
      )}
    </div>
  );
}
