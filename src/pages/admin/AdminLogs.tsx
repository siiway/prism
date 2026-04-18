// Admin request log viewer with debug controls

import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Dropdown,
  Input,
  Option,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { SkeletonTableRows } from "../../components/Skeletons";

type RequestLog = {
  id: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  ip_address: string | null;
  user_agent: string | null;
  user_id: string | null;
  created_at: number;
};

const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;
const STATUS_OPTIONS = [
  { value: "200", label: "2xx Success" },
  { value: "400", label: "4xx Client error" },
  { value: "500", label: "5xx Server error" },
] as const;

function statusBadgeColor(
  status: number,
): "success" | "warning" | "danger" | "subtle" {
  if (status < 300) return "success";
  if (status < 400) return "subtle";
  if (status < 500) return "warning";
  return "danger";
}

function methodBadgeColor(
  method: string,
): "brand" | "success" | "warning" | "danger" | "informative" | "subtle" {
  if (method === "GET") return "informative";
  if (method === "POST") return "success";
  if (method === "PATCH" || method === "PUT") return "warning";
  if (method === "DELETE") return "danger";
  return "subtle";
}

function DetailsDialog({ id }: { id: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-log-details", id],
    queryFn: () => api.adminRequestLogDetails(id),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={(_, s) => setOpen(s.open)}>
      <DialogTrigger disableButtonEnhancement>
        <Button size="small" appearance="subtle">
          {t("admin.logs.viewDetails")}
        </Button>
      </DialogTrigger>
      <DialogSurface style={{ maxWidth: 720 }}>
        <DialogBody>
          <DialogTitle>{t("admin.logs.requestDetails")}</DialogTitle>
          <DialogContent>
            {isLoading ? (
              <Spinner size="small" />
            ) : data?.details ? (
              <pre
                style={{
                  fontSize: 11,
                  fontFamily: "monospace",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  maxHeight: 480,
                  overflow: "auto",
                  background: tokens.colorNeutralBackground3,
                  padding: 12,
                  borderRadius: 4,
                }}
              >
                {JSON.stringify(data.details, null, 2)}
              </pre>
            ) : (
              <Text style={{ color: tokens.colorNeutralForeground3 }}>
                {t("admin.logs.noDetails")}
              </Text>
            )}
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function DebugControls() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["admin-debug"],
    queryFn: () => api.adminGetDebug(),
  });

  const [spectateInput, setSpectateInput] = useState("");
  const [spectatePathInput, setSpectatePathInput] = useState("");
  const [exceptInput, setExceptInput] = useState("");
  const [logIpInput, setLogIpInput] = useState("");

  const mut = useMutation({
    mutationFn: api.adminSetDebug,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-debug"] }),
  });

  const clearMut = useMutation({
    mutationFn: api.adminClearRequestLogs,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-request-logs"] }),
  });

  const clearSpectateMut = useMutation({
    mutationFn: api.adminClearSpectrateLogs,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-request-logs"] }),
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        borderRadius: 8,
        background: tokens.colorNeutralBackground3,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text weight="semibold">{t("admin.logs.debugTitle")}</Text>
        <Button
          appearance="subtle"
          size="small"
          disabled={clearMut.isPending}
          onClick={() => clearMut.mutate()}
        >
          {t("admin.logs.clearLogs")}
        </Button>
      </div>

      {/* Enable / Force log all */}
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <Switch
          label={t("admin.logs.enableLogging")}
          checked={data?.logging_enabled ?? false}
          onChange={(_, d) => mut.mutate({ logging_enabled: d.checked })}
        />
        <Switch
          label={t("admin.logs.forceLogAll")}
          checked={data?.force_log_all ?? false}
          disabled={!(data?.logging_enabled ?? false)}
          onChange={(_, d) => mut.mutate({ force_log_all: d.checked })}
        />
      </div>
      {data?.force_log_all && (
        <Text
          size={200}
          style={{ color: tokens.colorPaletteMarigoldForeground1 }}
        >
          {t("admin.logs.forceLogAllHint")}
        </Text>
      )}

      {/* Except path */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          {t("admin.logs.exceptPattern")}
        </Text>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {data?.log_except_pattern ? (
            <>
              <Badge appearance="filled" color="subtle">
                <span style={{ fontFamily: "monospace" }}>
                  {data.log_except_pattern}
                </span>
              </Badge>
              <Button
                size="small"
                appearance="subtle"
                onClick={() => mut.mutate({ log_except_pattern: null })}
              >
                {t("admin.logs.clearExceptPattern")}
              </Button>
            </>
          ) : (
            <>
              <Input
                placeholder={t("admin.logs.exceptPatternPlaceholder")}
                value={exceptInput}
                onChange={(e) => setExceptInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && exceptInput) {
                    mut.mutate({ log_except_pattern: exceptInput });
                    setExceptInput("");
                  }
                }}
                style={{ minWidth: 220 }}
              />
              <Button
                appearance="secondary"
                size="small"
                disabled={!exceptInput}
                onClick={() => {
                  if (exceptInput) {
                    mut.mutate({ log_except_pattern: exceptInput });
                    setExceptInput("");
                  }
                }}
              >
                {t("admin.logs.apply")}
              </Button>
            </>
          )}
        </div>
        {data?.log_except_pattern && (
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("admin.logs.exceptPatternHint")}
          </Text>
        )}
      </div>

      {/* IP filter */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          {t("admin.logs.logIp")}
        </Text>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {data?.log_ip ? (
            <>
              <Badge appearance="filled" color="brand">
                <span style={{ fontFamily: "monospace" }}>{data.log_ip}</span>
              </Badge>
              <Button
                size="small"
                appearance="subtle"
                onClick={() => mut.mutate({ log_ip: null })}
              >
                {t("admin.logs.clearIpFilter")}
              </Button>
            </>
          ) : (
            <>
              <Input
                placeholder={t("admin.logs.logIpPlaceholder")}
                value={logIpInput}
                onChange={(e) => setLogIpInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && logIpInput) {
                    mut.mutate({ log_ip: logIpInput });
                    setLogIpInput("");
                  }
                }}
                style={{ minWidth: 160 }}
              />
              <Button
                appearance="secondary"
                size="small"
                disabled={!logIpInput}
                onClick={() => {
                  if (logIpInput) {
                    mut.mutate({ log_ip: logIpInput });
                    setLogIpInput("");
                  }
                }}
              >
                {t("admin.logs.apply")}
              </Button>
            </>
          )}
        </div>
        {data?.log_ip && (
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("admin.logs.logIpHint")}
          </Text>
        )}
      </div>

      {/* Spectate user */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          {t("admin.logs.spectateUser")}
        </Text>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {data?.spectate_user_id ? (
            <>
              <Badge appearance="filled" color="warning">
                {t("admin.logs.spectating")}:{" "}
                <span style={{ fontFamily: "monospace" }}>
                  {data.spectate_user_id}
                </span>
              </Badge>
              <Button
                size="small"
                appearance="subtle"
                onClick={() => mut.mutate({ spectate_user_id: null })}
              >
                {t("admin.logs.stopSpectating")}
              </Button>
            </>
          ) : (
            <>
              <Input
                placeholder={t("admin.logs.spectateUserPlaceholder")}
                value={spectateInput}
                onChange={(e) => setSpectateInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && spectateInput) {
                    mut.mutate({ spectate_user_id: spectateInput });
                    setSpectateInput("");
                  }
                }}
                style={{ minWidth: 280 }}
              />
              <Button
                appearance="primary"
                size="small"
                disabled={!spectateInput}
                onClick={() => {
                  if (spectateInput) {
                    mut.mutate({ spectate_user_id: spectateInput });
                    setSpectateInput("");
                  }
                }}
              >
                {t("admin.logs.startSpectating")}
              </Button>
            </>
          )}
        </div>
        {data?.spectate_user_id && (
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("admin.logs.spectateHint")}
          </Text>
        )}
      </div>

      {/* Spectate endpoint */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          {t("admin.logs.spectateEndpoint")}
        </Text>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {data?.spectate_path ? (
            <>
              <Badge appearance="filled" color="warning">
                {t("admin.logs.spectating")}:{" "}
                <span style={{ fontFamily: "monospace" }}>
                  {data.spectate_path}
                </span>
              </Badge>
              <Button
                size="small"
                appearance="subtle"
                onClick={() => mut.mutate({ spectate_path: null })}
              >
                {t("admin.logs.stopSpectating")}
              </Button>
              <Button
                size="small"
                appearance="subtle"
                disabled={clearSpectateMut.isPending}
                onClick={() => clearSpectateMut.mutate()}
              >
                {t("admin.logs.clearSpectateLogs")}
              </Button>
            </>
          ) : (
            <>
              <Input
                placeholder={t("admin.logs.spectateEndpointPlaceholder")}
                value={spectatePathInput}
                onChange={(e) => setSpectatePathInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && spectatePathInput) {
                    mut.mutate({ spectate_path: spectatePathInput });
                    setSpectatePathInput("");
                  }
                }}
                style={{ minWidth: 280 }}
              />
              <Button
                appearance="primary"
                size="small"
                disabled={!spectatePathInput}
                onClick={() => {
                  if (spectatePathInput) {
                    mut.mutate({ spectate_path: spectatePathInput });
                    setSpectatePathInput("");
                  }
                }}
              >
                {t("admin.logs.startSpectating")}
              </Button>
            </>
          )}
        </div>
        {data?.spectate_path && (
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("admin.logs.spectateEndpointHint")}
          </Text>
        )}
      </div>
    </div>
  );
}

export function AdminLogs() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [filterMethod, setFilterMethod] = useState("");
  const [filterPath, setFilterPath] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterUserId, setFilterUserId] = useState("");

  const [appliedMethod, setAppliedMethod] = useState("");
  const [appliedPath, setAppliedPath] = useState("");
  const [appliedStatus, setAppliedStatus] = useState("");
  const [appliedUserId, setAppliedUserId] = useState("");
  const [exporting, setExporting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: [
      "admin-request-logs",
      page,
      appliedMethod,
      appliedPath,
      appliedStatus,
      appliedUserId,
    ],
    queryFn: () =>
      api.adminRequestLogs(page, {
        method: appliedMethod || undefined,
        path: appliedPath || undefined,
        status: appliedStatus || undefined,
        user_id: appliedUserId || undefined,
      }),
    refetchInterval: 5000,
  });

  const logs = (data?.logs as RequestLog[]) ?? [];
  const totalPages = data ? Math.ceil(data.total / 50) : 1;

  function applyFilters() {
    setAppliedMethod(filterMethod);
    setAppliedPath(filterPath);
    setAppliedStatus(filterStatus);
    setAppliedUserId(filterUserId);
    setPage(1);
  }

  function clearFilters() {
    setFilterMethod("");
    setFilterPath("");
    setFilterStatus("");
    setFilterUserId("");
    setAppliedMethod("");
    setAppliedPath("");
    setAppliedStatus("");
    setAppliedUserId("");
    setPage(1);
  }

  const hasFilters =
    appliedMethod || appliedPath || appliedStatus || appliedUserId;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <DebugControls />

      {/* Filter bar */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "flex-end",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("admin.logs.filterMethod")}
          </Text>
          <Dropdown
            style={{ minWidth: 120 }}
            value={filterMethod || t("admin.logs.allMethods")}
            selectedOptions={[filterMethod]}
            onOptionSelect={(_, d) =>
              setFilterMethod(
                d.optionValue === "__all" ? "" : (d.optionValue ?? ""),
              )
            }
          >
            <Option value="__all">{t("admin.logs.allMethods")}</Option>
            {METHODS.map((m) => (
              <Option key={m} value={m}>
                {m}
              </Option>
            ))}
          </Dropdown>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("admin.logs.filterPath")}
          </Text>
          <Input
            placeholder="/api/oauth/token"
            value={filterPath}
            onChange={(e) => setFilterPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("admin.logs.filterStatus")}
          </Text>
          <Dropdown
            style={{ minWidth: 160 }}
            value={
              filterStatus
                ? (STATUS_OPTIONS.find((o) => o.value === filterStatus)
                    ?.label ?? filterStatus)
                : t("admin.logs.allStatuses")
            }
            selectedOptions={[filterStatus]}
            onOptionSelect={(_, d) =>
              setFilterStatus(
                d.optionValue === "__all" ? "" : (d.optionValue ?? ""),
              )
            }
          >
            <Option value="__all">{t("admin.logs.allStatuses")}</Option>
            {STATUS_OPTIONS.map((o) => (
              <Option key={o.value} value={o.value}>
                {o.label}
              </Option>
            ))}
          </Dropdown>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("admin.logs.filterUserId")}
          </Text>
          <Input
            placeholder={t("admin.logs.userIdPlaceholder")}
            value={filterUserId}
            onChange={(e) => setFilterUserId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
          />
        </div>

        <Button appearance="primary" onClick={applyFilters}>
          {t("common.search")}
        </Button>
        {hasFilters && (
          <Button appearance="subtle" onClick={clearFilters}>
            {t("admin.loginErrors.clearFilters")}
          </Button>
        )}
      </div>

      {data && (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {data.total} {t("admin.logs.totalResults")}
          </Text>
          <Button
            size="small"
            appearance="subtle"
            disabled={exporting || data.total === 0}
            onClick={async () => {
              setExporting(true);
              try {
                await api.adminExportRequestLogs("json", {
                  method: appliedMethod || undefined,
                  path: appliedPath || undefined,
                  status: appliedStatus || undefined,
                  user_id: appliedUserId || undefined,
                });
              } finally {
                setExporting(false);
              }
            }}
          >
            {t("admin.logs.exportJson")}
          </Button>
          <Button
            size="small"
            appearance="subtle"
            disabled={exporting || data.total === 0}
            onClick={async () => {
              setExporting(true);
              try {
                await api.adminExportRequestLogs("csv", {
                  method: appliedMethod || undefined,
                  path: appliedPath || undefined,
                  status: appliedStatus || undefined,
                  user_id: appliedUserId || undefined,
                });
              } finally {
                setExporting(false);
              }
            }}
          >
            {t("admin.logs.exportCsv")}
          </Button>
        </div>
      )}

      {isLoading ? (
        <SkeletonTableRows rows={8} cols={4} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>{t("admin.logs.timeHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.logs.methodHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.logs.pathHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.logs.statusHeader")}</TableHeaderCell>
              <TableHeaderCell>
                {t("admin.logs.durationHeader")}
              </TableHeaderCell>
              <TableHeaderCell>{t("admin.logs.userHeader")}</TableHeaderCell>
              <TableHeaderCell>{t("admin.logs.ipHeader")}</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  style={{
                    textAlign: "center",
                    color: tokens.colorNeutralForeground3,
                  }}
                >
                  {t("admin.logs.noResults")}
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell style={{ whiteSpace: "nowrap", fontSize: 12 }}>
                    {new Date(log.created_at * 1000).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge
                      color={methodBadgeColor(log.method)}
                      appearance="filled"
                      style={{ fontSize: 11, fontFamily: "monospace" }}
                    >
                      {log.method}
                    </Badge>
                  </TableCell>
                  <TableCell
                    style={{
                      fontFamily: "monospace",
                      fontSize: 12,
                      maxWidth: 280,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={log.path}
                  >
                    {log.path}
                  </TableCell>
                  <TableCell>
                    <Badge
                      color={statusBadgeColor(log.status)}
                      appearance="filled"
                      style={{ fontSize: 11, fontFamily: "monospace" }}
                    >
                      {log.status}
                    </Badge>
                  </TableCell>
                  <TableCell style={{ fontFamily: "monospace", fontSize: 12 }}>
                    {log.duration_ms}ms
                  </TableCell>
                  <TableCell
                    style={{
                      fontFamily: "monospace",
                      fontSize: 11,
                      color: tokens.colorNeutralForeground3,
                    }}
                  >
                    {log.user_id ? log.user_id.slice(0, 8) + "…" : "—"}
                  </TableCell>
                  <TableCell style={{ fontFamily: "monospace", fontSize: 12 }}>
                    {log.ip_address ?? "—"}
                  </TableCell>
                  <TableCell>
                    <DetailsDialog id={log.id} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}

      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            justifyContent: "flex-end",
          }}
        >
          <Button
            size="small"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("common.previous")}
          </Button>
          <Text size={200}>
            {t("common.pageOf", { page, total: totalPages })}
          </Text>
          <Button
            size="small"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("common.next")}
          </Button>
        </div>
      )}
    </div>
  );
}
