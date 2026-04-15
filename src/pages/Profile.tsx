// User profile page

import {
  Avatar,
  Badge,
  Button,
  Dropdown,
  Field,
  Input,
  MessageBar,
  Option,
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowUpRegular,
  DeleteRegular,
  MailRegular,
} from "@fluentui/react-icons";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../store/auth";
import { ImageUrlInput } from "../components/ImageUrlInput";
import {
  SkeletonProfileCard,
  SkeletonEmailCard,
  SkeletonFormCard,
} from "../components/Skeletons";

const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: "32px" },
  card: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "8px",
    padding: "24px",
    background: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  avatarRow: { display: "flex", alignItems: "center", gap: "20px" },
  form: { display: "flex", flexDirection: "column", gap: "12px" },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    "@media (max-width: 600px)": {
      gridTemplateColumns: "1fr",
    },
  },
  actions: { display: "flex", gap: "8px" },
  emailRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    borderRadius: "6px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground3,
  },
  emailActions: {
    display: "flex",
    gap: "4px",
    marginLeft: "auto",
    flexShrink: 0,
  },
});

export function Profile() {
  const styles = useStyles();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, setAuth, token } = useAuthStore();
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });
  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
  });

  const r2Enabled = site?.r2_enabled ?? true; // optimistically show upload until site loads

  const { data: emails, refetch: refetchEmails } = useQuery({
    queryKey: ["emails"],
    queryFn: api.listEmails,
  });

  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.unproxied_avatar_url ?? "");
  const [saveLoading, setSaveLoading] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [pwForm, setPwForm] = useState({ current: "", next: "" });
  const [pwLoading, setPwLoading] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const handleSave = async () => {
    setSaveLoading(true);
    try {
      const body: Parameters<typeof api.updateMe>[0] = {
        display_name: displayName,
      };
      if (!r2Enabled) body.avatar_url = avatarUrl || undefined;
      const res = await api.updateMe(body);
      if (token && res.user) setAuth(token, res.user);
      await qc.invalidateQueries({ queryKey: ["me"] });
      showMsg("success", t("profile.profileUpdated"));
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setSaveLoading(false);
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarLoading(true);
    try {
      const res = await api.uploadAvatar(file);
      if (token) setAuth(token, { ...user!, avatar_url: res.avatar_url });
      await qc.invalidateQueries({ queryKey: ["me"] });
      showMsg("success", t("profile.avatarUpdated"));
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setAvatarLoading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwLoading(true);
    try {
      await api.changePassword(pwForm.current, pwForm.next);
      setPwForm({ current: "", next: "" });
      showMsg("success", t("profile.passwordChanged"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError
          ? err.message
          : t("profile.passwordChangeFailed"),
      );
    } finally {
      setPwLoading(false);
    }
  };

  if (isLoading)
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
        <SkeletonProfileCard />
        <SkeletonEmailCard />
        <SkeletonFormCard rows={2} />
      </div>
    );

  return (
    <div className={styles.page}>
      <Title2>{t("profile.title")}</Title2>

      {message && (
        <MessageBar intent={message.type === "success" ? "success" : "error"}>
          {message.text}
        </MessageBar>
      )}

      {/* Avatar + basic info */}
      <div className={styles.card}>
        <Text weight="semibold" size={400}>
          {t("profile.basicInformation")}
        </Text>
        <div className={styles.avatarRow}>
          <Avatar
            name={me?.user.display_name}
            image={
              me?.user.avatar_url ? { src: me.user.avatar_url } : undefined
            }
            size={72}
          />
          {r2Enabled ? (
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleAvatarChange}
              />
              <Button
                size="small"
                disabled={avatarLoading}
                onClick={() => fileRef.current?.click()}
              >
                {avatarLoading ? (
                  <Spinner size="tiny" />
                ) : (
                  t("profile.changeAvatar")
                )}
              </Button>
              <Text
                size={200}
                block
                style={{ color: tokens.colorNeutralForeground3, marginTop: 4 }}
              >
                {t("profile.avatarFormats")}
              </Text>
            </div>
          ) : (
            <ImageUrlInput
              label={t("profile.avatarUrl")}
              value={avatarUrl}
              onChange={setAvatarUrl}
              placeholder={t("profile.avatarPlaceholder")}
            />
          )}
        </div>

        <div className={styles.form}>
          <div className={styles.row}>
            <Field label={t("profile.usernameLabel")}>
              <Input
                value={me?.user.username}
                readOnly
                appearance="filled-lighter"
              />
            </Field>
            <Field
              label={t("profile.emailLabel")}
              hint={
                me && !me.user.email_verified ? (
                  <Button
                    appearance="transparent"
                    size="small"
                    style={{ padding: 0, minWidth: 0, height: "auto" }}
                    onClick={() => navigate("/verify-choose")}
                  >
                    {t("profile.verifyEmail")}
                  </Button>
                ) : undefined
              }
            >
              <Input
                value={me?.user.email}
                readOnly
                appearance="filled-lighter"
                contentAfter={
                  me?.user.email_verified ? (
                    <Badge color="success" appearance="filled" size="small">
                      {t("profile.verified")}
                    </Badge>
                  ) : (
                    <Badge color="warning" appearance="filled" size="small">
                      {t("profile.unverified")}
                    </Badge>
                  )
                }
              />
            </Field>
          </div>
          <Field label={t("profile.displayName")}>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>
          <div className={styles.actions}>
            <Button
              appearance="primary"
              onClick={handleSave}
              disabled={saveLoading}
            >
              {saveLoading ? <Spinner size="tiny" /> : t("common.saveChanges")}
            </Button>
          </div>
        </div>
      </div>

      {/* Email addresses */}
      <div className={styles.card}>
        <Text weight="semibold" size={400}>
          {t("profile.emailAddresses")}
        </Text>

        {/* Primary email */}
        {emails && (
          <div className={styles.emailRow}>
            <MailRegular />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text weight="semibold" style={{ wordBreak: "break-all" }}>
                {emails.primary.email}
              </Text>
              <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                <Badge
                  color={emails.primary.verified ? "success" : "warning"}
                  appearance="filled"
                  size="small"
                >
                  {emails.primary.verified
                    ? t("profile.verified")
                    : t("profile.unverified")}
                </Badge>
                <Badge color="informative" appearance="outline" size="small">
                  {t("profile.primary")}
                </Badge>
              </div>
            </div>
            {!emails.primary.verified && (
              <Button
                appearance="transparent"
                size="small"
                onClick={() => navigate("/verify-choose")}
              >
                {t("profile.verifyEmail")}
              </Button>
            )}
          </div>
        )}

        {/* Alternate emails */}
        {emails?.emails.map((alt) => (
          <div key={alt.id} className={styles.emailRow}>
            <MailRegular />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ wordBreak: "break-all" }}>{alt.email}</Text>
              <div style={{ marginTop: 2 }}>
                <Badge
                  color={alt.verified ? "success" : "warning"}
                  appearance="filled"
                  size="small"
                >
                  {alt.verified
                    ? t("profile.verified")
                    : t("profile.unverified")}
                </Badge>
              </div>
            </div>
            <div className={styles.emailActions}>
              {!alt.verified && (
                <Button
                  appearance="subtle"
                  size="small"
                  onClick={async () => {
                    try {
                      await api.resendEmailVerify(alt.id);
                      showMsg("success", t("profile.verifySent"));
                    } catch (err) {
                      showMsg(
                        "error",
                        err instanceof ApiError
                          ? err.message
                          : t("common.error"),
                      );
                    }
                  }}
                >
                  {t("profile.resend")}
                </Button>
              )}
              {alt.verified && (
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<ArrowUpRegular />}
                  title={t("profile.makePrimary")}
                  onClick={async () => {
                    try {
                      await api.setEmailPrimary(alt.id);
                      await refetchEmails();
                      await qc.invalidateQueries({ queryKey: ["me"] });
                      showMsg("success", t("profile.primaryUpdated"));
                    } catch (err) {
                      showMsg(
                        "error",
                        err instanceof ApiError
                          ? err.message
                          : t("common.error"),
                      );
                    }
                  }}
                />
              )}
              <Button
                appearance="subtle"
                size="small"
                icon={<DeleteRegular />}
                title={t("common.remove")}
                onClick={async () => {
                  try {
                    await api.removeEmail(alt.id);
                    await refetchEmails();
                    showMsg("success", t("profile.emailRemoved"));
                  } catch (err) {
                    showMsg(
                      "error",
                      err instanceof ApiError ? err.message : t("common.error"),
                    );
                  }
                }}
              />
            </div>
          </div>
        ))}

        {/* Add new email */}
        <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
          <Field label={t("profile.addEmail")} style={{ flex: 1 }}>
            <Input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="user@example.com"
            />
          </Field>
          <Button
            appearance="primary"
            size="small"
            icon={emailLoading ? <Spinner size="tiny" /> : <AddRegular />}
            disabled={emailLoading || !newEmail.trim()}
            onClick={async () => {
              setEmailLoading(true);
              try {
                await api.addEmail(newEmail.trim());
                setNewEmail("");
                await refetchEmails();
                showMsg("success", t("profile.emailAdded"));
              } catch (err) {
                showMsg(
                  "error",
                  err instanceof ApiError ? err.message : t("common.error"),
                );
              } finally {
                setEmailLoading(false);
              }
            }}
            style={{ marginBottom: 1 }}
          >
            {t("common.add")}
          </Button>
        </div>

        {/* Per-user alt email login toggle */}
        {emails && emails.emails.length > 0 && (
          <Field
            label={t("profile.altEmailLogin")}
            hint={t("profile.altEmailLoginHint")}
          >
            <Dropdown
              value={
                me?.user.alt_email_login === 1
                  ? t("profile.altEmailAllow")
                  : me?.user.alt_email_login === 0
                    ? t("profile.altEmailDeny")
                    : t("profile.altEmailDefault")
              }
              selectedOptions={[
                me?.user.alt_email_login === 1
                  ? "allow"
                  : me?.user.alt_email_login === 0
                    ? "deny"
                    : "default",
              ]}
              onOptionSelect={async (_, d) => {
                const val =
                  d.optionValue === "allow"
                    ? true
                    : d.optionValue === "deny"
                      ? false
                      : null;
                try {
                  await api.updateMe({ alt_email_login: val });
                  await qc.invalidateQueries({ queryKey: ["me"] });
                } catch (err) {
                  showMsg(
                    "error",
                    err instanceof ApiError ? err.message : t("common.error"),
                  );
                }
              }}
            >
              <Option value="default">{t("profile.altEmailDefault")}</Option>
              <Option value="allow">{t("profile.altEmailAllow")}</Option>
              <Option value="deny">{t("profile.altEmailDeny")}</Option>
            </Dropdown>
          </Field>
        )}
      </div>

      {/* Password change */}
      <div className={styles.card}>
        <Text weight="semibold" size={400}>
          {t("profile.changePassword")}
        </Text>
        <form onSubmit={handlePasswordChange} className={styles.form}>
          <Field label={t("profile.currentPassword")}>
            <Input
              type="password"
              value={pwForm.current}
              onChange={(e) =>
                setPwForm((f) => ({ ...f, current: e.target.value }))
              }
            />
          </Field>
          <Field label={t("profile.newPassword")}>
            <Input
              type="password"
              value={pwForm.next}
              onChange={(e) =>
                setPwForm((f) => ({ ...f, next: e.target.value }))
              }
              placeholder={t("profile.newPasswordPlaceholder")}
            />
          </Field>
          <div className={styles.actions}>
            <Button appearance="primary" type="submit" disabled={pwLoading}>
              {pwLoading ? (
                <Spinner size="tiny" />
              ) : (
                t("profile.updatePassword")
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
