// Admin invites. Site invites let someone register while sign-up is
// invite-only; team invites add people to a team (and, when granted, create
// accounts too). Different lifecycles, same question when one leaks, so they
// share a page, switched in ?view=. A site invite opens on its own page
// (/admin/invites/:id); new ones start at /admin/invites/new.

import { Badge, Button, makeStyles } from "@fluentui/react-components";
import { AddRegular, MailRegular } from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useApi, useAppOrigin } from "../../lib/api-context";
import { formatDate } from "../../lib/datetime";
import { useDebouncedSearch } from "../../lib/useDebouncedSearch";
import { usePageClamp } from "../../lib/usePageClamp";
import {
  DataList,
  type DataListColumn,
  DataListLink,
  DataListName,
  DataListRow,
  DataListSkeleton,
} from "../../components/DataList";
import { CopyButton } from "../../components/CopyButton";
import { EmptyState } from "../../components/EmptyState";
import { ListSearch } from "../../components/ListSearch";
import { Pagination } from "../../components/Pagination";
import { Segmented } from "../../components/Segmented";
import { AdminTeamInvites } from "./AdminTeamInvites";
import { InviteModeBanner } from "./InviteModeBanner";

const PAGE_SIZE = 20;

const useStyles = makeStyles({
  views: { display: "flex", marginBottom: "12px" },
  badges: { display: "flex", gap: "4px", flexWrap: "wrap" },
  banner: { marginBottom: "12px" },
});

function SiteInvites() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const origin = useAppOrigin();
  const { t } = useTranslation();

  const [page, setPage] = useState(1);
  const { query, setQuery, search } = useDebouncedSearch(() => setPage(1));
  const { data, isFetching } = useQuery({
    queryKey: ["admin", "invites", page, search],
    queryFn: () =>
      api.adminListInvites({
        page,
        limit: PAGE_SIZE,
        q: search || undefined,
      }),
  });
  const invites = data?.invites ?? [];
  const total = data?.total ?? 0;
  usePageClamp(page, data?.total, PAGE_SIZE, setPage);

  // Expiry badges are relative to now; tick so they flip without a reload.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(id);
  }, []);

  const columns: DataListColumn[] = [
    { label: t("admin.inviteFor"), width: "minmax(0, 2fr)" },
    { label: t("admin.inviteUses"), width: "90px", secondary: true },
    { label: t("admin.inviteExpires"), width: "110px", secondary: true },
    {
      label: t("admin.inviteCreatedBy"),
      width: "minmax(0, 1fr)",
      secondary: true,
    },
    // Copy the link without opening the invite.
    { label: "", width: "32px", end: true },
  ];

  return (
    <>
      <InviteModeBanner className={styles.banner} />

      <ListSearch
        value={query}
        onChange={setQuery}
        placeholder={t("teams.searchInvitesPlaceholder")}
      >
        <Button
          appearance="primary"
          icon={<AddRegular />}
          onClick={() => navigate("/admin/invites/new")}
        >
          {t("admin.createInvite")}
        </Button>
      </ListSearch>

      {isFetching && !data ? (
        <DataListSkeleton columns={columns} rows={3} />
      ) : invites.length === 0 ? (
        <EmptyState
          icon={<MailRegular />}
          title={
            search ? t("teams.noResultsMatch") : t("admin.inviteNoInvites")
          }
        />
      ) : (
        <>
          <DataList columns={columns}>
            {invites.map((inv) => {
              const path = `/admin/invites/${inv.id}`;
              const expired = inv.expires_at !== null && inv.expires_at < now;
              const usedUp =
                inv.max_uses !== null && inv.use_count >= inv.max_uses;
              return (
                <DataListRow
                  key={inv.id}
                  onClick={() => navigate(path)}
                  cells={[
                    <DataListName
                      key="who"
                      name={
                        <DataListLink to={path}>
                          {inv.email ?? t("admin.inviteAnyone")}
                        </DataListLink>
                      }
                      sub={inv.note ?? undefined}
                      badges={
                        <span className={styles.badges}>
                          {!inv.enabled && (
                            <Badge
                              appearance="tint"
                              color="danger"
                              size="small"
                            >
                              {t("admin.inviteDisabled")}
                            </Badge>
                          )}
                          {expired && (
                            <Badge
                              appearance="tint"
                              color="warning"
                              size="small"
                            >
                              {t("admin.inviteExpired")}
                            </Badge>
                          )}
                          {usedUp && (
                            <Badge
                              appearance="tint"
                              color="warning"
                              size="small"
                            >
                              {t("admin.inviteUsedUp")}
                            </Badge>
                          )}
                        </span>
                      }
                    />,
                    `${inv.use_count} / ${inv.max_uses ?? "∞"}`,
                    inv.expires_at
                      ? formatDate(inv.expires_at)
                      : t("admin.inviteNoExpiry"),
                    inv.created_by_username
                      ? `@${inv.created_by_username}`
                      : inv.created_by,
                    // Legacy hashed invites have no link to copy.
                    <span key="copy" onClick={(e) => e.stopPropagation()}>
                      {inv.token_available !== false && (
                        <CopyButton
                          text={`${origin}/register?invite=${inv.token}`}
                          label={t("admin.copyInviteLink")}
                        />
                      )}
                    </span>,
                  ]}
                />
              );
            })}
          </DataList>
          <Pagination
            page={page}
            total={total}
            pageSize={PAGE_SIZE}
            onChange={setPage}
            disabled={isFetching}
          />
        </>
      )}
    </>
  );
}

export function AdminInvites() {
  const styles = useStyles();
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "team" ? "team" : "site";

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div className={styles.views}>
        <Segmented
          label={t("admin.inviteKind")}
          value={view}
          onChange={(v) => setParams(v === "team" ? { view: "team" } : {})}
          options={[
            { value: "site", label: t("admin.siteInvitesTab") },
            { value: "team", label: t("admin.teamInvitesTab") },
          ]}
        />
      </div>
      {view === "site" ? <SiteInvites /> : <AdminTeamInvites />}
    </div>
  );
}
