// New notice (/admin/notices/new). Saved as a draft unless published right
// away, so nothing half-written reaches anyone. Creating lands on the
// notice's page.

import {
  Button,
  Divider,
  MessageBar,
  Spinner,
  Switch,
  makeStyles,
} from "@fluentui/react-components";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, type NoticeInput } from "../../../lib/api";
import { useApi } from "../../../lib/api-context";
import { FormPage } from "../../../components/FormPage";
import { AudienceFields, ContentFields } from "./NoticeFields";
import { BLANK, formErrors, payloadFor, type NoticeForm } from "./noticeForm";

const useStyles = makeStyles({
  switches: { display: "flex", flexDirection: "column", gap: "4px" },
});

export function NoticeNew() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [form, setForm] = useState<NoticeForm>(BLANK);
  const [dismissible, setDismissible] = useState(true);
  const [pinned, setPinned] = useState(false);
  const [creating, setCreating] = useState<"draft" | "publish" | null>(null);
  const [error, setError] = useState("");
  // Problems show once a create has been tried, not while typing the first
  // character of a blank form.
  const [tried, setTried] = useState(false);
  const errors = formErrors(t, form);
  const valid = Object.keys(errors).length === 0;

  const update = (patch: Partial<NoticeForm>) =>
    setForm((f) => ({ ...f, ...patch }));

  const create = async (publish: boolean) => {
    if (creating) return;
    setTried(true);
    if (!valid) return;
    setCreating(publish ? "publish" : "draft");
    setError("");
    try {
      const res = await api.adminCreateNotice({
        ...(payloadFor(form) as NoticeInput),
        is_dismissible: dismissible,
        pinned,
        is_published: publish,
      });
      await qc.invalidateQueries({ queryKey: ["admin-notices"] });
      if (publish) await qc.invalidateQueries({ queryKey: ["notices"] });
      navigate(`/admin/notices/${res.notice.id}`, {
        replace: true,
        state: { created: publish ? "published" : "draft" },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.saveFailed"));
      setCreating(null);
    }
  };

  const shown = tried ? errors : {};

  return (
    <FormPage
      backTo="/admin/notices"
      backLabel={t("admin.noticesTab")}
      title={t("admin.newNotice")}
      subtitle={t("admin.noticeNewDesc")}
      // Enter in a field saves a draft, never publishes.
      onSubmit={() => void create(false)}
      actions={
        <>
          <Button type="button" onClick={() => navigate("/admin/notices")}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={creating !== null}>
            {creating === "draft" ? (
              <Spinner size="tiny" />
            ) : (
              t("admin.noticeSaveDraft")
            )}
          </Button>
          <Button
            type="button"
            appearance="primary"
            disabled={creating !== null}
            onClick={() => void create(true)}
          >
            {creating === "publish" ? (
              <Spinner size="tiny" />
            ) : (
              t("admin.publishNotice")
            )}
          </Button>
        </>
      }
    >
      {error && <MessageBar intent="error">{error}</MessageBar>}
      <ContentFields form={form} onChange={update} errors={shown} autoFocus />
      <Divider />
      <AudienceFields form={form} onChange={update} errors={shown} />
      <div className={styles.switches}>
        <Switch
          label={t("admin.noticeDismissible")}
          checked={dismissible}
          onChange={(_, d) => setDismissible(d.checked)}
        />
        <Switch
          label={t("admin.noticePinned")}
          checked={pinned}
          onChange={(_, d) => setPinned(d.checked)}
        />
      </div>
    </FormPage>
  );
}
