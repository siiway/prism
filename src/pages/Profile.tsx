// User profile page

import {
  Avatar,
  Badge,
  Button,
  Dropdown,
  Field,
  Input,
  Link,
  MessageBar,
  Option,
  Radio,
  RadioGroup,
  Spinner,
  Switch,
  Text,
  Textarea,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowUpRegular,
  DeleteRegular,
  GlobeRegular,
  MailRegular,
} from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";
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

  const { data: myTeamsData } = useQuery({
    queryKey: ["my-teams"],
    queryFn: api.listTeams,
    enabled: !!me?.user.profile_is_public,
  });
  const myTeams = myTeamsData?.teams ?? [];

  // Surface GitHub social connections so the user can pick which one drives
  // the readme. Other providers are ignored — this is a GitHub-specific
  // feature today.
  const { data: connectionsData } = useQuery({
    queryKey: ["connections"],
    queryFn: api.listConnections,
    enabled: !!me?.user.profile_is_public,
  });
  const githubConnections = (connectionsData?.connections ?? []).filter(
    (c) => c.provider === "github",
  );

  const handleTeamShowOnProfile = async (
    teamId: string,
    value: boolean | null,
  ) => {
    setSavingVisibility(`team:${teamId}`);
    try {
      await api.setTeamShowOnProfile(teamId, value);
      await qc.invalidateQueries({ queryKey: ["my-teams"] });
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setSavingVisibility(null);
    }
  };

  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.unproxied_avatar_url ?? "");
  const [saveLoading, setSaveLoading] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [pwForm, setPwForm] = useState({ current: "", next: "" });
  const [pwLoading, setPwLoading] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState<string | null>(null);
  const [readme, setReadme] = useState<string>("");
  const [readmeLoaded, setReadmeLoaded] = useState(false);
  const [readmeSaving, setReadmeSaving] = useState(false);
  const [readmeSyncing, setReadmeSyncing] = useState(false);
  const [ghTokenInput, setGhTokenInput] = useState<string>("");
  const readmeFileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  // Seed the readme textarea from /me on first load. We don't keep the
  // textarea in sync with later refetches because that would clobber the
  // user's in-progress edits.
  useEffect(() => {
    if (me && !readmeLoaded) {
      setReadme(me.user.profile_readme ?? "");
      setReadmeLoaded(true);
    }
  }, [me, readmeLoaded]);

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

  const handleVisibilityChange = async (
    field:
      | "profile_is_public"
      | "profile_show_display_name"
      | "profile_show_avatar"
      | "profile_show_email"
      | "profile_show_joined_at"
      | "profile_show_gpg_keys"
      | "profile_show_authorized_apps"
      | "profile_show_owned_apps"
      | "profile_show_domains"
      | "profile_show_joined_teams"
      | "profile_show_readme",
    value: boolean,
  ) => {
    setSavingVisibility(field);
    try {
      const res = await api.updateMe({ [field]: value });
      if (token && res.user) setAuth(token, res.user);
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setSavingVisibility(null);
    }
  };

  const readmeMaxBytes = site?.profile_readme_max_bytes ?? 64 * 1024;
  const readmeBytes = new TextEncoder().encode(readme).byteLength;
  const readmeOverLimit = readmeBytes > readmeMaxBytes;

  const handleReadmeSave = async () => {
    if (readmeOverLimit) {
      showMsg("error", t("profile.readmeTooLarge"));
      return;
    }
    setReadmeSaving(true);
    try {
      const res = await api.updateMe({ profile_readme: readme || null });
      if (token && res.user) setAuth(token, res.user);
      await qc.invalidateQueries({ queryKey: ["me"] });
      showMsg("success", t("profile.readmeUpdated"));
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setReadmeSaving(false);
    }
  };

  const handleReadmeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file twice still fires onChange.
    e.target.value = "";
    if (!file) return;
    if (file.size > readmeMaxBytes) {
      showMsg("error", t("profile.readmeTooLarge"));
      return;
    }
    setReadmeSaving(true);
    try {
      const text = await file.text();
      // Drop into the textarea so the user can review/edit before saving.
      // The upload endpoint persists immediately too — we want both.
      const res = await api.uploadReadme(file);
      setReadme(res.profile_readme ?? text);
      await qc.invalidateQueries({ queryKey: ["me"] });
      showMsg("success", t("profile.readmeUpdated"));
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setReadmeSaving(false);
    }
  };

  const handleReadmeSourceChange = async (
    source: "manual" | "github",
    connectionId?: string,
  ) => {
    setReadmeSaving(true);
    try {
      const body: Parameters<typeof api.updateMe>[0] = {
        profile_readme_source: source,
      };
      if (source === "github") {
        body.profile_readme_source_meta = connectionId
          ? { connection_id: connectionId }
          : null;
      }
      const res = await api.updateMe(body);
      if (token && res.user) setAuth(token, res.user);
      await qc.invalidateQueries({ queryKey: ["me"] });
      showMsg("success", t("profile.readmeUpdated"));
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setReadmeSaving(false);
    }
  };

  const handleGithubTokenSave = async (next: string | null) => {
    setReadmeSaving(true);
    try {
      const res = await api.updateMe({ github_readme_token: next });
      if (token && res.user) setAuth(token, res.user);
      await qc.invalidateQueries({ queryKey: ["me"] });
      setGhTokenInput("");
      showMsg("success", t("profile.readmeUpdated"));
    } catch (err) {
      showMsg("error", err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setReadmeSaving(false);
    }
  };

  const handleReadmeSync = async () => {
    setReadmeSyncing(true);
    try {
      await api.syncReadmeFromGithub();
      await qc.invalidateQueries({ queryKey: ["me"] });
      showMsg("success", t("profile.readmeSynced"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("profile.readmeSyncFailed"),
      );
    } finally {
      setReadmeSyncing(false);
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

      {/* Public profile visibility */}
      {(site?.enable_public_profiles ?? true) && me && (
        <div className={styles.card}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 12,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text weight="semibold" size={400} block>
                {t("profile.publicProfileTitle")}
              </Text>
              <Text
                size={200}
                block
                style={{ color: tokens.colorNeutralForeground3, marginTop: 4 }}
              >
                {t("profile.publicProfileDesc")}
              </Text>
            </div>
            {me.user.profile_is_public && (
              <Link
                href={`/u/${me.user.username}`}
                target="_blank"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                <GlobeRegular fontSize={14} />
                {t("profile.viewPublicProfile")}
              </Link>
            )}
          </div>
          <Switch
            label={t("profile.makeProfilePublic")}
            checked={me.user.profile_is_public}
            disabled={savingVisibility === "profile_is_public"}
            onChange={(_, d) =>
              handleVisibilityChange("profile_is_public", d.checked)
            }
          />
          {me.user.profile_is_public && site && (
            <div
              className={styles.form}
              style={{
                paddingLeft: 12,
                borderLeft: `2px solid ${tokens.colorNeutralStroke2}`,
              }}
            >
              <Text
                size={200}
                style={{ color: tokens.colorNeutralForeground3 }}
              >
                {t("profile.publicProfileFieldsHint")}
              </Text>
              {(
                [
                  [
                    "profile_show_display_name",
                    "default_profile_show_display_name",
                    "profile.publicProfileShowDisplayName",
                  ],
                  [
                    "profile_show_avatar",
                    "default_profile_show_avatar",
                    "profile.publicProfileShowAvatar",
                  ],
                  [
                    "profile_show_email",
                    "default_profile_show_email",
                    "profile.publicProfileShowEmail",
                  ],
                  [
                    "profile_show_joined_at",
                    "default_profile_show_joined_at",
                    "profile.publicProfileShowJoinedAt",
                  ],
                  [
                    "profile_show_gpg_keys",
                    "default_profile_show_gpg_keys",
                    "profile.publicProfileShowGpgKeys",
                  ],
                  [
                    "profile_show_authorized_apps",
                    "default_profile_show_authorized_apps",
                    "profile.publicProfileShowAuthorizedApps",
                  ],
                  [
                    "profile_show_owned_apps",
                    "default_profile_show_owned_apps",
                    "profile.publicProfileShowOwnedApps",
                  ],
                  [
                    "profile_show_domains",
                    "default_profile_show_domains",
                    "profile.publicProfileShowDomains",
                  ],
                  [
                    "profile_show_joined_teams",
                    "default_profile_show_joined_teams",
                    "profile.publicProfileShowJoinedTeams",
                  ],
                  [
                    "profile_show_readme",
                    "default_profile_show_readme",
                    "profile.publicProfileShowReadme",
                  ],
                ] as const
              ).map(([userKey, siteKey, labelKey]) => {
                const userValue = me.user[userKey];
                const siteDefault = site[siteKey];
                const effective = userValue ?? siteDefault;
                return (
                  <Switch
                    key={userKey}
                    label={
                      userValue === null
                        ? `${t(labelKey)} (${t("profile.publicProfileFollowingDefault")})`
                        : t(labelKey)
                    }
                    checked={effective}
                    disabled={savingVisibility === userKey}
                    onChange={(_, d) =>
                      handleVisibilityChange(userKey, d.checked)
                    }
                  />
                );
              })}
              {/* Per-team override list. Surfaced even when the master toggle
                  is off so users can pin specific teams. */}
              {myTeams.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    marginTop: 8,
                    paddingTop: 8,
                    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
                  }}
                >
                  <Text
                    size={200}
                    style={{ color: tokens.colorNeutralForeground3 }}
                  >
                    {t("profile.publicProfilePerTeamHint")}
                  </Text>
                  {myTeams.map((team) => {
                    const masterEffective =
                      me.user.profile_show_joined_teams ??
                      site.default_profile_show_joined_teams;
                    const override = team.show_on_profile;
                    const resolved =
                      override === null || override === undefined
                        ? masterEffective
                        : override;
                    const labelSuffix =
                      override === null || override === undefined
                        ? ` (${t("profile.publicProfileFollowingDefault")})`
                        : "";
                    return (
                      <div
                        key={team.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <Switch
                          label={`${team.name}${labelSuffix}`}
                          checked={resolved}
                          disabled={
                            savingVisibility === `team:${team.id}` ||
                            !team.profile_is_public
                          }
                          onChange={(_, d) =>
                            handleTeamShowOnProfile(team.id, d.checked)
                          }
                        />
                        {(override === true || override === false) && (
                          <Button
                            appearance="subtle"
                            size="small"
                            onClick={() =>
                              handleTeamShowOnProfile(team.id, null)
                            }
                          >
                            {t("profile.publicProfileResetOverride")}
                          </Button>
                        )}
                        {!team.profile_is_public && (
                          <Text
                            size={100}
                            style={{ color: tokens.colorNeutralForeground3 }}
                          >
                            {t("profile.publicProfileTeamPrivate")}
                          </Text>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Profile README — markdown shown on the public profile. Only useful
          when the public profile is enabled at all, so we hide the card
          otherwise. */}
      {(site?.enable_public_profiles ?? true) && me && (
        <div className={styles.card}>
          <div>
            <Text weight="semibold" size={400} block>
              {t("profile.readmeTitle")}
            </Text>
            <Text
              size={200}
              block
              style={{ color: tokens.colorNeutralForeground3, marginTop: 4 }}
            >
              {t("profile.readmeDesc", {
                kb: Math.floor(readmeMaxBytes / 1024),
              })}
            </Text>
          </div>

          <Field label={t("profile.readmeSourceLabel")}>
            <RadioGroup
              value={me.user.profile_readme_source}
              disabled={readmeSaving}
              onChange={(_, d) => {
                const next = d.value as "manual" | "github";
                if (next === me.user.profile_readme_source) return;
                if (next === "github") {
                  // Pick the first available connection by default; if none,
                  // the picker below will surface the empty state.
                  const first = githubConnections[0];
                  if (!first) {
                    showMsg("error", t("profile.readmeNoGithubConnection"));
                    return;
                  }
                  void handleReadmeSourceChange("github", first.id);
                } else {
                  void handleReadmeSourceChange("manual");
                }
              }}
            >
              <Radio value="manual" label={t("profile.readmeSourceManual")} />
              <Radio value="github" label={t("profile.readmeSourceGithub")} />
            </RadioGroup>
          </Field>

          {me.user.profile_readme_source === "manual" && (
            <>
              <Field
                validationState={readmeOverLimit ? "error" : "none"}
                validationMessage={
                  readmeOverLimit
                    ? t("profile.readmeTooLarge")
                    : t("profile.readmeBytesUsed", {
                        used: readmeBytes,
                        max: readmeMaxBytes,
                      })
                }
              >
                <Textarea
                  value={readme}
                  onChange={(_, d) => setReadme(d.value)}
                  placeholder={t("profile.readmePlaceholder")}
                  rows={12}
                  resize="vertical"
                  style={{ fontFamily: "monospace" }}
                />
              </Field>
              <div className={styles.actions}>
                <Button
                  appearance="primary"
                  onClick={handleReadmeSave}
                  disabled={readmeSaving || readmeOverLimit}
                >
                  {readmeSaving ? (
                    <Spinner size="tiny" />
                  ) : (
                    t("common.saveChanges")
                  )}
                </Button>
                <input
                  ref={readmeFileRef}
                  type="file"
                  accept=".md,.markdown,text/markdown,text/plain"
                  style={{ display: "none" }}
                  onChange={handleReadmeUpload}
                />
                <Button
                  disabled={readmeSaving}
                  onClick={() => readmeFileRef.current?.click()}
                >
                  {t("profile.readmeUpload")}
                </Button>
                {readme && (
                  <Button
                    appearance="subtle"
                    disabled={readmeSaving}
                    onClick={() => setReadme("")}
                  >
                    {t("profile.readmeClear")}
                  </Button>
                )}
              </div>
            </>
          )}

          {me.user.profile_readme_source === "github" && (
            <div
              className={styles.form}
              style={{
                paddingLeft: 12,
                borderLeft: `2px solid ${tokens.colorNeutralStroke2}`,
              }}
            >
              <Field
                label={t("profile.readmeGithubAccount")}
                hint={
                  githubConnections.length === 0
                    ? t("profile.readmeNoGithubConnection")
                    : undefined
                }
                validationState={
                  githubConnections.length === 0 ? "warning" : "none"
                }
              >
                <Dropdown
                  value={
                    me.user.profile_readme_source_meta?.github_login
                      ? `@${me.user.profile_readme_source_meta.github_login}`
                      : ""
                  }
                  selectedOptions={
                    me.user.profile_readme_source_meta?.connection_id
                      ? [me.user.profile_readme_source_meta.connection_id]
                      : []
                  }
                  disabled={readmeSaving || githubConnections.length === 0}
                  onOptionSelect={(_, d) => {
                    if (d.optionValue)
                      void handleReadmeSourceChange("github", d.optionValue);
                  }}
                >
                  {githubConnections.map((conn) => {
                    const profile = conn.profile as { login?: string } | null;
                    const login = profile?.login ?? conn.provider_user_id;
                    return (
                      <Option key={conn.id} value={conn.id} text={`@${login}`}>
                        @{login}
                      </Option>
                    );
                  })}
                </Dropdown>
              </Field>

              <Field
                label={t("profile.readmeGithubToken")}
                hint={
                  me.user.github_readme_token_set
                    ? t("profile.readmeGithubTokenSet")
                    : site?.github_readme_has_site_token
                      ? t("profile.readmeGithubTokenOptionalSite")
                      : t("profile.readmeGithubTokenOptionalNoSite")
                }
              >
                <Input
                  type="password"
                  value={ghTokenInput}
                  placeholder={
                    me.user.github_readme_token_set ? "••••••••" : "ghp_…"
                  }
                  onChange={(_, d) => setGhTokenInput(d.value)}
                />
              </Field>
              <div className={styles.actions}>
                <Button
                  appearance="primary"
                  disabled={readmeSyncing || readmeSaving}
                  onClick={handleReadmeSync}
                >
                  {readmeSyncing ? (
                    <Spinner size="tiny" />
                  ) : (
                    t("profile.readmeSyncNow")
                  )}
                </Button>
                <Button
                  disabled={readmeSaving || !ghTokenInput.trim()}
                  onClick={() => handleGithubTokenSave(ghTokenInput.trim())}
                >
                  {t("profile.readmeSaveToken")}
                </Button>
                {me.user.github_readme_token_set && (
                  <Button
                    appearance="subtle"
                    disabled={readmeSaving}
                    onClick={() => handleGithubTokenSave(null)}
                  >
                    {t("profile.readmeClearToken")}
                  </Button>
                )}
              </div>
              {me.user.profile_readme_synced_at && (
                <Text
                  size={200}
                  style={{ color: tokens.colorNeutralForeground3 }}
                >
                  {t("profile.readmeLastSynced", {
                    when: new Date(
                      me.user.profile_readme_synced_at * 1000,
                    ).toLocaleString(),
                  })}
                </Text>
              )}
            </div>
          )}
        </div>
      )}

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
