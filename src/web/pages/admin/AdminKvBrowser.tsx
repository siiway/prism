// Key-value browser — the KV half of Admin → Database.
//
// KV has no schema, so there is no table list to lean on: navigation is a
// namespace, a prefix box and a key list, which is what the data actually
// looks like. A key opens in place of the list.
//
// Keys holding signing material come back flagged and without their value.
// The UI says so plainly rather than rendering an empty box, because "this is
// deliberately withheld" and "this key is empty" are very different facts to
// an operator debugging at speed.

import {
  Badge,
  Button,
  Field,
  Input,
  MessageBar,
  Spinner,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowClockwiseRegular,
  ChevronLeftRegular,
  ChevronRightRegular,
  DeleteRegular,
  KeyRegular,
  LockClosedRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiErrorText } from "../../lib/apiError";
import { useApi } from "../../lib/api-context";
import { formatDateTime } from "../../lib/datetime";
import { useConfirm } from "../../lib/useConfirm";
import { useDebouncedSearch } from "../../lib/useDebouncedSearch";
import {
  DataList,
  type DataListColumn,
  DataListName,
  DataListRow,
  DataListSkeleton,
} from "../../components/DataList";
import { EmptyState } from "../../components/EmptyState";
import { ListSearch } from "../../components/ListSearch";
import { Select } from "../../components/Select";
import {
  SettingsBody,
  SettingsCard,
  SettingsFooter,
} from "../../components/Settings";
import { SkeletonSettingsCard } from "../../components/Skeletons";

const useStyles = makeStyles({
  pane: { display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 },
  head: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
  },
  ns: { width: "180px" },
  muted: { color: tokens.colorNeutralForeground3 },
  mono: { fontFamily: tokens.fontFamilyMonospace },
  key: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    overflowWrap: "anywhere",
  },
  value: { fontFamily: tokens.fontFamilyMonospace, minHeight: "220px" },
  preview: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    maxHeight: "200px",
    overflowY: "auto",
    margin: "8px 0 0",
    padding: "10px 12px",
    borderRadius: tokens.borderRadiusMedium,
    background: tokens.colorNeutralBackground2,
  },
  pager: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "4px",
  },
  footerStart: { marginRight: "auto" },
  danger: { color: tokens.colorPaletteRedForeground1 },
});

type ShowMsg = (type: "success" | "error", text: string) => void;

/** One key, opened in place of the list; `key` null writes a new one. */
function KeyEditor({
  ns,
  initialKey,
  writable,
  onDone,
  showMsg,
}: {
  ns: string;
  /** null = a new key; the prefix being browsed seeds its name. */
  initialKey: { key: string; isNew: boolean };
  writable: boolean;
  onDone: () => void;
  showMsg: ShowMsg;
}) {
  const api = useApi();
  const styles = useStyles();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { confirm, confirmDialog } = useConfirm();
  const { isNew } = initialKey;

  const { data: entry, error } = useQuery({
    queryKey: ["admin-kv-entry", ns, initialKey.key],
    queryFn: () => api.adminKvGet(ns, initialKey.key),
    enabled: !isNew,
    retry: false,
  });

  const [key, setKey] = useState(initialKey.key);
  const [value, setValue] = useState<string | null>(null);
  const [ttl, setTtl] = useState("");
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);

  const current = value ?? entry?.value ?? "";
  const changed = value !== null && current !== (entry?.value ?? "");
  // A new key may hold an empty value; an existing one saves when its value
  // or expiry changes.
  const canSave = isNew ? !!key.trim() : changed || !!ttl.trim();
  const ttlValid = !ttl.trim() || (/^\d+$/.test(ttl) && Number(ttl) >= 60);

  // Drop cached values rather than refetching them: the editor is about to
  // close, and refetching a key that was just deleted would only 404.
  const refresh = async () => {
    qc.removeQueries({ queryKey: ["admin-kv-entry", ns], type: "inactive" });
    await qc.invalidateQueries({ queryKey: ["admin-kv-keys", ns] });
    await qc.invalidateQueries({
      queryKey: ["admin-kv-entry", ns],
      refetchType: "none",
    });
  };

  const save = async () => {
    if (busy || !key.trim()) return;
    const preview =
      current.length > 400 ? `${current.slice(0, 400)}…` : current;
    const ok = await confirm({
      title: isNew
        ? t("admin.kvConfirmNewTitle")
        : t("admin.kvConfirmSaveTitle"),
      body: (
        <>
          <Text block className={styles.key}>
            {key}
          </Text>
          <Text block style={{ marginTop: 8 }}>
            {ttl.trim()
              ? t("admin.kvConfirmSaveBodyTtl", {
                  namespace: ns,
                  seconds: Number(ttl),
                })
              : t("admin.kvConfirmSaveBody", { namespace: ns })}
          </Text>
          <pre className={styles.preview}>
            {preview || t("admin.kvEmptyValue")}
          </pre>
        </>
      ),
      confirmLabel: t("common.save"),
    });
    if (!ok) return;
    setBusy("save");
    try {
      await api.adminKvPut(ns, key, current, ttl.trim() ? Number(ttl) : null);
      await refresh();
      showMsg("success", t("admin.kvWrittenDone"));
      onDone();
    } catch (err) {
      showMsg("error", apiErrorText(err, t("common.saveFailed")));
      setBusy(null);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: entry?.protected
        ? t("admin.kvRotateTitle")
        : t("admin.kvDeleteTitle"),
      body: (
        <>
          <Text block className={styles.key}>
            {key}
          </Text>
          <Text block style={{ marginTop: 8 }}>
            {entry?.protected
              ? t("admin.kvRotateBody")
              : t("admin.kvDeleteBody", { namespace: ns })}
          </Text>
        </>
      ),
      confirmLabel: entry?.protected ? t("admin.kvRotate") : t("common.delete"),
    });
    if (!ok) return;
    setBusy("delete");
    try {
      await api.adminKvDelete(ns, key);
      await refresh();
      showMsg("success", t("common.deletedDone"));
      onDone();
    } catch (err) {
      showMsg("error", apiErrorText(err, t("common.error")));
      setBusy(null);
    }
  };

  if (!isNew && !entry && !error) return <SkeletonSettingsCard rows={3} form />;

  const editable = writable && !entry?.protected;

  return (
    <SettingsCard
      title={isNew ? t("admin.kvNewKey") : key}
      description={
        isNew
          ? t("admin.kvNewKeyDesc", { namespace: ns })
          : t("admin.kvKeyIn", { namespace: ns })
      }
      badge={
        entry?.protected ? (
          <Badge
            appearance="tint"
            color="warning"
            size="small"
            icon={<LockClosedRegular />}
          >
            {t("admin.kvProtected")}
          </Badge>
        ) : undefined
      }
    >
      <SettingsBody>
        {error ? (
          <MessageBar intent="error">
            {apiErrorText(error, t("common.error"))}
          </MessageBar>
        ) : entry?.protected ? (
          <MessageBar intent="warning">
            {t("admin.kvProtectedReason")}
          </MessageBar>
        ) : (
          <>
            {entry && !entry.exists && (
              <MessageBar intent="info">{t("admin.kvGone")}</MessageBar>
            )}
            {isNew && (
              <Field label={t("admin.kvKeyHeader")} required>
                <Input
                  className={styles.mono}
                  autoFocus
                  value={key}
                  onChange={(_, d) => setKey(d.value)}
                />
              </Field>
            )}
            <Field label={t("admin.kvValueLabel")}>
              <Textarea
                className={styles.value}
                resize="vertical"
                readOnly={!editable}
                value={current}
                onChange={(_, d) => setValue(d.value)}
              />
            </Field>
            {editable && (
              <Field
                label={t("admin.kvTtlLabel")}
                {...(ttlValid
                  ? { hint: t("admin.kvTtlHint") }
                  : {
                      validationState: "error" as const,
                      validationMessage: t("admin.kvTtlInvalid"),
                    })}
              >
                <Input
                  type="number"
                  min={60}
                  value={ttl}
                  onChange={(_, d) => setTtl(d.value)}
                />
              </Field>
            )}
          </>
        )}
      </SettingsBody>
      <SettingsFooter>
        {writable && !isNew && entry?.exists && (
          <div className={styles.footerStart}>
            <Button
              icon={<DeleteRegular />}
              className={styles.danger}
              disabled={busy !== null}
              onClick={() => void remove()}
            >
              {busy === "delete" ? (
                <Spinner size="tiny" />
              ) : entry.protected ? (
                t("admin.kvRotate")
              ) : (
                t("common.delete")
              )}
            </Button>
          </div>
        )}
        <Button disabled={busy !== null} onClick={onDone}>
          {editable ? t("common.cancel") : t("common.close")}
        </Button>
        {editable && (
          <Button
            appearance="primary"
            disabled={busy !== null || !canSave || !ttlValid}
            onClick={() => void save()}
          >
            {busy === "save" ? <Spinner size="tiny" /> : t("common.save")}
          </Button>
        )}
      </SettingsFooter>
      {confirmDialog}
    </SettingsCard>
  );
}

export function AdminKvBrowser({ showMsg }: { showMsg: ShowMsg }) {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();

  const [ns, setNs] = useState("sessions");
  // KV pages with an opaque cursor rather than an offset, so "back" is a
  // stack of the cursors already seen rather than arithmetic.
  const [cursors, setCursors] = useState<string[]>([]);
  const {
    query,
    setQuery,
    search: prefix,
  } = useDebouncedSearch(() => setCursors([]));
  const [open, setOpen] = useState<{ key: string; isNew: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ["admin-kv-status"],
    queryFn: () => api.adminKvStatus(),
  });
  // KV_CONSOLE is allowed to differ from D1_CONSOLE, so this reads its own
  // mode rather than inheriting the database view's. Assume writable until
  // told otherwise so the controls don't flicker in; the server refuses the
  // write either way.
  const writable = status.data?.writable ?? true;
  const namespaces = status.data?.namespaces ?? [
    { key: "sessions" },
    { key: "cache" },
  ];

  const cursor = cursors[cursors.length - 1];
  const queryKey = ["admin-kv-keys", ns, prefix, cursor ?? ""];
  const { data, isFetching, error } = useQuery({
    queryKey,
    queryFn: () => api.adminKvKeys(ns, { prefix: prefix || undefined, cursor }),
    retry: false,
  });
  const keys = data?.keys ?? [];

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["admin-kv-keys", ns] });

  const remove = async (key: string) => {
    const ok = await confirm({
      title: t("admin.kvDeleteTitle"),
      body: (
        <>
          <Text block className={styles.key}>
            {key}
          </Text>
          <Text block style={{ marginTop: 8 }}>
            {t("admin.kvDeleteBody", { namespace: ns })}
          </Text>
        </>
      ),
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    setBusy(key);
    try {
      await api.adminKvDelete(ns, key);
      await refresh();
      showMsg("success", t("common.deletedDone"));
    } catch (err) {
      showMsg("error", apiErrorText(err, t("common.error")));
    } finally {
      setBusy(null);
    }
  };

  const purge = async () => {
    const ok = await confirm({
      title: t("admin.kvPurgeTitle"),
      body: t("admin.kvPurgeBody", { prefix, namespace: ns }),
      confirmLabel: t("admin.kvPurgeConfirm"),
    });
    if (!ok) return;
    setBusy("purge");
    try {
      const res = await api.adminKvPurge(ns, prefix);
      await refresh();
      showMsg(
        "success",
        t("admin.kvPurged", {
          deleted: res.deleted,
          skipped: res.skipped_protected,
        }) + (res.more ? ` ${t("admin.kvPurgeMore")}` : ""),
      );
    } catch (err) {
      showMsg("error", apiErrorText(err, t("common.error")));
    } finally {
      setBusy(null);
    }
  };

  if (open)
    return (
      <div className={styles.pane}>
        <KeyEditor
          key={`${ns}:${open.key}:${open.isNew}`}
          ns={ns}
          initialKey={open}
          writable={writable}
          showMsg={showMsg}
          onDone={() => setOpen(null)}
        />
      </div>
    );

  const columns: DataListColumn[] = [
    { label: t("admin.kvKeyHeader"), width: "minmax(0, 3fr)" },
    {
      label: t("admin.kvExpiresHeader"),
      width: "minmax(0, 1fr)",
      secondary: true,
    },
    ...(writable ? [{ label: "", width: "32px", end: true }] : []),
  ];

  return (
    <div className={styles.pane}>
      <div className={styles.head}>
        <div className={styles.ns}>
          <Select
            aria-label={t("admin.kvNamespace")}
            value={ns}
            onChange={(_, d) => {
              setNs(d.value);
              setCursors([]);
            }}
          >
            {namespaces.map((n) => (
              <option key={n.key} value={n.key}>
                {n.key}
              </option>
            ))}
          </Select>
        </div>
        <Text size={200} className={styles.muted}>
          {t(`admin.kvNamespaceDesc.${ns}`, { defaultValue: "" })}
        </Text>
      </div>

      <ListSearch
        value={query}
        onChange={setQuery}
        placeholder={t("admin.kvPrefixPlaceholder")}
      >
        <Button
          icon={<ArrowClockwiseRegular />}
          aria-label={t("common.refresh")}
          onClick={() => void qc.invalidateQueries({ queryKey })}
        />
        {writable && prefix && (
          <Button
            icon={<DeleteRegular />}
            className={styles.danger}
            disabled={busy !== null}
            onClick={() => void purge()}
          >
            {busy === "purge" ? (
              <Spinner size="tiny" />
            ) : (
              t("admin.kvPurgePrefix")
            )}
          </Button>
        )}
        {writable && (
          <Button
            icon={<AddRegular />}
            appearance="primary"
            onClick={() => setOpen({ key: prefix, isNew: true })}
          >
            {t("admin.kvNewKey")}
          </Button>
        )}
      </ListSearch>

      {error ? (
        <MessageBar intent="error">
          {apiErrorText(error, t("common.error"))}
        </MessageBar>
      ) : isFetching && !data ? (
        <DataListSkeleton columns={columns} rows={4} />
      ) : keys.length === 0 ? (
        <EmptyState
          icon={<KeyRegular />}
          title={prefix ? t("admin.kvNoKeys") : t("admin.kvEmpty")}
        />
      ) : (
        <DataList columns={columns}>
          {keys.map((row) => (
            <DataListRow
              key={row.name}
              onClick={() => setOpen({ key: row.name, isNew: false })}
              cells={[
                <DataListName
                  key="k"
                  name={<span className={styles.key}>{row.name}</span>}
                  badges={
                    row.protected && (
                      <Badge
                        appearance="tint"
                        color="warning"
                        size="small"
                        icon={<LockClosedRegular />}
                      >
                        {t("admin.kvProtected")}
                      </Badge>
                    )
                  }
                />,
                row.expiration
                  ? formatDateTime(row.expiration)
                  : t("admin.kvNoExpiry"),
                ...(writable
                  ? [
                      <span key="del" onClick={(e) => e.stopPropagation()}>
                        {busy === row.name ? (
                          <Spinner size="tiny" />
                        ) : (
                          !row.protected && (
                            <Button
                              size="small"
                              appearance="subtle"
                              icon={<DeleteRegular />}
                              className={styles.danger}
                              aria-label={t("admin.kvDeleteFor", {
                                key: row.name,
                              })}
                              disabled={busy !== null}
                              onClick={() => void remove(row.name)}
                            />
                          )
                        )}
                      </span>,
                    ]
                  : []),
              ]}
            />
          ))}
        </DataList>
      )}

      {(cursors.length > 0 || data?.cursor) && (
        <div className={styles.pager}>
          {isFetching && <Spinner size="tiny" />}
          <Button
            size="small"
            appearance="subtle"
            icon={<ChevronLeftRegular />}
            disabled={cursors.length === 0 || isFetching}
            onClick={() => setCursors((prev) => prev.slice(0, -1))}
          >
            {t("common.previous")}
          </Button>
          <Button
            size="small"
            appearance="subtle"
            icon={<ChevronRightRegular />}
            iconPosition="after"
            disabled={!data?.cursor || isFetching}
            onClick={() =>
              data?.cursor && setCursors((prev) => [...prev, data.cursor!])
            }
          >
            {t("common.next")}
          </Button>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
