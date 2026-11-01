// New site invite (/admin/invites/new): a link that lets someone register
// while sign-up is invite-only. After creating, the page shows the link once
// so it can be copied.

import {
  Button,
  Field,
  Input,
  MessageBar,
  Spinner,
  Switch,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { CopyButton } from "../../components/CopyButton";
import { FormPage } from "../../components/FormPage";

const useStyles = makeStyles({
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "16px",
    "@media (max-width: 600px)": { gridTemplateColumns: "1fr" },
  },
  link: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 8px 8px 12px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
  },
  url: {
    flex: 1,
    minWidth: 0,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    overflowWrap: "anywhere",
  },
});

const EMPTY = {
  email: "",
  note: "",
  max_uses: "",
  expires_in_days: "",
  send_email: false,
};

export function AdminInviteNew() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [form, setForm] = useState(EMPTY);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<string | null>(null);

  const set = (key: keyof typeof EMPTY) => (_: unknown, d: { value: string }) =>
    setForm((f) => ({ ...f, [key]: d.value }));

  const create = async () => {
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const res = await api.adminCreateInvite({
        email: form.email.trim() || undefined,
        note: form.note.trim() || undefined,
        max_uses: form.max_uses ? parseInt(form.max_uses, 10) : undefined,
        expires_in_days: form.expires_in_days
          ? parseInt(form.expires_in_days, 10)
          : undefined,
        send_email: !!form.email.trim() && form.send_email,
      });
      await qc.invalidateQueries({ queryKey: ["admin", "invites"] });
      setCreated(res.invite.invite_url);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t("admin.inviteCreateFailed"),
      );
    } finally {
      setCreating(false);
    }
  };

  if (created) {
    return (
      <FormPage
        backTo="/admin/invites"
        backLabel={t("admin.invitesTab")}
        title={t("admin.inviteCreatedTitle")}
        subtitle={t("admin.inviteCreatedDesc")}
        actions={
          <>
            <Button
              onClick={() => {
                setCreated(null);
                setForm(EMPTY);
              }}
            >
              {t("admin.inviteCreateAnother")}
            </Button>
            <Button
              appearance="primary"
              onClick={() => navigate("/admin/invites")}
            >
              {t("common.done")}
            </Button>
          </>
        }
      >
        <div className={styles.link}>
          <span className={styles.url}>{created}</span>
          <CopyButton text={created} label={t("admin.copyInviteLink")} />
        </div>
      </FormPage>
    );
  }

  return (
    <FormPage
      backTo="/admin/invites"
      backLabel={t("admin.invitesTab")}
      title={t("admin.createInvite")}
      subtitle={t("admin.inviteNewDesc")}
      onSubmit={() => void create()}
      actions={
        <>
          <Button type="button" onClick={() => navigate("/admin/invites")}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" appearance="primary" disabled={creating}>
            {creating ? <Spinner size="tiny" /> : t("admin.createInvite")}
          </Button>
        </>
      }
    >
      {error && <MessageBar intent="error">{error}</MessageBar>}
      <Field label={t("admin.inviteEmail")} hint={t("admin.inviteEmailHint")}>
        <Input
          type="email"
          autoFocus
          value={form.email}
          onChange={set("email")}
          placeholder="user@example.com"
        />
      </Field>
      <Switch
        label={t("admin.inviteSendEmail")}
        checked={form.send_email}
        disabled={!form.email.trim()}
        onChange={(_, d) => setForm((f) => ({ ...f, send_email: d.checked }))}
      />
      <Field label={t("admin.inviteNote")} hint={t("admin.inviteNoteHint")}>
        <Input value={form.note} onChange={set("note")} />
      </Field>
      <div className={styles.grid}>
        <Field
          label={t("admin.inviteMaxUses")}
          hint={t("admin.inviteMaxUsesHint")}
        >
          <Input
            type="number"
            min={1}
            value={form.max_uses}
            onChange={set("max_uses")}
            placeholder={t("admin.inviteUnlimited")}
          />
        </Field>
        <Field label={t("admin.inviteExpiresIn")}>
          <Input
            type="number"
            min={1}
            value={form.expires_in_days}
            onChange={set("expires_in_days")}
            placeholder={t("admin.inviteNoExpiry")}
          />
        </Field>
      </div>
    </FormPage>
  );
}
