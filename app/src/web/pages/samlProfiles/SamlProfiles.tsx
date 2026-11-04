// Your SAML profiles (/saml-profiles): the IDs SAML apps know you by. Shared
// profiles (made by you, usable for several apps) and per-app ones (made at
// the first sign-in to an app) are listed apart. The search covers names,
// IDs and app names; there are few enough profiles to filter here.

import {
  Badge,
  Button,
  Skeleton,
  SkeletonItem,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  ChevronRightRegular,
  PersonAccountsRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { SamlProfile } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { formatDate } from "../../lib/datetime";
import { EmptyState } from "../../components/EmptyState";
import { ListSearch } from "../../components/ListSearch";
import { PageHeader } from "../../components/PageHeader";
import { profileTitle } from "./profileTitle";

const COLUMNS = "minmax(0, 1.4fr) minmax(0, 1.2fr) minmax(0, 1.4fr) 110px 20px";
const NARROW = "@media (max-width: 768px)";

const useStyles = makeStyles({
  section: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    marginBottom: "24px",
  },
  sectionHead: { display: "flex", flexDirection: "column", gap: "2px" },
  muted: { color: tokens.colorNeutralForeground3, fontSize: "13px" },
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
    minHeight: "52px",
    padding: "8px 16px",
    boxSizing: "border-box",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    cursor: "pointer",
    ":hover": { background: tokens.colorNeutralBackground1Hover },
    [NARROW]: { gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) 20px" },
  },
  // A real link so the row works with the keyboard and "open in new tab".
  name: {
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
    textDecorationLine: "none",
    overflowWrap: "anywhere",
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      borderRadius: "2px",
    },
  },
  id: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "12px",
    color: tokens.colorNeutralForeground2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  apps: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  secondary: { [NARROW]: { display: "none" } },
  chevron: { fontSize: "14px", color: tokens.colorNeutralForeground3 },
  empty: {
    padding: "16px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground3,
    fontSize: "13px",
  },
});

function matches(p: SamlProfile, q: string): boolean {
  const needle = q.toLowerCase();
  return [p.name ?? "", p.name_id, ...p.apps.map((a) => a.name)].some((s) =>
    s.toLowerCase().includes(needle),
  );
}

export function SamlProfiles() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["saml-profiles"],
    queryFn: api.listSamlProfiles,
  });
  const all = data?.profiles ?? [];
  const q = query.trim();
  const found = q ? all.filter((p) => matches(p, q)) : all;
  const shared = found.filter((p) => p.kind === "shared");
  const perApp = found.filter((p) => p.kind === "app");

  const newButton = (
    <Button
      appearance="primary"
      icon={<AddRegular />}
      onClick={() => navigate("/saml-profiles/new")}
    >
      {t("samlProfiles.newProfile")}
    </Button>
  );

  const head = (firstColumn: string) => (
    <div className={styles.head} aria-hidden>
      <span>{firstColumn}</span>
      <span>{t("samlProfiles.idHeader")}</span>
      <span>{t("samlProfiles.appsHeader")}</span>
      <span>{t("samlProfiles.createdHeader")}</span>
      <span />
    </div>
  );

  const rows = (list: SamlProfile[], empty: string) =>
    list.length === 0 ? (
      <div className={styles.empty}>
        {q ? t("samlProfiles.noMatch") : empty}
      </div>
    ) : (
      list.map((p) => (
        <div
          key={p.id}
          className={styles.row}
          onClick={() => navigate(`/saml-profiles/${p.id}`)}
        >
          <Link
            to={`/saml-profiles/${p.id}`}
            className={styles.name}
            onClick={(e) => e.stopPropagation()}
          >
            {profileTitle(p, t("samlProfiles.unknownApp"))}
          </Link>
          <span className={styles.id} title={p.name_id}>
            {p.name_id}
          </span>
          <span className={`${styles.apps} ${styles.secondary}`}>
            {p.apps.length > 0
              ? p.apps.map((a) => a.name).join(", ")
              : t("samlProfiles.unused")}
          </span>
          <span className={`${styles.muted} ${styles.secondary}`}>
            {formatDate(p.created_at)}
          </span>
          <ChevronRightRegular className={styles.chevron} />
        </div>
      ))
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <PageHeader
        title={t("samlProfiles.title")}
        subtitle={t("samlProfiles.description")}
        actions={newButton}
      />

      {isLoading && (
        <Skeleton aria-busy>
          <div className={styles.list}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className={styles.row}>
                <SkeletonItem size={12} style={{ width: "60%" }} />
                <SkeletonItem size={12} style={{ width: "80%" }} />
                <SkeletonItem size={12} style={{ width: "50%" }} />
                <SkeletonItem size={12} style={{ width: 72 }} />
                <span />
              </div>
            ))}
          </div>
        </Skeleton>
      )}

      {data && all.length === 0 && (
        <EmptyState
          icon={<PersonAccountsRegular />}
          title={t("samlProfiles.emptyTitle")}
          description={t("samlProfiles.emptyDesc")}
          action={newButton}
        />
      )}

      {data && all.length > 0 && (
        <>
          <ListSearch
            value={query}
            onChange={setQuery}
            placeholder={t("samlProfiles.searchPlaceholder")}
          />

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <Text weight="semibold">
                {t("samlProfiles.sharedTitle")}{" "}
                <Badge appearance="tint" size="small" color="informative">
                  {shared.length}
                </Badge>
              </Text>
              <Text className={styles.muted}>
                {t("samlProfiles.sharedDesc")}
              </Text>
            </div>
            <div className={styles.list}>
              {head(t("samlProfiles.nameHeader"))}
              {rows(shared, t("samlProfiles.noShared"))}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <Text weight="semibold">
                {t("samlProfiles.appTitle")}{" "}
                <Badge appearance="tint" size="small" color="subtle">
                  {perApp.length}
                </Badge>
              </Text>
              <Text className={styles.muted}>{t("samlProfiles.appDesc")}</Text>
            </div>
            <div className={styles.list}>
              {head(t("samlProfiles.appHeader"))}
              {rows(perApp, t("samlProfiles.noApp"))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
