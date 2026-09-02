// Key-value browser — the KV half of Admin → Database.
//
// KV has no schema, so there is no table list to lean on: navigation is a
// prefix box and a key list, which is what the data actually looks like.
//
// Keys holding signing material come back flagged and without their value.
// The UI says so plainly rather than rendering an empty box, because "this is
// deliberately withheld" and "this key is empty" are very different facts to
// an operator debugging at speed.

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
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowClockwiseRegular,
  DeleteRegular,
  EyeRegular,
  LockClosedRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import type { KvEntry } from "../../lib/api";
import { formatDateTime } from "../../lib/datetime";

const useStyles = makeStyles({
  pane: { display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 },
  toolbar: {
    display: "flex",
    gap: "8px",
    alignItems: "flex-end",
    flexWrap: "wrap",
  },
  grow: { flexGrow: 1, minWidth: "220px" },
  tableScroll: { overflowX: "auto" },
  key: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    wordBreak: "break-all",
  },
  value: {
    fontFamily: tokens.fontFamilyMonospace,
    minHeight: "180px",
    width: "100%",
  },
  muted: { color: tokens.colorNeutralForeground3 },
  row: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
});

export function AdminKvBrowser({
  showMsg,
}: {
  showMsg: (type: "success" | "error", text: string) => void;
}) {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [ns, setNs] = useState("sessions");
  const [prefixDraft, setPrefixDraft] = useState("");
  const [prefix, setPrefix] = useState("");
  // KV pages with an opaque cursor rather than an offset, so "back" is a
  // stack of the cursors already seen rather than arithmetic.
  const [cursors, setCursors] = useState<string[]>([]);
  const [viewing, setViewing] = useState<KvEntry | null>(null);
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(
    null,
  );
  const [ttl, setTtl] = useState("");
  const [purging, setPurging] = useState(false);

  const status = useQuery({
    queryKey: ["admin-kv-status"],
    queryFn: () => api.adminKvStatus(),
  });
  // KV_CONSOLE is allowed to differ from D1_CONSOLE, so this reads its own
  // mode rather than inheriting the database tab's. Assume writable until
  // told otherwise so the controls don't flicker in; the server refuses the
  // write either way.
  const writable = status.data?.writable ?? true;

  const cursor = cursors[cursors.length - 1];
  const queryKey = ["admin-kv-keys", ns, prefix, cursor ?? ""];
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey,
    queryFn: () => api.adminKvKeys(ns, { prefix: prefix || undefined, cursor }),
    retry: false,
  });

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["admin-kv-keys", ns] });

  const openKey = useMutation({
    mutationFn: (key: string) => api.adminKvGet(ns, key),
    onSuccess: (entry) => setViewing(entry),
    onError: (err) =>
      showMsg("error", err instanceof ApiError ? err.message : String(err)),
  });

  const save = useMutation({
    mutationFn: () =>
      api.adminKvPut(
        ns,
        editing!.key,
        editing!.value,
        ttl.trim() ? Number(ttl) : null,
      ),
    onSuccess: async (res) => {
      await refresh();
      setEditing(null);
      setTtl("");
      showMsg("success", res.message);
    },
    onError: (err) =>
      showMsg("error", err instanceof ApiError ? err.message : String(err)),
  });

  const remove = useMutation({
    mutationFn: (key: string) => api.adminKvDelete(ns, key),
    onSuccess: async (res) => {
      await refresh();
      setViewing(null);
      showMsg("success", res.message);
    },
    onError: (err) =>
      showMsg("error", err instanceof ApiError ? err.message : String(err)),
  });

  const purge = useMutation({
    mutationFn: () => api.adminKvPurge(ns, prefix),
    onSuccess: async (res) => {
      await refresh();
      setPurging(false);
      showMsg(
        "success",
        t("admin.kvPurged", {
          deleted: res.deleted,
          skipped: res.skipped_protected,
        }) + (res.more ? ` ${t("admin.kvPurgeMore")}` : ""),
      );
    },
    onError: (err) =>
      showMsg("error", err instanceof ApiError ? err.message : String(err)),
  });

  const namespaces = status.data?.namespaces ?? [
    { key: "sessions", description: "" },
    { key: "cache", description: "" },
  ];

  return (
    <div className={styles.pane}>
      <div className={styles.toolbar}>
        <Field label={t("admin.kvNamespace")}>
          <Dropdown
            value={ns}
            selectedOptions={[ns]}
            onOptionSelect={(_, d) => {
              setNs(d.optionValue ?? "sessions");
              setCursors([]);
            }}
          >
            {namespaces.map((n) => (
              <Option key={n.key} value={n.key} text={n.key}>
                {n.description ? `${n.key} — ${n.description}` : n.key}
              </Option>
            ))}
          </Dropdown>
        </Field>
        <Field
          className={styles.grow}
          label={t("admin.kvPrefix")}
          hint={t("admin.kvPrefixHint")}
        >
          <Input
            value={prefixDraft}
            placeholder="system:"
            onChange={(_, d) => setPrefixDraft(d.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setPrefix(prefixDraft.trim());
                setCursors([]);
              }
            }}
          />
        </Field>
        <Button
          onClick={() => {
            setPrefix(prefixDraft.trim());
            setCursors([]);
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
          <>
            <Button
              icon={<AddRegular />}
              appearance="primary"
              onClick={() => setEditing({ key: prefix, value: "" })}
            >
              {t("admin.kvNewKey")}
            </Button>
            <Button
              icon={<DeleteRegular />}
              disabled={!prefix}
              onClick={() => setPurging(true)}
            >
              {t("admin.kvPurgePrefix")}
            </Button>
          </>
        )}
      </div>

      {error && (
        <MessageBar intent="error">
          {error instanceof ApiError ? error.message : String(error)}
        </MessageBar>
      )}

      <div className={styles.tableScroll}>
        <Table size="small">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>{t("admin.kvKeyHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.kvExpiresHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.actionsHeader")}</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={3}>
                  <Spinner size="tiny" />
                </TableCell>
              </TableRow>
            ) : data?.keys.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3}>
                  <Text className={styles.muted}>{t("admin.kvNoKeys")}</Text>
                </TableCell>
              </TableRow>
            ) : (
              data?.keys.map((row) => (
                <TableRow key={row.name}>
                  <TableCell>
                    <div className={styles.row}>
                      <span className={styles.key}>{row.name}</span>
                      {row.protected && (
                        <Badge
                          appearance="tint"
                          color="warning"
                          size="small"
                          icon={<LockClosedRegular />}
                        >
                          {t("admin.kvProtected")}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {row.expiration ? formatDateTime(row.expiration) : "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<EyeRegular />}
                      aria-label={t("admin.kvView")}
                      onClick={() => openKey.mutate(row.name)}
                    />
                    {writable && (
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<DeleteRegular />}
                        aria-label={t("common.delete")}
                        onClick={() => remove.mutate(row.name)}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className={styles.row}>
        {isFetching && <Spinner size="tiny" />}
        <Button
          size="small"
          appearance="subtle"
          disabled={cursors.length === 0}
          onClick={() => setCursors((prev) => prev.slice(0, -1))}
        >
          {t("common.previous")}
        </Button>
        <Button
          size="small"
          appearance="subtle"
          disabled={!data?.cursor}
          onClick={() =>
            data?.cursor && setCursors((prev) => [...prev, data.cursor!])
          }
        >
          {t("common.next")}
        </Button>
      </div>

      {/* Value viewer */}
      <Dialog
        open={viewing !== null}
        onOpenChange={(_, d) => !d.open && setViewing(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              <span className={styles.key}>{viewing?.key}</span>
            </DialogTitle>
            <DialogContent>
              {viewing?.protected ? (
                <MessageBar intent="warning">
                  {viewing.reason ?? t("admin.kvProtectedReason")}
                </MessageBar>
              ) : (
                <Textarea
                  className={styles.value}
                  readOnly
                  resize="vertical"
                  value={viewing?.value ?? ""}
                />
              )}
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button>{t("common.close")}</Button>
              </DialogTrigger>
              {writable && viewing && !viewing.protected && (
                <Button
                  appearance="primary"
                  onClick={() => {
                    setEditing({
                      key: viewing.key,
                      value: viewing.value ?? "",
                    });
                    setViewing(null);
                  }}
                >
                  {t("common.edit")}
                </Button>
              )}
              {writable && viewing?.protected && (
                <Button
                  appearance="primary"
                  onClick={() => remove.mutate(viewing.key)}
                >
                  {t("admin.kvRotate")}
                </Button>
              )}
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Editor */}
      <Dialog
        open={editing !== null}
        onOpenChange={(_, d) => !d.open && setEditing(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.kvWriteTitle")}</DialogTitle>
            <DialogContent>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  paddingTop: 8,
                }}
              >
                <Field label={t("admin.kvKeyHeader")}>
                  <Input
                    value={editing?.key ?? ""}
                    onChange={(_, d) =>
                      setEditing((prev) => prev && { ...prev, key: d.value })
                    }
                  />
                </Field>
                <Field label={t("admin.kvValueLabel")}>
                  <Textarea
                    className={styles.value}
                    resize="vertical"
                    value={editing?.value ?? ""}
                    onChange={(_, d) =>
                      setEditing((prev) => prev && { ...prev, value: d.value })
                    }
                  />
                </Field>
                <Field
                  label={t("admin.kvTtlLabel")}
                  hint={t("admin.kvTtlHint")}
                >
                  <Input
                    type="number"
                    value={ttl}
                    onChange={(_, d) => setTtl(d.value)}
                  />
                </Field>
              </div>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button>{t("common.cancel")}</Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                disabled={!editing?.key.trim() || save.isPending}
                onClick={() => save.mutate()}
              >
                {t("common.save")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Prefix purge */}
      <Dialog
        open={purging}
        onOpenChange={(_, d) => !d.open && setPurging(false)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.kvPurgeTitle")}</DialogTitle>
            <DialogContent>
              <Text>{t("admin.kvPurgeBody", { prefix, namespace: ns })}</Text>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button>{t("common.cancel")}</Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                disabled={purge.isPending}
                onClick={() => purge.mutate()}
              >
                {t("admin.kvPurgeConfirm")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
