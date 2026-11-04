// Your SAML profiles (/saml-profiles): the IDs SAML apps know you by. Shared
// profiles (made by you, usable for several apps) and per-app ones (made at
// the first sign-in to an app) are listed apart. The search covers names,
// IDs and app names; there are few enough profiles to filter here.

import {
  Badge,
  Button,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { AddRegular, PersonAccountsRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { SamlProfile } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { formatDate } from "../../lib/datetime";
import {
  DataList,
  DataListRow,
  DataListSkeleton,
  type DataListColumn,
} from "../../components/DataList";
import { EmptyState } from "../../components/EmptyState";
import { ListSearch } from "../../components/ListSearch";
import { PageHeader } from "../../components/PageHeader";
import { profileTitle } from "./profileTitle";

const useStyles = makeStyles({
  section: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    marginBottom: "24px",
  },
  sectionHead: { display: "flex", flexDirection: "column", gap: "2px" },
  muted: { color: tokens.colorNeutralForeground3, fontSize: "13px" },
  name: { fontWeight: tokens.fontWeightSemibold },
  ellipsis: {
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  id: { fontFamily: tokens.fontFamilyMonospace, fontSize: "12px" },
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

  /** The list's columns; the first names a shared profile or a per-app
   *  one's app. */
  const columns = (first: string): DataListColumn[] => [
    { label: first, width: "minmax(0, 1.4fr)" },
    { label: t("samlProfiles.idHeader"), width: "minmax(0, 1.2fr)" },
    {
      label: t("samlProfiles.appsHeader"),
      width: "minmax(0, 1.4fr)",
      secondary: true,
    },
    { label: t("samlProfiles.createdHeader"), width: "110px", secondary: true },
  ];

  const section = (opts: {
    title: string;
    desc: string;
    color: "informative" | "subtle";
    first: string;
    list: SamlProfile[];
    empty: string;
  }) => (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <Text weight="semibold">
          {opts.title}{" "}
          <Badge appearance="tint" size="small" color={opts.color}>
            {opts.list.length}
          </Badge>
        </Text>
        <Text className={styles.muted}>{opts.desc}</Text>
      </div>
      <DataList columns={columns(opts.first)} linked>
        {opts.list.length === 0 ? (
          <div className={styles.empty}>
            {q ? t("samlProfiles.noMatch") : opts.empty}
          </div>
        ) : (
          opts.list.map((p) => (
            <DataListRow
              key={p.id}
              to={`/saml-profiles/${p.id}`}
              cells={[
                <span className={styles.name}>
                  {profileTitle(p, t("samlProfiles.unknownApp"))}
                </span>,
                <span
                  className={`${styles.id} ${styles.ellipsis}`}
                  title={p.name_id}
                >
                  {p.name_id}
                </span>,
                <span className={styles.ellipsis}>
                  {p.apps.length > 0
                    ? p.apps.map((a) => a.name).join(", ")
                    : t("samlProfiles.unused")}
                </span>,
                <span className={styles.muted}>
                  {formatDate(p.created_at)}
                </span>,
              ]}
            />
          ))
        )}
      </DataList>
    </section>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <PageHeader
        title={t("samlProfiles.title")}
        subtitle={t("samlProfiles.description")}
        actions={newButton}
      />

      {isLoading && (
        <DataListSkeleton
          columns={columns(t("samlProfiles.nameHeader"))}
          linked
          rows={3}
        />
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

          {section({
            title: t("samlProfiles.sharedTitle"),
            desc: t("samlProfiles.sharedDesc"),
            color: "informative",
            first: t("samlProfiles.nameHeader"),
            list: shared,
            empty: t("samlProfiles.noShared"),
          })}
          {section({
            title: t("samlProfiles.appTitle"),
            desc: t("samlProfiles.appDesc"),
            color: "subtle",
            first: t("samlProfiles.appHeader"),
            list: perApp,
            empty: t("samlProfiles.noApp"),
          })}
        </>
      )}
    </div>
  );
}
