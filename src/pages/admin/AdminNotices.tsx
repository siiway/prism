// Admin notices: announcements shown at the top of every page. Each row can
// be published or taken down in place and opens the notice's page; New
// notice opens /admin/notices/new.

import {
  Badge,
  Button,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Skeleton,
  SkeletonItem,
  Spinner,
  Switch,
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
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, type AdminNotice } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { useDebouncedSearch } from "../../lib/useDebouncedSearch";
import { usePageClamp } from "../../lib/usePageClamp";
import { useToastMessage } from "../../lib/useToastMessage";
import {
  DataList,
  DataListName,
  DataListRow,
  type DataListColumn,
} from "../../components/DataList";
import { EmptyState } from "../../components/EmptyState";
import { GetStartedPanel } from "../../components/GetStartedPanel";
import { NoticeArt } from "../../components/Illustrations";
import { ListSearch } from "../../components/ListSearch";
import { Pagination } from "../../components/Pagination";
import { SettingsToast } from "../../components/Settings";
import { levelColor, noticeWindow } from "./notices/noticeForm";

const PAGE_SIZE = 20;

const useStyles = makeStyles({
  toast: { position: "sticky", top: "8px", zIndex: 2, marginBottom: "12px" },
  banner: { marginBottom: "12px" },
  badges: { display: "flex", gap: "4px", flexWrap: "wrap" },
  pin: { color: tokens.colorNeutralForeground3, flexShrink: 0 },
  name: {
    color: tokens.colorNeutralForeground1,
    textDecorationLine: "none",
    ":hover": { textDecorationLine: "underline" },
  },
});

export function AdminNotices() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { message, showMsg } = useToastMessage();

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

  const [busy, setBusy] = useState<string | null>(null);
  const togglePublished = async (n: AdminNotice, published: boolean) => {
    if (busy) return;
    setBusy(n.id);
    try {
      await api.adminUpdateNotice(n.id, { is_published: published });
      await qc.invalidateQueries({ queryKey: ["admin-notices"] });
      await qc.invalidateQueries({ queryKey: ["admin-notice", n.id] });
      // The board the admin sees is its own query.
      await qc.invalidateQueries({ queryKey: ["notices"] });
      showMsg(
        "success",
        published
          ? t("admin.noticePublishedDone")
          : t("admin.noticeUnpublishedDone"),
      );
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.saveFailed"),
      );
    } finally {
      setBusy(null);
    }
  };

  const columns: DataListColumn[] = [
    { label: t("admin.noticeTitle"), width: "minmax(0, 2fr)" },
    {
      label: t("admin.noticeWindow"),
      width: "minmax(0, 1.2fr)",
      secondary: true,
    },
    { label: t("admin.noticeDismissedCol"), width: "90px", secondary: true },
    { label: t("admin.noticePublished"), width: "84px", end: true },
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
      {message && (
        <div className={styles.toast}>
          <SettingsToast message={message} />
        </div>
      )}

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
        <Skeleton aria-busy>
          <DataList columns={columns}>
            {Array.from({ length: 3 }).map((_, i) => (
              <DataListRow
                key={i}
                cells={columns.map((_, c) => (
                  <SkeletonItem key={c} size={12} style={{ width: "60%" }} />
                ))}
              />
            ))}
          </DataList>
        </Skeleton>
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
                      name={
                        // A real link: keyboard, middle-click, new tab.
                        <Link
                          to={path}
                          className={styles.name}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {n.title}
                        </Link>
                      }
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
                    <span key="sw" onClick={(e) => e.stopPropagation()}>
                      {busy === n.id ? (
                        <Spinner size="tiny" />
                      ) : (
                        <Switch
                          aria-label={t("admin.noticePublishLabelFor", {
                            title: n.title,
                          })}
                          checked={n.is_published}
                          disabled={busy !== null}
                          onChange={(_, d) =>
                            void togglePublished(n, d.checked)
                          }
                        />
                      )}
                    </span>,
                  ]}
                />
              );
            })}
          </DataList>
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
