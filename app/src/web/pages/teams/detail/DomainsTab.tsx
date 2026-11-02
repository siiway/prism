// Domains: verified team domains mark the team's apps as verified. Each row
// opens the domain's page; Add domain opens /teams/:id/domains/new.

import {
  Badge,
  Button,
  Spinner,
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
import {
  AddRegular,
  CheckmarkCircleRegular,
  ChevronRightRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiErrorText } from "../../../lib/apiError";
import { useApi } from "../../../lib/api-context";
import { formatDate } from "../../../lib/datetime";
import { Pagination } from "../../../components/Pagination";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsTable,
} from "../../../components/Settings";
import { SkeletonSettingsCard } from "../../../components/Skeletons";
import type { TeamTabProps } from "./types";
import { ListSearch } from "../../../components/ListSearch";
import { useDebouncedSearch } from "../../../lib/useDebouncedSearch";

const PAGE_SIZE = 20;

const useStyles = makeStyles({
  domain: {
    color: tokens.colorNeutralForeground1,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase300,
    textDecorationLine: "none",
    overflowWrap: "anywhere",
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      borderRadius: "2px",
    },
  },
  plain: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase300,
    overflowWrap: "anywhere",
  },
  row: { cursor: "pointer" },
  muted: { color: tokens.colorNeutralForeground3 },
  actions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "8px",
    whiteSpace: "nowrap",
  },
  // The table lays out fixed, so this column needs a real width: room for
  // Verify plus the chevron, or just the chevron.
  actionsHead: { width: "136px" },
  actionsHeadNarrow: { width: "56px" },
  chevron: { fontSize: "14px", color: tokens.colorNeutralForeground3 },
});

export function DomainsTab({ team, canManage, showMsg }: TeamTabProps) {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const teamId = team.id;

  const [page, setPage] = useState(1);
  const {
    query,
    setQuery,
    search: debounced,
  } = useDebouncedSearch(() => setPage(1));

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["team-domains", teamId, page, debounced],
    queryFn: () =>
      api.listTeamDomains(teamId, {
        page,
        limit: PAGE_SIZE,
        q: debounced || undefined,
      }),
  });
  const domains = data?.domains ?? [];
  const total = data?.total ?? 0;

  const [verifying, setVerifying] = useState<string | null>(null);
  const verify = async (domainId: string) => {
    setVerifying(domainId);
    try {
      const res = await api.verifyTeamDomain(teamId, domainId);
      if (res.verified) {
        showMsg("success", t("domains.domainVerified"));
        await qc.invalidateQueries({ queryKey: ["team-domains", teamId] });
      } else {
        showMsg("error", t("domains.verificationCheckFailed"));
      }
    } catch (err) {
      showMsg("error", apiErrorText(err, t("domains.verificationFailed")));
    } finally {
      setVerifying(null);
    }
  };

  if (isLoading) return <SkeletonSettingsCard rows={2} />;

  return (
    <SettingsCard
      id="domains"
      title={t("teams.domainsTitle")}
      description={t("teams.domainsCardDesc")}
      action={
        canManage && (
          <Button
            size="small"
            icon={<AddRegular />}
            onClick={() => navigate(`/teams/${teamId}/domains/new`)}
          >
            {t("domains.addDomain")}
          </Button>
        )
      }
    >
      {(total > 5 || debounced) && (
        <ListSearch
          value={query}
          onChange={setQuery}
          placeholder={t("teams.searchTeamDomainsPlaceholder")}
        />
      )}
      {domains.length === 0 ? (
        <SettingsEmpty>{t("domains.noDomainsYet")}</SettingsEmpty>
      ) : (
        <SettingsTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>{t("domains.domainHeader")}</TableHeaderCell>
                <TableHeaderCell>{t("domains.statusHeader")}</TableHeaderCell>
                <TableHeaderCell>
                  {t("domains.verifiedAtHeader")}
                </TableHeaderCell>
                <TableHeaderCell
                  className={
                    canManage ? styles.actionsHead : styles.actionsHeadNarrow
                  }
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {domains.map((d) => {
                // Inherited from a parent team: shown, managed there.
                const inherited = !!d.inherited_from;
                const path = `/teams/${teamId}/domains/${d.id}`;
                return (
                  <TableRow
                    key={d.id}
                    className={inherited ? undefined : styles.row}
                    onClick={inherited ? undefined : () => navigate(path)}
                  >
                    <TableCell>
                      {inherited ? (
                        <span className={styles.plain}>{d.domain}</span>
                      ) : (
                        <Link
                          to={path}
                          className={styles.domain}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {d.domain}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        appearance="tint"
                        size="small"
                        color={d.verified ? "success" : "warning"}
                        icon={
                          d.verified ? <CheckmarkCircleRegular /> : undefined
                        }
                      >
                        {d.verified
                          ? t("domains.verifiedBadge")
                          : t("domains.pending")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Text size={200} className={styles.muted}>
                        {formatDate(d.verified_at)}
                      </Text>
                    </TableCell>
                    <TableCell>
                      <div
                        className={styles.actions}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {inherited ? (
                          <Badge appearance="outline" size="small">
                            {t("domains.inheritedBadge")}
                          </Badge>
                        ) : (
                          <>
                            {canManage && !d.verified && (
                              <Button
                                size="small"
                                disabled={verifying === d.id}
                                onClick={() => void verify(d.id)}
                              >
                                {verifying === d.id ? (
                                  <Spinner size="tiny" />
                                ) : (
                                  t("common.verify")
                                )}
                              </Button>
                            )}
                            <ChevronRightRegular className={styles.chevron} />
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </SettingsTable>
      )}
      <Pagination
        page={page}
        total={total}
        pageSize={PAGE_SIZE}
        onChange={setPage}
        disabled={isFetching}
        footer
      />
    </SettingsCard>
  );
}
