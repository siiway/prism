// Personal Access Tokens management page

import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { AddRegular, DeleteRegular, KeyRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useApi } from "../lib/api-context";
import { useConfirm } from "../lib/useConfirm";
import { formatDate } from "../lib/datetime";
import { EmptyState } from "../components/EmptyState";
import { GetStartedPanel } from "../components/GetStartedPanel";
import { TokenArt } from "../components/Illustrations";
import { PageHeader } from "../components/PageHeader";
import { Pagination } from "../components/Pagination";
import { SkeletonTableRows } from "../components/Skeletons";
import { useDebouncedSearch } from "../lib/useDebouncedSearch";
import { ListSearch } from "../components/ListSearch";

const useStyles = makeStyles({
  card: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "8px",
    padding: "24px",
    background: tokens.colorNeutralBackground1,
    // Let the table scroll sideways on narrow screens instead of
    // overflowing the page
    overflowX: "auto",
  },
});

export function Tokens() {
  const { confirm, confirmDialog } = useConfirm();
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });
  const siteName = site?.site_name ?? "Prism";

  const [page, setPage] = useState(1);
  const {
    query,
    setQuery,
    search: debouncedQuery,
  } = useDebouncedSearch(() => setPage(1));

  const { data, isFetching } = useQuery({
    queryKey: ["pat", page, debouncedQuery],
    queryFn: () =>
      api.listTokens({ page, limit: 20, q: debouncedQuery || undefined }),
  });

  const handleRevoke = async (id: string) => {
    try {
      await api.revokePat(id);
      await qc.invalidateQueries({ queryKey: ["pat"] });
    } catch {
      // ignore
    }
  };

  const newTokenButton = (
    <Button
      appearance="primary"
      icon={<AddRegular />}
      onClick={() => navigate("/tokens/new")}
    >
      {t("tokens.createToken")}
    </Button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <PageHeader
        title={t("tokens.title")}
        subtitle={t("tokens.subtitle")}
        actions={newTokenButton}
      />

      {/* No tokens at all: explain how to start in place of the empty table. */}
      {!isFetching && data?.tokens.length === 0 && !debouncedQuery ? (
        <GetStartedPanel
          art={<TokenArt />}
          title={t("tokens.getStarted.title")}
          description={t("tokens.getStarted.desc", { siteName })}
          steps={[
            t("tokens.getStarted.step1"),
            t("tokens.getStarted.step2"),
            t("tokens.getStarted.step3"),
          ]}
          action={
            <Button
              appearance="primary"
              icon={<AddRegular />}
              onClick={() => navigate("/tokens/new")}
            >
              {t("tokens.createToken")}
            </Button>
          }
        />
      ) : (
        <div className={styles.card}>
          {/* Stays up while a search finds nothing, so it can be cleared. */}
          {(query || debouncedQuery || !!data?.tokens.length) && (
            <ListSearch
              value={query}
              onChange={setQuery}
              placeholder={t("tokens.searchTokensPlaceholder")}
            />
          )}
          {isFetching && !data ? (
            <SkeletonTableRows rows={5} cols={5} />
          ) : !isFetching && data?.tokens.length === 0 && debouncedQuery ? (
            <EmptyState
              icon={<KeyRegular />}
              title={t("teams.noResultsMatch")}
            />
          ) : data && data.tokens.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>{t("tokens.name")}</TableHeaderCell>
                    <TableHeaderCell>{t("tokens.scopesCol")}</TableHeaderCell>
                    <TableHeaderCell>{t("tokens.lastUsed")}</TableHeaderCell>
                    <TableHeaderCell>{t("tokens.expires")}</TableHeaderCell>
                    <TableHeaderCell />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.tokens.map((tok) => (
                    <TableRow key={tok.id}>
                      <TableCell>
                        <Text weight="semibold">{tok.name}</Text>
                      </TableCell>
                      <TableCell>
                        <div
                          style={{ display: "flex", flexWrap: "wrap", gap: 4 }}
                        >
                          {tok.scopes.map((s) => (
                            <Badge key={s} appearance="outline" size="small">
                              {s}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Text
                          size={200}
                          style={{ color: tokens.colorNeutralForeground3 }}
                        >
                          {formatDate(tok.last_used_at)}
                        </Text>
                      </TableCell>
                      <TableCell>
                        <Text
                          size={200}
                          style={{ color: tokens.colorNeutralForeground3 }}
                        >
                          {formatDate(tok.expires_at)}
                        </Text>
                      </TableCell>
                      <TableCell>
                        <Button
                          appearance="subtle"
                          icon={<DeleteRegular />}
                          size="small"
                          style={{ color: tokens.colorPaletteRedForeground1 }}
                          onClick={async () => {
                            const ok = await confirm({
                              title: t("tokens.revokeTitle"),
                              body: t("tokens.revokeBody", { name: tok.name }),
                              confirmLabel: t("tokens.revoke"),
                            });
                            if (ok) void handleRevoke(tok.id);
                          }}
                        >
                          {t("tokens.revoke")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                page={page}
                pageCount={Math.max(1, Math.ceil((data.total || 0) / 20))}
                total={data.total}
                onChange={setPage}
                disabled={isFetching}
              />
            </>
          ) : null}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
