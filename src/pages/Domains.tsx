// Your domains: verified ones mark your apps as verified. One bordered list,
// a row per domain opening its page; Add domain opens /domains/new.

import {
  Badge,
  Button,
  Input,
  Skeleton,
  SkeletonItem,
  Spinner,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  CheckmarkCircleRegular,
  ChevronRightRegular,
  DismissRegular,
  GlobeRegular,
  SearchRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ApiError } from "../lib/api";
import { useApi } from "../lib/api-context";
import { formatDate } from "../lib/datetime";
import { useToastMessage } from "../lib/useToastMessage";
import { EmptyState } from "../components/EmptyState";
import { GetStartedPanel } from "../components/GetStartedPanel";
import { DomainArt } from "../components/Illustrations";
import { PageHeader } from "../components/PageHeader";
import { Pagination } from "../components/Pagination";
import { SettingsToast } from "../components/Settings";

const PAGE_SIZE = 20;
const COLUMNS = "minmax(0, 2.4fr) 110px 120px 120px 80px 20px";
const NARROW = "@media (max-width: 768px)";

const useStyles = makeStyles({
  toast: { position: "sticky", top: "8px", zIndex: 2, marginBottom: "12px" },
  toolbar: {
    display: "flex",
    gap: "8px",
    marginBottom: "12px",
    flexWrap: "wrap",
  },
  list: {
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
    overflow: "hidden",
  },
  head: {
    display: "grid",
    gridTemplateColumns: COLUMNS,
    gap: "16px",
    padding: "10px 16px",
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    [NARROW]: { display: "none" },
  },
  row: {
    display: "grid",
    gridTemplateColumns: COLUMNS,
    gap: "16px",
    alignItems: "center",
    minHeight: "56px",
    padding: "8px 16px",
    boxSizing: "border-box",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    cursor: "pointer",
    ":hover": { background: tokens.colorNeutralBackground1Hover },
    [NARROW]: { gridTemplateColumns: "minmax(0, 1fr) auto auto 20px" },
  },
  // A real link so the row works with the keyboard and "open in new tab".
  domain: {
    color: tokens.colorNeutralForeground1,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    textDecorationLine: "none",
    overflowWrap: "anywhere",
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      borderRadius: "2px",
    },
  },
  muted: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground3,
  },
  secondary: { [NARROW]: { display: "none" } },
  action: { display: "flex", justifyContent: "flex-end" },
  chevron: {
    fontSize: "14px",
    color: tokens.colorNeutralForeground3,
  },
});

export function Domains() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { message, showMsg } = useToastMessage();
  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });
  const siteName = site?.site_name ?? "Prism";

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [query]);

  const { data, isFetching } = useQuery({
    queryKey: ["domains", page, debouncedQuery],
    queryFn: () =>
      api.listDomains({
        page,
        limit: PAGE_SIZE,
        q: debouncedQuery || undefined,
      }),
  });

  const [verifying, setVerifying] = useState<string | null>(null);
  const verify = async (id: string) => {
    setVerifying(id);
    try {
      const res = await api.verifyDomain(id);
      if (res.verified) {
        showMsg("success", t("domains.domainVerified"));
        await qc.invalidateQueries({ queryKey: ["domains"] });
      } else {
        showMsg("error", t("domains.verificationCheckFailed"));
      }
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("domains.verificationFailed"),
      );
    } finally {
      setVerifying(null);
    }
  };

  const addButton = (
    <Button
      appearance="primary"
      icon={<AddRegular />}
      onClick={() => navigate("/domains/new")}
    >
      {t("domains.addDomain")}
    </Button>
  );

  const head = (
    <div className={styles.head} aria-hidden>
      <span>{t("domains.domainHeader")}</span>
      <span>{t("domains.statusHeader")}</span>
      <span>{t("domains.verifiedAtHeader")}</span>
      <span>{t("domains.nextReverifyHeader")}</span>
      <span />
      <span />
    </div>
  );

  const domains = data?.domains ?? [];
  const total = data?.total ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <PageHeader
        title={t("domains.title")}
        subtitle={t("domains.description")}
        actions={addButton}
      />

      {message && (
        <div className={styles.toast}>
          <SettingsToast message={message} />
        </div>
      )}

      {isFetching && !data && (
        <Skeleton aria-busy>
          <div className={styles.list}>
            {head}
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className={styles.row}>
                <SkeletonItem
                  size={12}
                  style={{ width: `${35 + (i % 3) * 12}%` }}
                />
                <SkeletonItem size={12} style={{ width: 64 }} />
                <SkeletonItem size={12} style={{ width: 72 }} />
                <SkeletonItem size={12} style={{ width: 72 }} />
                <span />
                <span />
              </div>
            ))}
          </div>
        </Skeleton>
      )}

      {!isFetching && domains.length === 0 && !debouncedQuery && (
        <GetStartedPanel
          art={<DomainArt />}
          title={t("domains.getStarted.title")}
          description={t("domains.getStarted.desc")}
          steps={[
            t("domains.getStarted.step1"),
            t("domains.getStarted.step2"),
            t("domains.getStarted.step3", { siteName }),
          ]}
          action={addButton}
        />
      )}

      {/* Stays up while a search finds nothing, so it can be cleared. */}
      {data && (domains.length > 0 || debouncedQuery) && (
        <div className={styles.toolbar}>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("domains.searchDomainsPlaceholder")}
            contentBefore={<SearchRegular />}
            contentAfter={
              query ? (
                <Button
                  appearance="transparent"
                  size="small"
                  icon={<DismissRegular />}
                  aria-label={t("common.clear")}
                  onClick={() => setQuery("")}
                />
              ) : undefined
            }
            style={{ minWidth: 220, flex: "1 1 220px" }}
          />
        </div>
      )}

      {!isFetching && domains.length === 0 && debouncedQuery && (
        <EmptyState icon={<GlobeRegular />} title={t("teams.noResultsMatch")} />
      )}

      {data && domains.length > 0 && (
        <>
          <div className={styles.list}>
            {head}
            {domains.map((d) => (
              <div
                key={d.id}
                className={styles.row}
                onClick={() => navigate(`/domains/${d.id}`)}
              >
                <Link
                  to={`/domains/${d.id}`}
                  className={styles.domain}
                  onClick={(e) => e.stopPropagation()}
                >
                  {d.domain}
                </Link>
                <span>
                  <Badge
                    appearance="tint"
                    size="small"
                    color={d.verified ? "success" : "warning"}
                    icon={d.verified ? <CheckmarkCircleRegular /> : undefined}
                  >
                    {d.verified
                      ? t("domains.verifiedBadge")
                      : t("domains.pending")}
                  </Badge>
                </span>
                <span className={`${styles.muted} ${styles.secondary}`}>
                  {formatDate(d.verified_at)}
                </span>
                <span className={`${styles.muted} ${styles.secondary}`}>
                  {formatDate(d.next_reverify_at)}
                </span>
                <div
                  className={styles.action}
                  onClick={(e) => e.stopPropagation()}
                >
                  {!d.verified && (
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
                </div>
                <ChevronRightRegular className={styles.chevron} />
              </div>
            ))}
          </div>
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
    </div>
  );
}
