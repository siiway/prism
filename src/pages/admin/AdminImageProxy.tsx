// Admin image proxy: how proxied images are cached, and every URL the proxy
// is willing to fetch and serve, with who added it and what uses it.
// Removing one stops the proxy serving that URL until something adds it
// again (e.g. someone pasted a tracking pixel into a README).

import {
  Button,
  Field,
  Input,
  Skeleton,
  SkeletonItem,
  Spinner,
  Subtitle2,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  BroomRegular,
  DeleteRegular,
  ImageRegular,
  OpenRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../lib/api";
import type { SiteConfig } from "../../types";
import { useApi } from "../../lib/api-context";
import { CheckboxField } from "../../components/CheckboxField";
import { formatBytes } from "../../lib/bytes";
import { formatDate } from "../../lib/datetime";
import { useConfirm } from "../../lib/useConfirm";
import { useDebouncedSearch } from "../../lib/useDebouncedSearch";
import { usePageClamp } from "../../lib/usePageClamp";
import { useToastMessage } from "../../lib/useToastMessage";
import {
  DataList,
  DataListName,
  DataListRow,
  type DataListColumn,
} from "../../components/DataList";
import { EmptyState } from "../../components/EmptyState";
import { ListSearch } from "../../components/ListSearch";
import { Pagination } from "../../components/Pagination";
import { Select } from "../../components/Select";
import {
  SettingsBody,
  SettingsCard,
  SettingsFooter,
  SettingsToast,
} from "../../components/Settings";
import { SkeletonSettingsCard } from "../../components/Skeletons";

const PAGE_SIZE = 50;

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "20px", flex: 1 },
  toast: { position: "sticky", top: "8px", zIndex: 2 },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    alignItems: "start",
    gap: "16px",
    "@media (max-width: 600px)": { gridTemplateColumns: "1fr" },
  },
  listHead: {
    display: "flex",
    alignItems: "baseline",
    gap: "8px",
    flexWrap: "wrap",
    marginBottom: "12px",
  },
  muted: { color: tokens.colorNeutralForeground3 },
  filter: { flex: "0 1 220px", minWidth: "180px" },
  url: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    maxWidth: "100%",
    color: tokens.colorNeutralForeground1,
    textDecorationLine: "none",
    ":hover": { textDecorationLine: "underline" },
  },
  urlText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  mono: { fontFamily: tokens.fontFamilyMonospace },
  creator: {
    padding: 0,
    fontSize: tokens.fontSizeBase300,
    minWidth: 0,
    height: "auto",
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground2,
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    justifyContent: "flex-start",
  },
  danger: { color: tokens.colorPaletteRedForeground1 },
});

type CacheMode = SiteConfig["avatar_proxy_cache_mode"];

interface CacheForm {
  mode: CacheMode;
  ttl: string;
  source: string;
  cache: string;
  webp: boolean;
}

function formFromConfig(c: SiteConfig): CacheForm {
  return {
    mode: c.avatar_proxy_cache_mode,
    ttl: String(c.avatar_proxy_cache_ttl_seconds),
    source: String(c.avatar_proxy_max_source_bytes),
    cache: String(c.avatar_proxy_max_cache_bytes),
    webp: c.avatar_proxy_convert_to_webp,
  };
}

const positive = (v: string) => /^\d+$/.test(v.trim()) && Number(v) > 0;

/** The cache settings, saved together. */
function CacheCard() {
  const api = useApi();
  const styles = useStyles();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { message, showMsg } = useToastMessage();

  const { data: configData } = useQuery({
    queryKey: ["admin-config"],
    queryFn: api.adminConfig,
  });
  const { data: status } = useQuery({
    queryKey: ["admin-image-proxy-status"],
    queryFn: api.adminImageProxyStatus,
  });

  const [edits, setEdits] = useState<Partial<CacheForm>>({});
  const [saving, setSaving] = useState(false);

  const config = configData?.config;
  if (!config) return <SkeletonSettingsCard rows={4} form />;
  const saved = formFromConfig(config);
  const form: CacheForm = { ...saved, ...edits };
  const set = (patch: Partial<CacheForm>) =>
    setEdits((e) => ({ ...e, ...patch }));

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const errors = {
    ttl: positive(form.ttl) ? undefined : t("admin.imageProxyPositive"),
    source: positive(form.source) ? undefined : t("admin.imageProxyPositive"),
    cache: positive(form.cache) ? undefined : t("admin.imageProxyPositive"),
  };
  const valid = !errors.ttl && !errors.source && !errors.cache;
  const sizeHint = (v: string, fallback: string) =>
    positive(v) ? formatBytes(Number(v)) : fallback;

  const save = async () => {
    if (saving || !dirty || !valid) return;
    setSaving(true);
    // What was sent, so edits typed while the request is in flight survive.
    const sent = { ...form };
    try {
      await api.adminUpdateConfig({
        avatar_proxy_cache_mode: form.mode,
        avatar_proxy_cache_ttl_seconds: Number(form.ttl),
        avatar_proxy_max_source_bytes: Number(form.source),
        avatar_proxy_max_cache_bytes: Number(form.cache),
        avatar_proxy_convert_to_webp: form.webp,
      });
      await qc.invalidateQueries({ queryKey: ["admin-config"] });
      await qc.invalidateQueries({ queryKey: ["admin-image-proxy-status"] });
      setEdits((e) => {
        const next = { ...e };
        for (const k of Object.keys(sent) as (keyof CacheForm)[])
          if (next[k] === sent[k]) delete next[k];
        return next;
      });
      showMsg("success", t("admin.imageProxyCacheSaved"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const field = (error: string | undefined, hint: string) =>
    error
      ? { validationState: "error" as const, validationMessage: error }
      : { hint };

  return (
    <>
      {message && (
        <div className={styles.toast}>
          <SettingsToast message={message} />
        </div>
      )}
      <SettingsCard
        id="cache"
        title={t("admin.imageProxyCacheTitle")}
        description={
          !status
            ? t("admin.imageProxyCacheDesc")
            : status.cached
              ? t("admin.imageProxyStats", {
                  mapped: status.mapped,
                  cached: status.cached,
                  size: formatBytes(status.cached_bytes),
                })
              : t("admin.imageProxyStatsNoCache", { mapped: status.mapped })
        }
      >
        <SettingsBody>
          <div className={styles.grid}>
            <Field
              label={t("admin.avatarProxyCacheMode")}
              hint={t(`admin.imageProxyCacheModeHint_${form.mode}`)}
            >
              <Select
                value={form.mode}
                onChange={(_, d) => set({ mode: d.value as CacheMode })}
              >
                <option value="off">{t("admin.avatarProxyCacheOff")}</option>
                <option value="kv">KV</option>
                <option value="d1">D1</option>
              </Select>
            </Field>
            <Field
              label={t("admin.avatarProxyTtl")}
              {...field(errors.ttl, t("admin.imageProxyTtlHint"))}
            >
              <Input
                type="number"
                min={1}
                value={form.ttl}
                disabled={form.mode === "off"}
                onChange={(_, d) => set({ ttl: d.value })}
              />
            </Field>
            <Field
              label={t("admin.avatarProxySourceLimit")}
              {...field(
                errors.source,
                sizeHint(form.source, t("admin.imageProxySourceHint")),
              )}
            >
              <Input
                type="number"
                min={1}
                value={form.source}
                onChange={(_, d) => set({ source: d.value })}
              />
            </Field>
            <Field
              label={t("admin.avatarProxyCacheLimit")}
              {...field(
                errors.cache,
                sizeHint(form.cache, t("admin.imageProxyCacheLimitHint")),
              )}
            >
              <Input
                type="number"
                min={1}
                value={form.cache}
                disabled={form.mode === "off"}
                onChange={(_, d) => set({ cache: d.value })}
              />
            </Field>
          </div>
          <CheckboxField
            label={t("admin.avatarProxyConvertWebp")}
            hint={t("admin.imageProxyWebpHint")}
            checked={form.webp}
            disabled={!status?.images_binding}
            onChange={(webp) => set({ webp })}
          />
        </SettingsBody>
        <SettingsFooter>
          {dirty && !saving && (
            <Button appearance="subtle" onClick={() => setEdits({})}>
              {t("common.discard")}
            </Button>
          )}
          <Button
            appearance="primary"
            disabled={!dirty || !valid || saving}
            onClick={() => void save()}
          >
            {saving ? <Spinner size="tiny" /> : t("common.saveChanges")}
          </Button>
        </SettingsFooter>
      </SettingsCard>
    </>
  );
}

/** Who added a mapping, as the filter takes it. */
interface Creator {
  id: string;
  label: string;
}

function Mappings() {
  const api = useApi();
  const styles = useStyles();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { message, showMsg } = useToastMessage();
  const { confirm, confirmDialog } = useConfirm();

  const [page, setPage] = useState(1);
  const { query, setQuery, search } = useDebouncedSearch(() => setPage(1));
  // "" = anyone, "system" = added automatically, otherwise a user picked
  // from a row.
  const [creator, setCreator] = useState<Creator | null>(null);
  const [systemOnly, setSystemOnly] = useState(false);
  const createdBy = creator?.id ?? (systemOnly ? "system" : "");

  const { data, isFetching } = useQuery({
    queryKey: ["admin-image-proxy", page, search, createdBy],
    queryFn: () =>
      api.adminListImageProxy(page, {
        q: search || undefined,
        created_by: createdBy || undefined,
        limit: PAGE_SIZE,
      }),
  });
  const mappings = data?.mappings ?? [];
  const total = data?.total ?? 0;
  usePageClamp(page, data?.total, PAGE_SIZE, setPage);

  const [busy, setBusy] = useState<string | null>(null);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["admin-image-proxy"] });
    await qc.invalidateQueries({ queryKey: ["admin-image-proxy-status"] });
  };

  const remove = async (id: string, url: string) => {
    const ok = await confirm({
      title: t("admin.imageProxyDeleteTitle"),
      body: (
        <>
          <Text block className={styles.mono}>
            {url}
          </Text>
          <Text block style={{ marginTop: 8 }}>
            {t("admin.imageProxyDeleteConfirm")}
          </Text>
        </>
      ),
      confirmLabel: t("admin.imageProxyDelete"),
    });
    if (!ok) return;
    setBusy(id);
    try {
      await api.adminDeleteImageProxy(id);
      await refresh();
      showMsg("success", t("admin.imageProxyDeleted"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError
          ? err.message
          : t("admin.imageProxyDeleteFailed"),
      );
    } finally {
      setBusy(null);
    }
  };

  const sweep = async () => {
    const ok = await confirm({
      title: t("admin.imageProxySweepTitle"),
      body: t("admin.imageProxySweepHint"),
      confirmLabel: t("admin.imageProxySweepButton"),
    });
    if (!ok) return;
    setBusy("sweep");
    try {
      const res = await api.adminSweepImageProxy();
      await refresh();
      showMsg(
        "success",
        t("admin.imageProxySweepSuccess", { count: res.deleted }),
      );
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError
          ? err.message
          : t("admin.imageProxySweepFailed"),
      );
    } finally {
      setBusy(null);
    }
  };

  const filterValue = creator ? "user" : systemOnly ? "system" : "";
  const filterBy = (next: Creator | null, system = false) => {
    setCreator(next);
    setSystemOnly(system);
    setPage(1);
  };

  const columns: DataListColumn[] = [
    { label: t("admin.imageProxyUrlHeader"), width: "minmax(0, 2.4fr)" },
    {
      label: t("admin.avatarProxyResourcesHeader"),
      width: "minmax(0, 1.2fr)",
      secondary: true,
    },
    {
      label: t("admin.imageProxyCreatorHeader"),
      width: "minmax(0, 1fr)",
      secondary: true,
    },
    {
      label: t("admin.imageProxyCreatedAtHeader"),
      width: "100px",
      secondary: true,
    },
    { label: "", width: "32px", end: true },
  ];

  return (
    <section>
      {message && (
        <div className={styles.toast} style={{ marginBottom: 12 }}>
          <SettingsToast message={message} />
        </div>
      )}
      <div className={styles.listHead}>
        <Subtitle2 as="h2">{t("admin.imageProxyListTitle")}</Subtitle2>
        {data && (
          <Text size={200} className={styles.muted}>
            {t("admin.imageProxyTotal", { count: total })}
          </Text>
        )}
      </div>

      <ListSearch
        value={query}
        onChange={setQuery}
        placeholder={t("admin.imageProxySearchPlaceholder")}
      >
        <div className={styles.filter}>
          <Select
            aria-label={t("admin.imageProxyCreatorHeader")}
            value={filterValue}
            onChange={(_, d) => filterBy(null, d.value === "system")}
          >
            <option value="">{t("admin.imageProxyByAnyone")}</option>
            <option value="system">{t("admin.imageProxyBySystem")}</option>
            {creator && (
              <option value="user">
                {t("admin.imageProxyByUser", { name: creator.label })}
              </option>
            )}
          </Select>
        </div>
        <Button
          icon={<BroomRegular />}
          disabled={busy !== null}
          onClick={() => void sweep()}
        >
          {busy === "sweep" ? (
            <Spinner size="tiny" />
          ) : (
            t("admin.imageProxySweepButton")
          )}
        </Button>
      </ListSearch>

      {isFetching && !data ? (
        <Skeleton aria-busy>
          <DataList columns={columns}>
            {Array.from({ length: 4 }).map((_, i) => (
              <DataListRow
                key={i}
                cells={columns.map((_, c) => (
                  <SkeletonItem key={c} size={12} style={{ width: "60%" }} />
                ))}
              />
            ))}
          </DataList>
        </Skeleton>
      ) : mappings.length === 0 ? (
        <EmptyState
          icon={<ImageRegular />}
          title={
            search || createdBy
              ? t("admin.imageProxyNoResults")
              : t("admin.imageProxyEmpty")
          }
        />
      ) : (
        <>
          <DataList columns={columns}>
            {mappings.map((m) => {
              const who = m.created_by
                ? m.created_by_username
                  ? `@${m.created_by_username}`
                  : (m.created_by_display_name ?? m.created_by)
                : null;
              return (
                <DataListRow
                  key={m.id}
                  cells={[
                    <DataListName
                      key="url"
                      name={
                        <Tooltip content={m.url} relationship="label">
                          <a
                            href={`/api/proxy/image/${m.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.url}
                          >
                            <span className={styles.urlText}>{m.url}</span>
                            <OpenRegular aria-hidden />
                          </a>
                        </Tooltip>
                      }
                      sub={<span className={styles.mono}>{m.id}</span>}
                    />,
                    m.resources.length
                      ? m.resources
                          .map((r) =>
                            t(`admin.imageProxyUsedBy_${r.type}`, {
                              name: r.name,
                              defaultValue: `${r.type}: ${r.name}`,
                            }),
                          )
                          .join(", ")
                      : t("admin.avatarProxyNoResources"),
                    who ? (
                      <Tooltip
                        key="who"
                        content={t("admin.imageProxyFilterBy", { name: who })}
                        relationship="label"
                      >
                        <Button
                          appearance="transparent"
                          size="small"
                          className={styles.creator}
                          onClick={() =>
                            filterBy({ id: m.created_by!, label: who })
                          }
                        >
                          {who}
                        </Button>
                      </Tooltip>
                    ) : (
                      <span key="who" className={styles.muted}>
                        {t("admin.imageProxySystemRow")}
                      </span>
                    ),
                    formatDate(m.created_at),
                    busy === m.id ? (
                      <Spinner key="del" size="tiny" />
                    ) : (
                      <Button
                        key="del"
                        size="small"
                        appearance="subtle"
                        icon={<DeleteRegular />}
                        className={styles.danger}
                        aria-label={t("admin.imageProxyDeleteFor", {
                          url: m.url,
                        })}
                        disabled={busy !== null}
                        onClick={() => void remove(m.id, m.url)}
                      />
                    ),
                  ]}
                />
              );
            })}
          </DataList>
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
      {confirmDialog}
    </section>
  );
}

export function AdminImageProxy() {
  const styles = useStyles();
  return (
    <div className={styles.root}>
      <CacheCard />
      <Mappings />
    </div>
  );
}
