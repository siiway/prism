// Admin notices: announcements shown at the top of every page. Each row
// shows whether the notice is live and opens its page, where it is
// published or taken down; New notice opens /admin/notices/new.

import {
  Badge,
  Button,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  MegaphoneRegular,
  PinRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../lib/api";
import { useApi } from "../../lib/api-context";
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
import { EmptyState } from "../../components/EmptyState";
import { GetStartedPanel } from "../../components/GetStartedPanel";
import { NoticeArt } from "../../components/Illustrations";
import { ListSearch } from "../../components/ListSearch";
import { Pagination } from "../../components/Pagination";
import { levelColor, noticeWindow } from "./notices/noticeForm";

const PAGE_SIZE = 20;

const useStyles = makeStyles({
  banner: { marginBottom: "12px" },

  pin: { color: tokens.colorNeutralForeground3, flexShrink: 0 },
  muted: { color: tokens.colorNeutralForeground3 },
});

export function AdminNotices() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [page, setPage] = useState(1);
  const { query, setQuery, search } = useDebouncedSearch(() => setPage(1));
  const { data, isFetching, error } = useQuery({
    queryKey: ["admin-notices", page, search],
    queryFn: () => api.adminListNotices(page, search),
    // A 503 means the migration hasn't been applied; retrying won't help,
    // and the message below says what will.
    retry: false,
  });
  const notices = data?.notices ?? [];
  const total = data?.total ?? 0;
  usePageClamp(page, data?.total, PAGE_SIZE, setPage);

  const columns: DataListColumn[] = [
    { label: t("admin.noticeTitle"), width: "minmax(0, 2fr)" },
    {
      label: t("admin.noticeWindow"),
      width: "minmax(0, 1.2fr)",
      secondary: true,
    },
    { label: t("admin.noticeDismissedCol"), width: "90px", secondary: true },
    { label: t("admin.noticeStatusCol"), width: "84px", end: true },
  ];

  const create = (
    <Button
      appearance="primary"
      icon={<AddRegular />}
      disabled={!!error}
      onClick={() => navigate("/admin/notices/new")}
    >
      {t("admin.newNotice")}
    </Button>
  );

  // Nothing written yet (not just nothing matching a search): explain the
  // board instead of showing an empty list.
  const boardEmpty = !!data && total === 0 && !search && !query;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {error && (
        <MessageBar intent="warning" className={styles.banner}>
          <MessageBarBody>
            <MessageBarTitle>
              {error instanceof ApiError && error.status === 503
                ? t("admin.noticesUnavailable")
                : t("admin.noticesUnknown")}
            </MessageBarTitle>
            {error instanceof ApiError && error.message}
          </MessageBarBody>
        </MessageBar>
      )}

      {!boardEmpty && (
        <ListSearch
          value={query}
          onChange={setQuery}
          placeholder={t("admin.searchNoticesPlaceholder")}
        >
          {create}
        </ListSearch>
      )}

      {isFetching && !data ? (
        <DataListSkeleton columns={columns} rows={3} />
      ) : error ? null : boardEmpty ? (
        <GetStartedPanel
          art={<NoticeArt />}
          title={t("admin.noticesGetStarted.title")}
          description={t("admin.noticesGetStarted.desc")}
          steps={[
            t("admin.noticesGetStarted.step1"),
            t("admin.noticesGetStarted.step2"),
            t("admin.noticesGetStarted.step3"),
          ]}
          action={create}
        />
      ) : notices.length === 0 ? (
        <EmptyState
          icon={<MegaphoneRegular />}
          title={t("teams.noResultsMatch")}
        />
      ) : (
        <>
          <DataList columns={columns}>
            {notices.map((n) => {
              const path = `/admin/notices/${n.id}`;
              return (
                <DataListRow
                  key={n.id}
                  onClick={() => navigate(path)}
                  cells={[
                    <DataListName
                      key="n"
                      icon={
                        n.pinned ? (
                          <Tooltip
                            relationship="label"
                            content={t("admin.noticePinnedBadge")}
                          >
                            <PinRegular className={styles.pin} />
                          </Tooltip>
                        ) : undefined
                      }
                      name={<DataListLink to={path}>{n.title}</DataListLink>}
                      badges={
                        n.level !== "info" && (
                          <Badge
                            appearance="tint"
                            size="small"
                            color={levelColor(n.level)}
                          >
                            {t(`admin.noticeLevel_${n.level}`)}
                          </Badge>
                        )
                      }
                      sub={
                        n.audience === "team"
                          ? t("admin.noticeForTeam", {
                              team: n.team_name ?? n.team_id,
                            })
                          : t(`admin.noticeAudience_${n.audience}`)
                      }
                    />,
                    noticeWindow(t, n),
                    String(n.dismissal_count ?? 0),
                    n.is_published ? (
                      t("admin.noticePublished")
                    ) : (
                      <span key="s" className={styles.muted}>
                        {t("admin.noticeDraftBadge")}
                      </span>
                    ),
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
    </div>
  );
}
