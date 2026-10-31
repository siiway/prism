// Reusable audit-log panel (Transparent Control).
//
// One component powers every scope; the `base` prop selects the API scope
// ("me", `team/<id>`, `user/<id>` or "platform"). A toolbar filters by time
// range and action; each row opens the full event, where it can also narrow
// the log to the same action, actor or resource. "Webhooks" swaps to the
// webhook manager.

import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MessageBar,
  Option,
  Skeleton,
  SkeletonItem,
  Spinner,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowDownloadRegular,
  ChevronRightRegular,
  DismissRegular,
  PlugConnectedRegular,
} from "@fluentui/react-icons";
import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, type AuditEvent } from "../lib/api";
import { useApi } from "../lib/api-context";
import { maskIp, parseClient } from "../lib/auditFormat";
import { formatIpGeo } from "../lib/geo";
import { AuditWebhooks } from "./AuditWebhooks";
import { Pagination } from "./Pagination";

const NARROW = "@media (max-width: 768px)";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "12px", flex: 1 },
  // Filters wrap among themselves; Export and Webhooks stay top-right.
  toolbar: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px 16px",
    flexWrap: "wrap",
  },
  filterGroup: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
    flex: "1 1 320px",
    minWidth: 0,
  },
  toolGroup: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexShrink: 0,
  },
  range: { minWidth: "0", width: "170px" },
  actionFilter: { minWidth: "0", width: "220px" },
  dateInput: { width: "210px" },
  chip: {
    fontWeight: tokens.fontWeightRegular,
    maxWidth: "260px",
  },
  chipText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  card: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusXLarge,
    background: tokens.colorNeutralBackground1,
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: tokens.fontSizeBase300,
  },
  th: {
    textAlign: "left",
    padding: "10px 16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightRegular,
    whiteSpace: "nowrap",
  },
  row: {
    cursor: "pointer",
    ":hover": { background: tokens.colorNeutralBackground1Hover },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "-2px",
    },
    ":not(:last-child) > td": {
      borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
  },
  td: {
    padding: "10px 16px",
    verticalAlign: "middle",
  },
  skeletonRow: {
    height: "43px",
    ":not(:last-child) > td": {
      borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
  },
  time: {
    whiteSpace: "nowrap",
    color: tokens.colorNeutralForeground3,
    fontVariantNumeric: "tabular-nums",
  },
  action: {
    display: "inline-block",
    padding: "1px 6px",
    borderRadius: tokens.borderRadiusSmall,
    background: tokens.colorNeutralBackground3,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "nowrap",
  },
  truncate: {
    display: "block",
    maxWidth: "240px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  muted: { color: tokens.colorNeutralForeground3 },
  hideNarrow: { [NARROW]: { display: "none" } },
  chevronCell: {
    width: "32px",
    padding: "10px 12px 10px 0",
    color: tokens.colorNeutralForeground3,
    fontSize: "12px",
  },
  message: {
    padding: "28px 16px",
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
  inspectGrid: {
    display: "grid",
    gridTemplateColumns: "max-content minmax(0, 1fr)",
    columnGap: "16px",
    rowGap: "8px",
    alignItems: "start",
  },
  inspectValue: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    overflowWrap: "anywhere",
  },
  metadata: {
    margin: 0,
    padding: "12px",
    background: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    overflowX: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  },
  sameRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "6px",
  },
});

// datetime-local string <-> unix seconds
function toUnix(local: string): number | undefined {
  if (!local) return undefined;
  const ms = new Date(local).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

type Range = "all" | "24h" | "7d" | "30d" | "custom";
const RANGE_SECONDS: Partial<Record<Range, number>> = {
  "24h": 86_400,
  "7d": 7 * 86_400,
  "30d": 30 * 86_400,
};
const RANGES: Range[] = ["all", "24h", "7d", "30d", "custom"];

interface Filters {
  from: string;
  to: string;
  /** Preset ranges resolve against "now" when the query runs. Absent
   *  means all time, so the default filters stay `{ from: "", to: "" }`
   *  and share their cache entry with the admin overview. */
  range?: Exclude<Range, "all">;
  action?: string;
  actorId?: string;
  actorLabel?: string;
  resourceType?: string;
  resourceId?: string;
  resourceLabel?: string;
}

function queryBounds(f: Filters): { from?: number; to?: number } {
  const preset = f.range ? RANGE_SECONDS[f.range] : undefined;
  if (preset) return { from: Math.floor(Date.now() / 1000) - preset };
  if (f.range === "custom") return { from: toUnix(f.from), to: toUnix(f.to) };
  return {};
}

function shortDateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resourceText(ev: AuditEvent): string | null {
  if (ev.resource_name) return ev.resource_name;
  if (!ev.resource_type && !ev.resource_id) return null;
  return `${ev.resource_type ?? ""}${ev.resource_id ? ` ${ev.resource_id.slice(0, 8)}` : ""}`.trim();
}

export function AuditLog({ base }: { base: string }) {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>({ from: "", to: "" });
  const [inspect, setInspect] = useState<AuditEvent | null>(null);
  const [showWebhooks, setShowWebhooks] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["audit-events", base, page, filters],
    queryFn: () =>
      api.auditEvents(base, {
        ...queryBounds(filters),
        action: filters.action,
        actor_id: filters.actorId,
        resource_type: filters.resourceType,
        resource_id: filters.resourceId,
        page,
      }),
  });

  const events = data?.events ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / 50)) : 1;
  const range: Range = filters.range ?? "all";
  const hasFilters =
    range !== "all" ||
    !!filters.action ||
    !!filters.actorId ||
    !!filters.resourceType ||
    !!filters.resourceId;

  const setFilter = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };
  const clearFilters = () => {
    setFilters({ from: "", to: "" });
    setPage(1);
  };
  const setRange = (next: Range) =>
    setFilter({
      range: next === "all" ? undefined : next,
      ...(next === "custom" ? {} : { from: "", to: "" }),
    });

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const runExport = async (format: "csv" | "json") => {
    setExporting(true);
    setExportError(null);
    try {
      await api.auditExport(base, format, {
        ...queryBounds(filters),
        action: filters.action,
        actor_id: filters.actorId,
        resource_type: filters.resourceType,
        resource_id: filters.resourceId,
      });
    } catch (err) {
      setExportError(
        err instanceof ApiError ? err.message : t("audit.exportFailed"),
      );
    } finally {
      setExporting(false);
    }
  };

  if (showWebhooks) {
    return <AuditWebhooks base={base} onBack={() => setShowWebhooks(false)} />;
  }

  const rangeLabel = (r: Range) => t(`audit.range.${r}`);

  const chip = (label: string, onDismiss: () => void) => (
    <Button
      size="small"
      shape="circular"
      className={styles.chip}
      icon={<DismissRegular />}
      iconPosition="after"
      onClick={onDismiss}
      title={label}
    >
      <span className={styles.chipText}>{label}</span>
    </Button>
  );

  const filterSame = (ev: AuditEvent, by: "action" | "actor" | "resource") => {
    if (by === "action") setFilter({ action: ev.action });
    if (by === "actor")
      setFilter({
        actorId: ev.actor_id ?? undefined,
        actorLabel: ev.actor_name ?? ev.actor_id?.slice(0, 8),
      });
    if (by === "resource")
      setFilter({
        resourceType: ev.resource_type ?? undefined,
        resourceId: ev.resource_id ?? undefined,
        resourceLabel: resourceText(ev) ?? undefined,
      });
    setInspect(null);
  };

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.filterGroup}>
          <Dropdown
            size="small"
            className={styles.range}
            aria-label={t("audit.rangeLabel")}
            value={rangeLabel(range)}
            selectedOptions={[range]}
            onOptionSelect={(_, d) =>
              setRange((d.optionValue ?? "all") as Range)
            }
          >
            {RANGES.map((r) => (
              <Option key={r} value={r}>
                {rangeLabel(r)}
              </Option>
            ))}
          </Dropdown>
          {range === "custom" && (
            <>
              <Input
                size="small"
                type="datetime-local"
                className={styles.dateInput}
                aria-label={t("audit.from")}
                value={filters.from}
                onChange={(e) => setFilter({ from: e.target.value })}
              />
              <Text size={200} className={styles.muted}>
                –
              </Text>
              <Input
                size="small"
                type="datetime-local"
                className={styles.dateInput}
                aria-label={t("audit.to")}
                value={filters.to}
                onChange={(e) => setFilter({ to: e.target.value })}
              />
            </>
          )}
          <Dropdown
            size="small"
            className={styles.actionFilter}
            aria-label={t("audit.action")}
            value={filters.action ?? t("audit.allActions")}
            selectedOptions={filters.action ? [filters.action] : [""]}
            onOptionSelect={(_, d) =>
              setFilter({ action: d.optionValue || undefined })
            }
          >
            <Option value="">{t("audit.allActions")}</Option>
            {(data?.actions ?? []).map((a) => (
              <Option key={a} value={a}>
                {a}
              </Option>
            ))}
          </Dropdown>
          {filters.actorId &&
            chip(
              `${t("audit.actor")}: ${filters.actorLabel ?? filters.actorId.slice(0, 8)}`,
              () => setFilter({ actorId: undefined, actorLabel: undefined }),
            )}
          {(filters.resourceId || filters.resourceType) &&
            chip(
              `${t("audit.resource")}: ${filters.resourceLabel ?? filters.resourceType ?? ""}`,
              () =>
                setFilter({
                  resourceType: undefined,
                  resourceId: undefined,
                  resourceLabel: undefined,
                }),
            )}
          {hasFilters && (
            <Button size="small" appearance="subtle" onClick={clearFilters}>
              {t("audit.clearFilters")}
            </Button>
          )}
        </div>
        <div className={styles.toolGroup}>
          {/* Exports what the filters currently select, not the whole log —
            otherwise the file and the table on screen disagree. */}
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <Button
                size="small"
                icon={
                  exporting ? <Spinner size="tiny" /> : <ArrowDownloadRegular />
                }
                disabled={exporting}
              >
                {t("audit.export")}
              </Button>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem onClick={() => runExport("csv")}>CSV</MenuItem>
                <MenuItem onClick={() => runExport("json")}>JSON</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
          <Button
            size="small"
            icon={<PlugConnectedRegular />}
            onClick={() => setShowWebhooks(true)}
          >
            {t("audit.webhooksTitle")}
          </Button>
        </div>
      </div>
      {exportError && <MessageBar intent="error">{exportError}</MessageBar>}

      <div className={styles.card}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>{t("audit.colTime")}</th>
              <th className={styles.th}>{t("audit.colAction")}</th>
              <th className={mergeClasses(styles.th, styles.hideNarrow)}>
                {t("audit.colActor")}
              </th>
              <th className={styles.th}>{t("audit.colResource")}</th>
              <th className={mergeClasses(styles.th, styles.hideNarrow)}>
                {t("audit.colSource")}
              </th>
              <th className={styles.th} aria-hidden />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className={styles.skeletonRow} aria-hidden>
                  {[20, 26, 16, 30, 22].map((w, j) => (
                    <td
                      key={j}
                      className={mergeClasses(
                        styles.td,
                        (j === 2 || j === 4) && styles.hideNarrow,
                      )}
                    >
                      <Skeleton>
                        <SkeletonItem
                          size={12}
                          style={{ width: `${w + ((i * 7 + j * 3) % 5) * 6}%` }}
                        />
                      </Skeleton>
                    </td>
                  ))}
                  <td className={styles.chevronCell} />
                </tr>
              ))
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.message}>
                  {hasFilters ? t("audit.noEvents") : t("audit.noEventsYet")}
                </td>
              </tr>
            ) : (
              events.map((ev) => {
                const resource = resourceText(ev);
                const location = formatIpGeo(ev.ip_geo);
                return (
                  <tr
                    key={ev.id}
                    className={styles.row}
                    tabIndex={0}
                    aria-label={`${ev.action}, ${shortDateTime(ev.created_at)}`}
                    onClick={() => setInspect(ev)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setInspect(ev);
                      }
                    }}
                  >
                    <td
                      className={mergeClasses(styles.td, styles.time)}
                      title={new Date(ev.created_at * 1000).toLocaleString()}
                    >
                      {shortDateTime(ev.created_at)}
                    </td>
                    <td className={styles.td}>
                      <span className={styles.action}>{ev.action}</span>
                    </td>
                    <td className={mergeClasses(styles.td, styles.hideNarrow)}>
                      <span
                        className={styles.truncate}
                        title={ev.actor_id ?? undefined}
                      >
                        {ev.actor_name ?? ev.actor_id?.slice(0, 8) ?? "—"}
                      </span>
                    </td>
                    <td className={styles.td}>
                      <span
                        className={styles.truncate}
                        title={
                          ev.resource_type || ev.resource_id
                            ? `${ev.resource_type ?? "?"} / ${ev.resource_id ?? "?"}`
                            : undefined
                        }
                      >
                        {resource ?? <span className={styles.muted}>—</span>}
                      </span>
                    </td>
                    <td
                      className={mergeClasses(
                        styles.td,
                        styles.muted,
                        styles.hideNarrow,
                      )}
                      title={
                        location
                          ? `${ev.ip ?? "—"} · ${location}`
                          : (ev.ip ?? undefined)
                      }
                    >
                      <span className={styles.truncate}>
                        {[parseClient(ev.user_agent), maskIp(ev.ip)]
                          .filter((s) => s && s !== "—")
                          .join(" · ") || "—"}
                      </span>
                    </td>
                    <td className={styles.chevronCell}>
                      <ChevronRightRegular />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <Pagination
          page={page}
          pageCount={totalPages}
          onChange={setPage}
          disabled={isLoading}
        />
      )}

      <Dialog
        open={!!inspect}
        onOpenChange={(_, d) => !d.open && setInspect(null)}
      >
        <DialogSurface style={{ maxWidth: 640, width: "92vw" }}>
          <DialogBody>
            <DialogTitle>{t("audit.inspectTitle")}</DialogTitle>
            <DialogContent>
              {inspect && (
                <InspectBody
                  event={inspect}
                  onFilter={(by) => filterSame(inspect, by)}
                />
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setInspect(null)}>
                {t("common.close")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}

function InspectBody({
  event,
  onFilter,
}: {
  event: AuditEvent;
  onFilter: (by: "action" | "actor" | "resource") => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const rows: [string, string][] = [
    [t("audit.colTime"), new Date(event.created_at * 1000).toLocaleString()],
    [t("audit.colAction"), event.action],
    [
      t("audit.colActor"),
      event.actor_name
        ? `${event.actor_name} (${event.actor_id ?? "—"})`
        : (event.actor_id ?? "—"),
    ],
    [
      t("audit.colResource"),
      event.resource_id || event.resource_type
        ? `${event.resource_name ?? ""} (${event.resource_type ?? "?"} / ${
            event.resource_id ?? "?"
          })`
        : "—",
    ],
    [t("audit.colIp"), event.ip ?? "—"],
    [t("audit.colLocation"), formatIpGeo(event.ip_geo) || "—"],
    [t("audit.colClient"), event.user_agent ?? "—"],
  ];
  let metadata = event.metadata;
  try {
    metadata = JSON.stringify(JSON.parse(event.metadata), null, 2);
  } catch {
    /* leave as-is */
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className={styles.inspectGrid}>
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <Text size={200} className={styles.muted}>
              {k}
            </Text>
            <span className={styles.inspectValue}>{v}</span>
          </Fragment>
        ))}
      </div>
      <Text size={200} className={styles.muted}>
        {t("audit.metadata")}
      </Text>
      <pre className={styles.metadata}>{metadata}</pre>
      <div className={styles.sameRow}>
        <Text size={200} className={styles.muted}>
          {t("audit.filterSame")}
        </Text>
        <Button size="small" onClick={() => onFilter("action")}>
          {t("audit.colAction")}
        </Button>
        {event.actor_id && (
          <Button size="small" onClick={() => onFilter("actor")}>
            {t("audit.colActor")}
          </Button>
        )}
        {(event.resource_id || event.resource_type) && (
          <Button size="small" onClick={() => onFilter("resource")}>
            {t("audit.colResource")}
          </Button>
        )}
      </div>
    </div>
  );
}
