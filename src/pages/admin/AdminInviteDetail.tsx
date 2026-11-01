// One site invite (/admin/invites/:id): its link, whether it works, who it's
// for and how long it lasts. The switch takes effect at once; each form card
// saves on its own, sending only the fields that changed (so saving a new
// use limit doesn't restart the expiry clock).

import {
  Badge,
  Button,
  Field,
  Input,
  MessageBar,
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { ArrowLeftRegular, DeleteRegular } from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, type SiteInvite } from "../../lib/api";
import { useApi, useAppOrigin } from "../../lib/api-context";
import { formatDate } from "../../lib/datetime";
import { setDocumentPageTitle } from "../../lib/documentTitle";
import { useConfirm } from "../../lib/useConfirm";
import { useToastMessage } from "../../lib/useToastMessage";
import { CopyButton } from "../../components/CopyButton";
import {
  SettingsBody,
  SettingsCard,
  SettingsFooter,
  SettingsPage,
  SettingsRow,
  SettingsToast,
} from "../../components/Settings";
import { Segmented } from "../../components/Segmented";
import { SkeletonSettingsCard } from "../../components/Skeletons";
import { InviteModeBanner } from "./InviteModeBanner";

const useStyles = makeStyles({
  back: {
    alignSelf: "flex-start",
    marginLeft: "-8px",
    color: tokens.colorNeutralForeground3,
  },
  titles: { display: "flex", flexDirection: "column", gap: "4px" },
  titleLine: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },
  muted: { color: tokens.colorNeutralForeground3 },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    alignItems: "start",
    gap: "16px",
    "@media (max-width: 600px)": { gridTemplateColumns: "1fr" },
  },
  copyBox: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 6px 6px 12px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    background: tokens.colorNeutralBackground2,
  },
  copyValue: {
    flex: 1,
    minWidth: 0,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    overflowWrap: "anywhere",
  },
  danger: { color: tokens.colorPaletteRedForeground1 },
});

interface InviteForm {
  email: string;
  note: string;
  max_uses: string;
  expires_in_days: string;
}
type Section = "recipient" | "limits";
const SECTION_KEYS: Record<Section, (keyof InviteForm)[]> = {
  recipient: ["email", "note"],
  limits: ["max_uses", "expires_in_days"],
};

/** Days left, rounded up; 0 once it has expired. */
function formFrom(inv: SiteInvite, now: number): InviteForm {
  return {
    email: inv.email ?? "",
    note: inv.note ?? "",
    max_uses: inv.max_uses?.toString() ?? "",
    expires_in_days: inv.expires_at
      ? String(Math.max(0, Math.ceil((inv.expires_at - now) / 86400)))
      : "",
  };
}

const changed = (form: InviteForm, saved: InviteForm, k: keyof InviteForm) =>
  form[k].trim() !== saved[k].trim();

const wholeNumber = (v: string, min: number) =>
  /^\d+$/.test(v) && Number(v) >= min;

export function AdminInviteDetail() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const location = useLocation();
  const origin = useAppOrigin();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { message, showMsg } = useToastMessage();
  const { confirm, confirmDialog } = useConfirm();

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "invite", id],
    queryFn: () => api.adminGetInvite(id),
    retry: false,
  });
  const invite = data?.invite;
  const title = invite?.email ?? t("admin.inviteAnyone");

  useEffect(() => {
    if (!invite) return;
    setDocumentPageTitle(title);
    return () => setDocumentPageTitle(null);
  }, [invite, title]);

  // Arriving from the new-invite page: say so once, then drop the flag so a
  // reload doesn't repeat it.
  const justCreated = !!(location.state as { created?: boolean } | null)
    ?.created;
  useEffect(() => {
    if (!justCreated) return;
    showMsg("success", t("admin.inviteCreatedToast"));
    navigate(location.pathname, { replace: true, state: null });
  }, [justCreated, showMsg, t, navigate, location.pathname]);

  // Fixed for the visit, so "days left" doesn't drift into looking edited.
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  // Unsaved edits, field by field, over the server copy.
  const [edits, setEdits] = useState<Partial<InviteForm>>({});
  const saved = invite ? formFrom(invite, now) : null;
  const form = saved && { ...saved, ...edits };

  const [busy, setBusy] = useState<string | null>(null);
  const run = async (
    key: string,
    action: () => Promise<unknown>,
    done: string,
  ) => {
    if (busy) return false;
    setBusy(key);
    try {
      await action();
      await qc.invalidateQueries({ queryKey: ["admin", "invite", id] });
      await qc.invalidateQueries({ queryKey: ["admin", "invites"] });
      showMsg("success", done);
      return true;
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("admin.inviteUpdateFailed"),
      );
      return false;
    } finally {
      setBusy(null);
    }
  };

  const back = (
    <Button
      appearance="subtle"
      size="small"
      icon={<ArrowLeftRegular />}
      className={styles.back}
      onClick={() => navigate("/admin/invites")}
    >
      {t("admin.invitesTab")}
    </Button>
  );

  if (isLoading)
    return (
      <SettingsPage>
        {back}
        <SkeletonSettingsCard rows={2} />
        <SkeletonSettingsCard rows={2} />
      </SettingsPage>
    );
  if (error || !invite || !form || !saved)
    return (
      <SettingsPage>
        {back}
        <MessageBar intent="error">
          {error instanceof ApiError
            ? error.message
            : t("admin.inviteNotFound")}
        </MessageBar>
      </SettingsPage>
    );

  const expired = invite.expires_at !== null && invite.expires_at < now;
  const usedUp =
    invite.max_uses !== null && invite.use_count >= invite.max_uses;
  const link = `${origin}/register?invite=${invite.token}`;

  // Problems with what's typed, shown under the field once it's changed.
  const errors: Partial<Record<keyof InviteForm, string>> = {};
  const email = form.email.trim();
  if (
    changed(form, saved, "email") &&
    email &&
    !/^[^\s@]+@[^\s@]+$/.test(email)
  )
    errors.email = t("admin.inviteEmailInvalid");
  const maxUses = form.max_uses.trim();
  const minUses = Math.max(1, invite.use_count);
  if (
    changed(form, saved, "max_uses") &&
    maxUses &&
    !wholeNumber(maxUses, minUses)
  )
    errors.max_uses = t("admin.inviteMaxUsesInvalid", { count: minUses });
  const days = form.expires_in_days.trim();
  if (changed(form, saved, "expires_in_days") && days && !wholeNumber(days, 1))
    errors.expires_in_days = t("admin.inviteExpiresInvalid");

  const dirtyKeys = (section: Section) =>
    SECTION_KEYS[section].filter((k) => changed(form, saved, k));

  const save = async (section: Section) => {
    const body: Parameters<typeof api.adminUpdateInvite>[1] = {};
    for (const k of dirtyKeys(section)) {
      const v = form[k].trim();
      if (k === "email" || k === "note") body[k] = v || null;
      else body[k] = v ? Number(v) : null;
    }
    // What was sent, so edits typed while the request is in flight survive
    // it instead of being cleared along with the saved ones.
    const sent = new Map(SECTION_KEYS[section].map((k) => [k, form[k]]));
    const ok = await run(
      section,
      () => api.adminUpdateInvite(id, body),
      t("admin.inviteSaved"),
    );
    if (ok)
      setEdits((e) => {
        const next = { ...e };
        for (const [k, value] of sent) if (next[k] === value) delete next[k];
        return next;
      });
  };

  function discard(section: Section) {
    setEdits((e) => {
      const next = { ...e };
      for (const k of SECTION_KEYS[section]) delete next[k];
      return next;
    });
  }

  const revoke = async () => {
    const ok = await confirm({
      title: t("admin.inviteRevokeConfirm"),
      body: t("admin.inviteRevokeBody"),
      confirmLabel: t("admin.inviteRevoke"),
    });
    if (!ok) return;
    setBusy("revoke");
    try {
      await api.adminRevokeInvite(id);
      await qc.invalidateQueries({ queryKey: ["admin", "invites"] });
      navigate("/admin/invites", { replace: true });
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("admin.inviteUpdateFailed"),
      );
      setBusy(null);
    }
  };

  const set = (k: keyof InviteForm) => ({
    value: form[k],
    onChange: (_: unknown, d: { value: string }) =>
      setEdits((e) => ({ ...e, [k]: d.value })),
  });
  const fieldState = (k: keyof InviteForm, hint?: string) =>
    errors[k]
      ? { validationState: "error" as const, validationMessage: errors[k] }
      : { hint };

  const footer = (section: Section) => {
    const dirty = dirtyKeys(section).length > 0;
    const valid = SECTION_KEYS[section].every((k) => !errors[k]);
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

  const expiryHint = !invite.expires_at
    ? t("admin.inviteExpiryNone")
    : expired
      ? t("admin.inviteExpiryPast", { date: formatDate(invite.expires_at) })
      : t("admin.inviteExpiryCurrent", { date: formatDate(invite.expires_at) });

  return (
    <SettingsPage>
      {back}
      <div className={styles.titles}>
        <div className={styles.titleLine}>
          <Title2 as="h1">{title}</Title2>
          {!invite.enabled && (
            <Badge appearance="tint" color="danger">
              {t("admin.inviteDisabled")}
            </Badge>
          )}
          {expired && (
            <Badge appearance="tint" color="warning">
              {t("admin.inviteExpired")}
            </Badge>
          )}
          {usedUp && (
            <Badge appearance="tint" color="warning">
              {t("admin.inviteUsedUp")}
            </Badge>
          )}
        </div>
        <Text className={styles.muted}>
          {t("admin.inviteSummary", {
            uses: `${invite.use_count} / ${invite.max_uses ?? "∞"}`,
            date: formatDate(invite.created_at),
            who: invite.created_by_username
              ? `@${invite.created_by_username}`
              : invite.created_by,
          })}
        </Text>
      </div>

      <InviteModeBanner />
      <SettingsToast message={message} />

      <SettingsCard
        id="link"
        title={t("admin.inviteLinkTitle")}
        description={
          invite.email
            ? t("admin.inviteLinkDescEmail", { email: invite.email })
            : t("admin.inviteLinkDesc")
        }
      >
        <SettingsBody>
          {invite.token_available === false ? (
            <MessageBar>{t("admin.hashedInviteCopyHint")}</MessageBar>
          ) : (
            <div className={styles.copyBox}>
              <span className={styles.copyValue}>{link}</span>
              <CopyButton text={link} label={t("admin.copyInviteLink")} />
            </div>
          )}
        </SettingsBody>
        <SettingsRow
          label={t("admin.inviteActiveLabel")}
          description={t("admin.inviteActiveDesc")}
        >
          <Segmented
            label={t("admin.inviteActiveLabel")}
            value={invite.enabled ? "active" : "paused"}
            disabled={busy !== null}
            options={[
              { value: "active", label: t("admin.inviteStatusActive") },
              { value: "paused", label: t("admin.inviteStatusPaused") },
            ]}
            onChange={(v) =>
              void run(
                "enabled",
                () => api.adminUpdateInvite(id, { enabled: v === "active" }),
                v === "active"
                  ? t("admin.inviteEnabledDone")
                  : t("admin.inviteDisabledDone"),
              )
            }
          />
        </SettingsRow>
      </SettingsCard>

      <SettingsCard
        id="recipient"
        title={t("admin.inviteRecipientTitle")}
        description={t("admin.inviteRecipientDesc")}
      >
        <SettingsBody>
          <div className={styles.grid}>
            <Field
              label={t("admin.inviteEmail")}
              {...fieldState("email", t("admin.inviteEmailHint"))}
            >
              <Input type="email" autoComplete="off" {...set("email")} />
            </Field>
            <Field
              label={t("admin.inviteNote")}
              {...fieldState("note", t("admin.inviteNoteHint"))}
            >
              <Input autoComplete="off" {...set("note")} />
            </Field>
          </div>
        </SettingsBody>
        {footer("recipient")}
      </SettingsCard>

      <SettingsCard
        id="limits"
        title={t("admin.inviteLimitsTitle")}
        description={t("admin.inviteLimitsDesc")}
      >
        <SettingsBody>
          <div className={styles.grid}>
            <Field
              label={t("admin.inviteMaxUses")}
              {...fieldState(
                "max_uses",
                t("admin.inviteUsedSoFar", { count: invite.use_count }),
              )}
            >
              <Input
                type="number"
                min={minUses}
                placeholder={t("admin.inviteUnlimited")}
                {...set("max_uses")}
              />
            </Field>
            <Field
              label={t("admin.inviteExpiresIn")}
              {...fieldState("expires_in_days", expiryHint)}
            >
              <Input
                type="number"
                min={1}
                placeholder={t("admin.inviteNoExpiry")}
                {...set("expires_in_days")}
              />
            </Field>
          </div>
        </SettingsBody>
        {footer("limits")}
      </SettingsCard>

      <SettingsCard id="danger" title={t("admin.inviteDangerTitle")}>
        <SettingsRow
          label={t("admin.inviteRevokeLabel")}
          description={t("admin.inviteRevokeBody")}
        >
          <Button
            size="small"
            icon={<DeleteRegular />}
            className={styles.danger}
            disabled={busy !== null}
            onClick={() => void revoke()}
          >
            {busy === "revoke" ? (
              <Spinner size="tiny" />
            ) : (
              t("admin.inviteRevoke")
            )}
          </Button>
        </SettingsRow>
      </SettingsCard>

      {confirmDialog}
    </SettingsPage>
  );
}
