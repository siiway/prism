// Admin viewer for the image_proxy_mappings table.
//
// Lists every URL the worker is willing to fetch and stream as an image,
// with the user (if any) who first caused it to be registered. Removing
// a row immediately stops the proxy from serving that URL.

import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Input,
  Link,
  MessageBar,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../lib/api";
import { MarkdownText } from "../../components/MarkdownText";
import { Pagination } from "../../components/Pagination";
import { SkeletonTableRows } from "../../components/Skeletons";

const PAGE_SIZE = 50;

const useStyles = makeStyles({
  // Let the table scroll sideways on narrow screens instead of
  // overflowing the page
  tableScroll: { overflowX: "auto" },
  // Show the full id and let text-overflow truncate it only when the column
  // is actually too narrow — a hard slice wastes space when it would fit.
  idCell: {
    fontFamily: "monospace",
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    display: "block",
    maxWidth: "320px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  creatorCell: {
    display: "block",
    maxWidth: "220px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

export function AdminImageProxy() {
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchUrl, setSearchUrl] = useState("");
  const [filterCreator, setFilterCreator] = useState("");
  const [appliedSearchUrl, setAppliedSearchUrl] = useState("");
  const [appliedFilterCreator, setAppliedFilterCreator] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      "admin-image-proxy",
      page,
      appliedSearchUrl,
      appliedFilterCreator,
    ],
    queryFn: () =>
      api.adminListImageProxy(page, {
        q: appliedSearchUrl || undefined,
        created_by: appliedFilterCreator || undefined,
        limit: PAGE_SIZE,
      }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.adminDeleteImageProxy(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-image-proxy"] });
      setError(null);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError
          ? err.message
          : t("admin.imageProxyDeleteFailed"),
      );
    },
  });

  const [sweepMessage, setSweepMessage] = useState<string | null>(null);
  const sweepMut = useMutation({
    mutationFn: () => api.adminSweepImageProxy(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["admin-image-proxy"] });
      setError(null);
      setSweepMessage(
        t("admin.imageProxySweepSuccess", { count: res.deleted }),
      );
    },
    onError: (err) => {
      setSweepMessage(null);
      setError(
        err instanceof ApiError
          ? err.message
          : t("admin.imageProxySweepFailed"),
      );
    },
  });

  function applyFilters() {
    setAppliedSearchUrl(searchUrl);
    setAppliedFilterCreator(filterCreator);
    setPage(1);
  }

  function clearFilters() {
    setSearchUrl("");
    setFilterCreator("");
    setAppliedSearchUrl("");
    setAppliedFilterCreator("");
    setPage(1);
  }

  const hasFilters = !!(appliedSearchUrl || appliedFilterCreator);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const mappings = data?.mappings ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
      <MessageBar intent="info">
        <MarkdownText source={t("admin.imageProxySubtitle")} />
      </MessageBar>

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
            {t("admin.imageProxySearchUrl")}
          </Text>
          <Input
            value={searchUrl}
            onChange={(e) => setSearchUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
            placeholder="example.com"
            style={{ minWidth: 280 }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("admin.imageProxyFilterCreator")}
          </Text>
          <Input
            value={filterCreator}
            onChange={(e) => setFilterCreator(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
            placeholder={t("admin.imageProxyCreatorPlaceholder")}
            style={{ minWidth: 240 }}
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
        <Tooltip content={t("admin.imageProxySweepHint")} relationship="label">
          <Button
            appearance="outline"
            disabled={sweepMut.isPending}
            onClick={() => sweepMut.mutate()}
          >
            {t("admin.imageProxySweepButton")}
          </Button>
        </Tooltip>
      </div>

      {sweepMessage && (
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          {sweepMessage}
        </Text>
      )}

      {error && <MessageBar intent="error">{error}</MessageBar>}

      {data && (
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          {t("admin.imageProxyTotal", { total: data.total })}
        </Text>
      )}

      {isLoading ? (
        <SkeletonTableRows rows={8} cols={5} />
      ) : (
        <div className={styles.tableScroll}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>
                  {t("admin.imageProxyIdHeader")}
                </TableHeaderCell>
                <TableHeaderCell>
                  {t("admin.imageProxyUrlHeader")}
                </TableHeaderCell>
                <TableHeaderCell>
                  {t("admin.imageProxyCreatorHeader")}
                </TableHeaderCell>
                <TableHeaderCell>
                  {t("admin.imageProxyCreatedAtHeader")}
                </TableHeaderCell>
                <TableHeaderCell>
                  {t("admin.imageProxyActionsHeader")}
                </TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mappings.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    style={{
                      textAlign: "center",
                      color: tokens.colorNeutralForeground3,
                    }}
                  >
                    {t("admin.imageProxyNoResults")}
                  </TableCell>
                </TableRow>
              ) : (
                mappings.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <Tooltip content={m.id} relationship="description">
                        <Text className={styles.idCell}>{m.id}</Text>
                      </Tooltip>
                    </TableCell>
                    <TableCell
                      style={{
                        fontSize: 12,
                        maxWidth: 420,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <Tooltip content={m.url} relationship="description">
                        <Link
                          href={`/api/proxy/image/${m.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {m.url}
                        </Link>
                      </Tooltip>
                    </TableCell>
                    <TableCell style={{ fontSize: 12 }}>
                      {m.created_by ? (
                        <Tooltip
                          content={m.created_by}
                          relationship="description"
                        >
                          <Text font="monospace" className={styles.creatorCell}>
                            {m.created_by_username ??
                              m.created_by_display_name ??
                              m.created_by}
                          </Text>
                        </Tooltip>
                      ) : (
                        <Text
                          size={200}
                          style={{
                            color: tokens.colorNeutralForeground3,
                            fontStyle: "italic",
                          }}
                        >
                          {t("admin.imageProxySystemRow")}
                        </Text>
                      )}
                    </TableCell>
                    <TableCell style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                      {new Date(m.created_at * 1000).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="small"
                        appearance="subtle"
                        disabled={
                          deleteMut.isPending && deleteMut.variables === m.id
                        }
                        onClick={() => setPendingDeleteId(m.id)}
                        style={{ color: tokens.colorPaletteRedForeground1 }}
                      >
                        {t("admin.imageProxyDelete")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <Pagination
          page={page}
          pageCount={totalPages}
          onChange={setPage}
          disabled={isLoading || isFetching}
        />
      )}

      <Dialog
        open={pendingDeleteId !== null}
        onOpenChange={(_, d) => {
          if (!d.open) setPendingDeleteId(null);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("admin.imageProxyDelete")}</DialogTitle>
            <DialogContent>{t("admin.imageProxyDeleteConfirm")}</DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button>{t("common.cancel")}</Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                style={{ background: tokens.colorPaletteRedBackground3 }}
                onClick={() => {
                  if (pendingDeleteId) deleteMut.mutate(pendingDeleteId);
                  setPendingDeleteId(null);
                }}
              >
                {t("admin.imageProxyDelete")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
