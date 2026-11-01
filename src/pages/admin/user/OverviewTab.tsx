// Overview: who the account is and how it signs in — role and status,
// profile fields, the invite restriction, password and second factors,
// email addresses, and deleting the account.

import {
  Badge,
  Button,
  Field,
  Input,
  MessageBar,
  Spinner,
  Switch,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../../lib/api";
import { useApi } from "../../../lib/api-context";
import { formatDate, formatDateTime } from "../../../lib/datetime";
import { PasswordInput } from "../../../components/PasswordInput";
import { Select } from "../../../components/Select";
import {
  SettingsBody,
  SettingsCard,
  SettingsEmpty,
  SettingsFooter,
  SettingsRow,
  SettingsSubhead,
} from "../../../components/Settings";
import { SkeletonSettingsCard } from "../../../components/Skeletons";
import type { UserTabProps } from "./types";
import { clientI18n } from "../../../i18n/init";

const useStyles = makeStyles({
  muted: { color: tokens.colorNeutralForeground3 },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "16px",
    "@media (max-width: 640px)": { gridTemplateColumns: "1fr" },
  },
  danger: { color: tokens.colorPaletteRedForeground1 },
});

// Event handlers only, so the browser's i18n instance is the right one.
const fail = (err: unknown) =>
  err instanceof ApiError ? err.message : clientI18n.t("common.error");

// ─── Account: role and status ────────────────────────────────────────────────

function AccountCard({ userId, user, isSelf, showMsg }: UserTabProps) {
  const api = useApi();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const update = async (key: string, body: Record<string, unknown>) => {
    if (busy) return;
    setBusy(key);
    try {
      await api.adminUpdateUser(userId, body);
      await qc.invalidateQueries({ queryKey: ["admin-user", userId] });
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
      showMsg("success", t("admin.userUpdated"));
    } catch (err) {
      showMsg("error", fail(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsCard
      id="account"
      title={t("admin.userPage.accountTitle")}
      description={
        isSelf
          ? t("admin.userPage.accountSelfDesc")
          : t("admin.userPage.accountDesc")
      }
    >
      <SettingsRow
        label={t("admin.roleHeader")}
        description={t("admin.userPage.roleDesc")}
      >
        <Select
          aria-label={t("admin.roleHeader")}
          value={user.role}
          disabled={isSelf || busy !== null}
          onChange={(_, d) => void update("role", { role: d.value })}
        >
          <option value="user">{t("admin.userPage.roleUser")}</option>
          <option value="admin">{t("admin.userPage.roleAdmin")}</option>
        </Select>
      </SettingsRow>
      <SettingsRow
        label={t("admin.accountActive")}
        description={t("admin.userPage.activeDesc")}
      >
        <Switch
          aria-label={t("admin.accountActive")}
          checked={user.is_active}
          disabled={isSelf || busy !== null}
          onChange={(_, d) => void update("active", { is_active: d.checked })}
        />
      </SettingsRow>
      <SettingsRow
        label={t("admin.emailVerifiedToggle")}
        description={t("admin.userPage.emailVerifiedDesc")}
      >
        <Switch
          aria-label={t("admin.emailVerifiedToggle")}
          checked={user.email_verified}
          disabled={busy !== null}
          onChange={(_, d) =>
            void update("verified", { email_verified: d.checked })
          }
        />
      </SettingsRow>
      <SettingsRow label={t("admin.joinedHeader")}>
        <Text>{formatDate(user.created_at)}</Text>
      </SettingsRow>
    </SettingsCard>
  );
}

// ─── Profile: username, email, display name ──────────────────────────────────

type ProfileForm = { username: string; email: string; display_name: string };

function ProfileCard({ userId, user, showMsg }: UserTabProps) {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const saved: ProfileForm = {
    username: user.username,
    email: user.email,
    display_name: user.display_name,
  };
  // Unsaved edits sit on top of the server copy.
  const [edits, setEdits] = useState<Partial<ProfileForm>>({});
  const form = { ...saved, ...edits };
  const dirty = (Object.keys(edits) as (keyof ProfileForm)[]).filter(
    (k) => edits[k] !== saved[k],
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!dirty.length || saving) return;
    setSaving(true);
    try {
      await api.adminUpdateUser(
        userId,
        Object.fromEntries(dirty.map((k) => [k, form[k]])),
      );
      await qc.invalidateQueries({ queryKey: ["admin-user", userId] });
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
      setEdits({});
      showMsg("success", t("admin.userUpdated"));
    } catch (err) {
      showMsg("error", fail(err));
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof ProfileForm) => ({
    value: form[key],
    onChange: (_: unknown, d: { value: string }) =>
      setEdits((prev) => ({ ...prev, [key]: d.value })),
  });

  return (
    <SettingsCard
      id="profile"
      title={t("admin.identitySection")}
      description={t("admin.userPage.profileDesc")}
    >
      <SettingsBody>
        <div className={styles.grid}>
          <Field label={t("admin.usernameLabel")}>
            <Input {...field("username")} />
          </Field>
          <Field label={t("admin.displayNameLabel")}>
            <Input {...field("display_name")} />
          </Field>
        </div>
        <Field
          label={t("admin.emailHeader")}
          hint={
            edits.email !== undefined && edits.email !== saved.email
              ? t("admin.emailChangeHint")
              : undefined
          }
        >
          <Input type="email" {...field("email")} />
        </Field>
      </SettingsBody>
      <SettingsFooter>
        <Button disabled={!dirty.length || saving} onClick={() => setEdits({})}>
          {t("common.discard")}
        </Button>
        <Button
          appearance="primary"
          disabled={!dirty.length || saving}
          onClick={() => void save()}
        >
          {saving ? <Spinner size="tiny" /> : t("common.save")}
        </Button>
      </SettingsFooter>
    </SettingsCard>
  );
}

// ─── Invite-registration restriction ─────────────────────────────────────────

function RestrictionCard({ userId, user, showMsg, confirm }: UserTabProps) {
  const api = useApi();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [waiveEmail, setWaiveEmail] = useState(false);
  const [busy, setBusy] = useState(false);

  const lift = async () => {
    const ok = await confirm({
      title: t("admin.liftRestrictionTitle"),
      body: t("admin.liftRestrictionBody"),
      confirmLabel: t("admin.liftRestriction"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.adminConvertUser(userId, !waiveEmail);
      await qc.invalidateQueries({ queryKey: ["admin-user", userId] });
      showMsg("success", t("admin.restrictionLiftedDone"));
    } catch (err) {
      showMsg("error", fail(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      id="restriction"
      title={t("admin.restrictionSection")}
      description={t("admin.userPage.restrictionDesc")}
      badge={
        <Badge
          appearance="tint"
          size="small"
          color={user.converted_at ? "success" : "warning"}
        >
          {user.converted_at
            ? t("admin.restrictionLifted")
            : t("admin.restrictionActive")}
        </Badge>
      }
      action={
        <Button
          size="small"
          onClick={() => navigate(`/teams/${user.origin_team_id}`)}
        >
          {t("admin.originTeam")}
        </Button>
      }
    >
      {user.converted_at ? (
        <SettingsRow label={t("admin.restrictionLifted")}>
          <Text>{formatDateTime(user.converted_at)}</Text>
        </SettingsRow>
      ) : (
        <SettingsRow
          label={t("admin.liftRestriction")}
          description={t("admin.liftRestrictionBody")}
        >
          <Switch
            checked={waiveEmail}
            onChange={(_, d) => setWaiveEmail(d.checked)}
            label={t("admin.userPage.waiveEmail")}
          />
          <Button size="small" disabled={busy} onClick={() => void lift()}>
            {busy ? <Spinner size="tiny" /> : t("admin.liftRestriction")}
          </Button>
        </SettingsRow>
      )}
    </SettingsCard>
  );
}

// ─── Password and second factors ─────────────────────────────────────────────

function SecurityCard({ userId, showMsg, confirm }: UserTabProps) {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [settingPassword, setSettingPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [revokeSessions, setRevokeSessions] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["admin-user-security", userId],
    queryFn: () => api.adminUserSecurity(userId),
  });

  const run = async (
    key: string,
    action: () => Promise<unknown>,
    done: string,
  ) => {
    if (busy) return false;
    setBusy(key);
    try {
      await action();
      await qc.invalidateQueries({
        queryKey: ["admin-user-security", userId],
      });
      showMsg("success", done);
      return true;
    } catch (err) {
      showMsg("error", fail(err));
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <SkeletonSettingsCard rows={3} />;

  const factorCount = data.totp_authenticators.length + data.passkeys.length;
  const factors = [
    ...data.totp_authenticators.map((f) => ({
      kind: "totp" as const,
      id: f.id,
      name: f.name,
      type: t("admin.userPage.factorTotp"),
      created_at: f.created_at,
    })),
    ...data.passkeys.map((f) => ({
      kind: "passkey" as const,
      id: f.id,
      name: f.name ?? f.device_type,
      type: t("admin.userPage.factorPasskey"),
      created_at: f.created_at,
    })),
  ];

  const savePassword = async () => {
    const ok = await run(
      "password",
      () => api.adminSetUserPassword(userId, password, { revokeSessions }),
      password ? t("admin.passwordSetDone") : t("admin.passwordClearedDone"),
    );
    if (ok) {
      setSettingPassword(false);
      setPassword("");
    }
  };

  const reset2fa = async () => {
    const ok = await confirm({
      title: t("admin.reset2faTitle"),
      body: t("admin.reset2faBody"),
      confirmLabel: t("admin.reset2fa"),
    });
    if (ok)
      await run(
        "reset",
        () => api.adminReset2fa(userId),
        t("admin.twoFactorResetDone"),
      );
  };

  const removeFactor = async (f: (typeof factors)[number]) => {
    const ok = await confirm({
      title: t("admin.userPage.confirmRemove", {
        action: t("common.remove"),
        name: f.name,
      }),
      body: t("admin.actionsAreAudited"),
      confirmLabel: t("common.remove"),
    });
    if (!ok) return;
    await run(
      `factor:${f.id}`,
      () =>
        f.kind === "totp"
          ? api.adminDeleteUserTotp(userId, f.id)
          : api.adminDeleteUserPasskey(userId, f.id),
      t("common.removedDone"),
    );
  };

  return (
    <SettingsCard
      id="security"
      title={t("admin.securitySection")}
      description={t("admin.userPage.securityDesc")}
      action={
        <Button
          size="small"
          disabled={
            busy !== null ||
            (factorCount === 0 && data.recovery_codes.count <= 0)
          }
          onClick={() => void reset2fa()}
        >
          {busy === "reset" ? <Spinner size="tiny" /> : t("admin.reset2fa")}
        </Button>
      }
    >
      <SettingsRow
        label={t("admin.userPage.passwordLabel")}
        description={
          data.has_password
            ? t("admin.hasPassword")
            : t("admin.noPasswordSocialOnly")
        }
      >
        {!settingPassword && (
          <Button size="small" onClick={() => setSettingPassword(true)}>
            {t("admin.setPassword")}
          </Button>
        )}
      </SettingsRow>
      {settingPassword && (
        <>
          <SettingsBody>
            <MessageBar intent="warning">
              {t("admin.setPasswordWarning")}
            </MessageBar>
            <Field
              label={t("admin.newPasswordLabel")}
              hint={t("admin.userPage.passwordHint")}
            >
              <PasswordInput
                autoFocus
                value={password}
                onChange={(_, d) => setPassword(d.value)}
              />
            </Field>
            <Switch
              checked={revokeSessions}
              onChange={(_, d) => setRevokeSessions(d.checked)}
              label={t("admin.revokeSessionsLabel")}
            />
          </SettingsBody>
          <SettingsFooter>
            <Button
              disabled={busy !== null}
              onClick={() => {
                setSettingPassword(false);
                setPassword("");
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              appearance="primary"
              disabled={password.length < 8 || busy !== null}
              onClick={() => void savePassword()}
            >
              {busy === "password" ? (
                <Spinner size="tiny" />
              ) : (
                t("admin.setPassword")
              )}
            </Button>
          </SettingsFooter>
        </>
      )}

      <SettingsSubhead>
        {t("admin.factorCount", { count: factorCount })}
      </SettingsSubhead>
      {factors.length === 0 ? (
        <SettingsEmpty>{t("admin.noFactors")}</SettingsEmpty>
      ) : (
        factors.map((f) => (
          <SettingsRow
            key={`${f.kind}:${f.id}`}
            label={f.name}
            description={`${f.type} · ${t("admin.userPage.addedOn", {
              date: formatDate(f.created_at),
            })}`}
          >
            <Button
              size="small"
              className={styles.danger}
              disabled={busy !== null}
              onClick={() => void removeFactor(f)}
            >
              {busy === `factor:${f.id}` ? (
                <Spinner size="tiny" />
              ) : (
                t("common.remove")
              )}
            </Button>
          </SettingsRow>
        ))
      )}
      <SettingsRow label={t("admin.userPage.recoveryCodesLabel")}>
        <Text className={styles.muted}>
          {data.recovery_codes.count < 0
            ? t("admin.recoveryCodesUnreadable")
            : t("admin.recoveryCodeCount", {
                count: data.recovery_codes.count,
              })}
        </Text>
      </SettingsRow>
    </SettingsCard>
  );
}

// ─── Email addresses ─────────────────────────────────────────────────────────

function EmailsCard({ userId, showMsg, confirm }: UserTabProps) {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["admin-user-emails", userId],
    queryFn: () => api.adminUserEmails(userId),
  });

  const run = async (
    key: string,
    action: () => Promise<unknown>,
    done: string,
  ) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
      await qc.invalidateQueries({ queryKey: ["admin-user-emails", userId] });
      await qc.invalidateQueries({ queryKey: ["admin-user", userId] });
      showMsg("success", done);
    } catch (err) {
      showMsg("error", fail(err));
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <SkeletonSettingsCard rows={2} />;

  const remove = async (row: { id: string; email: string }) => {
    const ok = await confirm({
      title: t("admin.userPage.confirmRemove", {
        action: t("common.remove"),
        name: row.email,
      }),
      body: t("admin.actionsAreAudited"),
      confirmLabel: t("common.remove"),
    });
    if (ok)
      await run(
        `remove:${row.id}`,
        () => api.adminRemoveUserEmail(userId, row.id),
        t("common.removedDone"),
      );
  };

  const rows = [
    {
      id: "primary",
      email: data.primary.email,
      verified: data.primary.verified,
    },
    ...data.emails,
  ];

  return (
    <SettingsCard id="emails" title={t("admin.emailsSection")}>
      {rows.map((row) => {
        const primary = row.id === "primary";
        return (
          <SettingsRow
            key={row.id}
            label={
              <>
                <span>{row.email}</span>
                {primary && (
                  <Badge appearance="tint" color="brand" size="small">
                    {t("admin.primaryBadge")}
                  </Badge>
                )}
              </>
            }
            description={
              row.verified
                ? t("admin.verifiedStatus")
                : t("admin.unverifiedStatus")
            }
          >
            {!row.verified && (
              <Button
                size="small"
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    `verify:${row.id}`,
                    () => api.adminVerifyUserEmail(userId, row.id),
                    t("admin.emailVerifiedDone"),
                  )
                }
              >
                {t("admin.markVerified")}
              </Button>
            )}
            {!primary && (
              <>
                <Button
                  size="small"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(
                      `primary:${row.id}`,
                      () => api.adminSetPrimaryUserEmail(userId, row.id),
                      t("admin.primaryEmailDone"),
                    )
                  }
                >
                  {t("admin.makePrimary")}
                </Button>
                <Button
                  size="small"
                  className={styles.danger}
                  disabled={busy !== null}
                  onClick={() => void remove(row)}
                >
                  {t("common.remove")}
                </Button>
              </>
            )}
          </SettingsRow>
        );
      })}
    </SettingsCard>
  );
}

// ─── Delete ──────────────────────────────────────────────────────────────────

function DeleteCard({ userId, user, isSelf, showMsg, confirm }: UserTabProps) {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    const ok = await confirm({
      title: t("admin.deleteUserTitle"),
      body: t("admin.deleteUserDesc", { username: user.username }),
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.adminDeleteUser(userId);
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
      navigate("/admin/users", { replace: true });
    } catch (err) {
      showMsg("error", fail(err));
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      id="delete"
      title={t("admin.userPage.deleteTitle")}
      description={
        isSelf
          ? t("admin.userPage.deleteSelfDesc")
          : t("admin.userPage.deleteDesc")
      }
      action={
        <Button
          size="small"
          className={styles.danger}
          disabled={isSelf || busy}
          onClick={() => void remove()}
        >
          {busy ? <Spinner size="tiny" /> : t("common.delete")}
        </Button>
      }
    />
  );
}

export function OverviewTab(props: UserTabProps) {
  return (
    <>
      <AccountCard {...props} />
      <ProfileCard {...props} />
      {/* Only accounts minted through a team invite carry a restriction. */}
      {props.user.origin_team_id && <RestrictionCard {...props} />}
      <SecurityCard {...props} />
      <EmailsCard {...props} />
      <DeleteCard {...props} />
    </>
  );
}
