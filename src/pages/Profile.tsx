// User profile page

import {
  Avatar,
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
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError, proxyImageUrl } from "../lib/api";
import { useAuthStore } from "../store/auth";
import { ImageUrlInput } from "../components/ImageUrlInput";

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
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" },
  actions: { display: "flex", gap: "8px" },
});

export function Profile() {
  const styles = useStyles();
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

  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url ?? "");
  const [saveLoading, setSaveLoading] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [pwForm, setPwForm] = useState({ current: "", next: "" });
  const [pwLoading, setPwLoading] = useState(false);
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

  if (isLoading) return <Spinner />;

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
              me?.user.avatar_url
                ? { src: proxyImageUrl(me.user.avatar_url) }
                : undefined
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
            <Field label={t("profile.emailLabel")}>
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
