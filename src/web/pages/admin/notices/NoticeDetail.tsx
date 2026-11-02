// One notice (/admin/notices/:id). Status choices take effect at once; the content
// and audience cards each save on their own, keeping edits typed while a
// save is in flight.

import {
  Badge,
  Button,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowCounterclockwiseRegular,
  DeleteRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, type NoticeInput } from "../../../lib/api";
import { apiErrorText } from "../../../lib/apiError";
import { useApi } from "../../../lib/api-context";
import { formatDate } from "../../../lib/datetime";
import { setDocumentPageTitle } from "../../../lib/documentTitle";
import { useConfirm } from "../../../lib/useConfirm";
import { useToastMessage } from "../../../lib/useToastMessage";
import {
  SettingsBody,
  SettingsCard,
  SettingsFooter,
  SettingsPage,
  SettingsRow,
  SettingsToast,
} from "../../../components/Settings";
import { Segmented } from "../../../components/Segmented";
import { SkeletonSettingsCard } from "../../../components/Skeletons";
import { AudienceFields, ContentFields } from "./NoticeFields";
import {
  SECTION_FIELDS,
  formErrors,
  formFromNotice,
  levelColor,
  noticeWindow,
  payloadFor,
  sectionDirty,
  type NoticeForm,
  type Section,
} from "./noticeForm";
import { BackButton, DetailHeader } from "../../../components/DetailHeader";

const useStyles = makeStyles({
  muted: { color: tokens.colorNeutralForeground3 },
  danger: { color: tokens.colorPaletteRedForeground1 },
});

export function NoticeDetail() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { message, showMsg } = useToastMessage();
  const { confirm, confirmDialog } = useConfirm();

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-notice", id],
    queryFn: () => api.adminGetNotice(id),
    retry: false,
  });
  const notice = data?.notice;

  useEffect(() => {
    if (!notice?.title) return;
    setDocumentPageTitle(notice.title);
    return () => setDocumentPageTitle(null);
  }, [notice?.title]);

  // Arriving from the new-notice page: say so once, then drop the flag so a
  // reload doesn't repeat it.
  const created = (location.state as { created?: string } | null)?.created;
  useEffect(() => {
    if (!created) return;
    showMsg(
      "success",
      created === "published"
        ? t("admin.noticePublishedDone")
        : t("admin.noticeCreated"),
    );
    navigate(location.pathname, { replace: true, state: null });
  }, [created, showMsg, t, navigate, location.pathname]);

  // Unsaved edits, field by field, over the server copy.
  const [edits, setEdits] = useState<Partial<NoticeForm>>({});
  const saved = notice ? formFromNotice(notice) : null;
  const form: NoticeForm | null = saved && { ...saved, ...edits };

  // Which save or switch is in flight; one at a time.
  const [busy, setBusy] = useState<string | null>(null);
  const run = async <T,>(
    key: string,
    action: () => Promise<T>,
    done: (result: T) => string,
  ) => {
    if (busy) return false;
    setBusy(key);
    try {
      const result = await action();
      await qc.invalidateQueries({ queryKey: ["admin-notice", id] });
      await qc.invalidateQueries({ queryKey: ["admin-notices"] });
      // The board the admin sees is its own query.
      await qc.invalidateQueries({ queryKey: ["notices"] });
      showMsg("success", done(result));
      return true;
    } catch (err) {
      showMsg("error", apiErrorText(err, t("common.saveFailed")));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const patch = (
    key: string,
    body: Partial<NoticeInput> & { reset_dismissals?: boolean },
    done: string,
  ) =>
    run(
      key,
      () => api.adminUpdateNotice(id, body),
      () => done,
    );

  const back = (
    <BackButton to={"/admin/notices"}>{t("admin.noticesTab")}</BackButton>
  );

  if (isLoading)
    return (
      <SettingsPage>
        {back}
        <SkeletonSettingsCard rows={3} />
        <SkeletonSettingsCard rows={3} form />
        <SkeletonSettingsCard rows={3} form />
      </SettingsPage>
    );
  if (error || !notice || !form || !saved)
    return (
      <SettingsPage>
        {back}
        <MessageBar intent="error">
          <MessageBarBody>
            {error instanceof ApiError && error.status === 503 && (
              <MessageBarTitle>{t("admin.noticesUnavailable")}</MessageBarTitle>
            )}
            {apiErrorText(error, t("admin.noticeNotFound"))}
          </MessageBarBody>
        </MessageBar>
      </SettingsPage>
    );

  const errors = formErrors(t, form);
  const update = (patch: Partial<NoticeForm>) =>
    setEdits((e) => ({ ...e, ...patch }));

  const save = async (section: Section) => {
    // What was sent, so edits typed while the request is in flight survive
    // it instead of being cleared along with the saved ones.
    const sent = new Map(SECTION_FIELDS[section].map((k) => [k, form[k]]));
    const ok = await patch(
      section,
      payloadFor(form, [section]),
      t("admin.noticeUpdated"),
    );
    if (ok)
      setEdits((e) => {
        const next = { ...e };
        for (const [k, value] of sent) if (next[k] === value) delete next[k];
        return next;
      });
  };
  const discard = (section: Section) =>
    setEdits((e) => {
      const next = { ...e };
      for (const k of SECTION_FIELDS[section]) delete next[k];
      return next;
    });

  const footer = (section: Section) => {
    const dirty = sectionDirty(section, form, saved);
    const valid = SECTION_FIELDS[section].every((k) => !errors[k]);
    return (
      <SettingsFooter>
        {dirty && busy !== section && (
          <Button appearance="subtle" onClick={() => discard(section)}>
            {t("common.discard")}
          </Button>
        )}
        <Button
          appearance="primary"
          disabled={!dirty || !valid || busy !== null}
          onClick={() => void save(section)}
        >
          {busy === section ? <Spinner size="tiny" /> : t("common.saveChanges")}
        </Button>
      </SettingsFooter>
    );
  };

  // Only problems with what's been changed; the saved copy is valid.
  const shown = (section: Section) =>
    sectionDirty(section, form, saved) ? errors : {};

  const remove = async () => {
    const ok = await confirm({
      title: t("admin.deleteNoticeTitle"),
      body: t("admin.deleteNoticeBody", { title: notice.title }),
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    setBusy("delete");
    try {
      await api.adminDeleteNotice(id);
      await qc.invalidateQueries({ queryKey: ["admin-notices"] });
      await qc.invalidateQueries({ queryKey: ["notices"] });
      navigate("/admin/notices", { replace: true });
    } catch (err) {
      showMsg("error", apiErrorText(err, t("common.saveFailed")));
      setBusy(null);
    }
  };

  const dismissals = notice.dismissal_count ?? 0;

  return (
    <SettingsPage>
      {back}
      <DetailHeader
        title={notice.title}
        badges={
          <>
            {!notice.is_published && (
              <Badge appearance="tint" color="subtle">
                {t("admin.noticeDraftBadge")}
              </Badge>
            )}
            {notice.level !== "info" && (
              <Badge appearance="tint" color={levelColor(notice.level)}>
                {t(`admin.noticeLevel_${notice.level}`)}
              </Badge>
            )}
          </>
        }
        subtitle={
          <>
            {t("admin.noticeSummary", {
              audience:
                notice.audience === "team"
                  ? t("admin.noticeForTeam", {
                      team: notice.team_name ?? notice.team_id,
                    })
                  : t(`admin.noticeAudience_${notice.audience}`),
              window: noticeWindow(t, notice),
              date: formatDate(notice.created_at),
              who: notice.created_by_username
                ? `@${notice.created_by_username}`
                : (notice.created_by ?? "—"),
            })}
          </>
        }
      />

      <SettingsToast message={message} />

      <SettingsCard
        id="status"
        title={t("admin.noticeStatusTitle")}
        description={t("admin.noticeStatusDesc")}
      >
        <SettingsRow
          label={t("admin.noticeVisibilityLabel")}
          description={t("admin.noticePublishedDesc")}
        >
          <Segmented
            label={t("admin.noticeVisibilityLabel")}
            value={!!notice.is_published}
            disabled={busy !== null}
            options={[
              { value: false, label: t("admin.noticeDraftBadge") },
              { value: true, label: t("admin.noticePublished") },
            ]}
            onChange={(v) =>
              void patch(
                "published",
                { is_published: v },
                v
                  ? t("admin.noticePublishedDone")
                  : t("admin.noticeUnpublishedDone"),
              )
            }
          />
        </SettingsRow>
        <SettingsRow
          label={t("admin.noticePositionLabel")}
          description={t("admin.noticePinnedDesc")}
        >
          <Segmented
            label={t("admin.noticePositionLabel")}
            value={!!notice.pinned}
            disabled={busy !== null}
            options={[
              { value: false, label: t("admin.noticePositionByDate") },
              { value: true, label: t("admin.noticePinnedBadge") },
            ]}
            onChange={(v) =>
              void patch("pinned", { pinned: v }, t("admin.noticeUpdated"))
            }
          />
        </SettingsRow>
        <SettingsRow
          label={t("admin.noticeDismissLabel")}
          description={t("admin.noticeDismissibleDesc")}
        >
          <Segmented
            label={t("admin.noticeDismissLabel")}
            value={!!notice.is_dismissible}
            disabled={busy !== null}
            options={[
              { value: false, label: t("admin.choiceNotAllowed") },
              { value: true, label: t("admin.choiceAllowed") },
            ]}
            onChange={(v) =>
              void patch(
                "dismissible",
                { is_dismissible: v },
                t("admin.noticeUpdated"),
              )
            }
          />
        </SettingsRow>
        <SettingsRow
          label={t("admin.noticeDismissalsLabel")}
          description={t("admin.noticeDismissalsDesc", { count: dismissals })}
        >
          <Button
            size="small"
            icon={<ArrowCounterclockwiseRegular />}
            disabled={!dismissals || busy !== null}
            onClick={() =>
              void run(
                "reset",
                () => api.adminUpdateNotice(id, { reset_dismissals: true }),
                (r) =>
                  t("admin.dismissalsReset", { count: r.dismissals_reset }),
              )
            }
          >
            {busy === "reset" ? (
              <Spinner size="tiny" />
            ) : (
              t("admin.noticeShowAgain")
            )}
          </Button>
        </SettingsRow>
      </SettingsCard>

      <SettingsCard
        id="content"
        title={t("admin.noticeContentTitle")}
        description={t("admin.noticeContentDesc")}
      >
        <SettingsBody>
          <ContentFields
            form={form}
            onChange={update}
            errors={shown("content")}
          />
        </SettingsBody>
        {footer("content")}
      </SettingsCard>

      <SettingsCard
        id="audience"
        title={t("admin.noticeAudienceTitle")}
        description={t("admin.noticeAudienceDesc")}
      >
        <SettingsBody>
          <AudienceFields
            form={form}
            onChange={update}
            errors={shown("audience")}
          />
        </SettingsBody>
        {footer("audience")}
      </SettingsCard>

      <SettingsCard id="danger" title={t("admin.noticeDangerTitle")}>
        <SettingsRow
          label={t("admin.noticeDeleteLabel")}
          description={t("admin.noticeDeleteDesc")}
        >
          <Button
            size="small"
            icon={<DeleteRegular />}
            className={styles.danger}
            disabled={busy !== null}
            onClick={() => void remove()}
          >
            {busy === "delete" ? <Spinner size="tiny" /> : t("common.delete")}
          </Button>
        </SettingsRow>
      </SettingsCard>

      {confirmDialog}
    </SettingsPage>
  );
}
