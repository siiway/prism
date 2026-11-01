// Profile page: how the account appears (name, avatar, emails) and what the
// public profile shares. Password and sign-in methods live on Security.

import {
  Avatar,
  Badge,
  Button,
  Dropdown,
  Field,
  Input,
  Link,
  Option,
  Radio,
  RadioGroup,
  Spinner,
  Switch,
  Textarea,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  DeleteRegular,
  MailRegular,
  OpenRegular,
  PeopleTeamRegular,
} from "@fluentui/react-icons";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../lib/api";
import { useApi } from "../lib/api-context";
import { useToastMessage } from "../lib/useToastMessage";
import { useConfirm } from "../lib/useConfirm";
import { useAuthStore } from "../store/auth";
import { ImageUrlInput } from "../components/ImageUrlInput";
import { PageHeader } from "../components/PageHeader";
import { PasswordInput } from "../components/PasswordInput";
import {
  SettingsBody,
  SettingsCard,
  SettingsFooter,
  SettingsPage,
  SettingsRow,
  SettingsSubhead,
  SettingsToast,
} from "../components/Settings";
import { SkeletonSettingsPage } from "../components/Skeletons";

const useStyles = makeStyles({
  input: { width: "300px", maxWidth: "100%" },
  urlInput: { width: "360px", maxWidth: "100%" },
  dropdown: { minWidth: "0", width: "200px" },
  value: { color: tokens.colorNeutralForeground2 },
  readme: { fontFamily: tokens.fontFamilyMonospace },
  hiddenInput: { display: "none" },
  linkIcon: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    fontSize: tokens.fontSizeBase300,
  },
  formNarrow: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    maxWidth: "420px",
  },
});

const PUBLIC_FIELDS = [
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
] as const;

export function Profile() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, setAuth } = useAuthStore();
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
    queryFn: () => api.listTeams(),
    enabled: !!me?.user.profile_is_public,
  });
  const myTeams = myTeamsData?.teams ?? [];

  // Surface GitHub social connections so the user can pick which one drives
  // the readme. Other providers are ignored — this is a GitHub-specific
  // feature today.
  const { data: connectionsData } = useQuery({
    queryKey: ["connections"],
    queryFn: api.listConnections,
    // The README card shows whenever public profiles are on, and its GitHub
    // option is disabled without a linked account, so load this for it.
    enabled: !!me && (site?.enable_public_profiles ?? true),
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
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.saveFailed"),
      );
    } finally {
      setSavingVisibility(null);
    }
  };

  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.unproxied_avatar_url ?? "");
  const [saveLoading, setSaveLoading] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState<string | null>(null);
  const [readme, setReadme] = useState<string>("");
  const [readmeLoaded, setReadmeLoaded] = useState(false);
  const [readmeSaving, setReadmeSaving] = useState(false);
  const [readmeSyncing, setReadmeSyncing] = useState(false);
  const [ghTokenInput, setGhTokenInput] = useState<string>("");
  const readmeFileRef = useRef<HTMLInputElement>(null);
  const { message, showMsg } = useToastMessage();
  const { confirm, confirmDialog } = useConfirm();

  // Seed the readme textarea from /me on first load. We don't keep the
  // textarea in sync with later refetches because that would clobber the
  // user's in-progress edits. Expressed as a render-time set (guarded by
  // readmeLoaded) per React 19's set-state-in-effect rule.
  if (me && !readmeLoaded) {
    setReadme(me.user.profile_readme ?? "");
    setReadmeLoaded(true);
  }

  const profileDirty =
    !!me &&
    (displayName.trim() !== (me.user.display_name ?? "") ||
      (!r2Enabled &&
        avatarUrl.trim() !== (me.user.unproxied_avatar_url ?? "")));

  const handleSave = async () => {
    setSaveLoading(true);
    try {
      const body: Parameters<typeof api.updateMe>[0] = {
        display_name: displayName.trim(),
      };
      if (!r2Enabled) body.avatar_url = avatarUrl.trim() || undefined;
      const res = await api.updateMe(body);
      if (res.user) setAuth(res.user);
      await qc.invalidateQueries({ queryKey: ["me"] });
      showMsg("success", t("profile.profileUpdated"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.saveFailed"),
      );
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
      if (user) setAuth({ ...user, avatar_url: res.avatar_url });
      await qc.invalidateQueries({ queryKey: ["me"] });
      showMsg("success", t("profile.avatarUpdated"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.uploadFailed"),
      );
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
      if (res.user) setAuth(res.user);
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.saveFailed"),
      );
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
      if (res.user) setAuth(res.user);
      await qc.invalidateQueries({ queryKey: ["me"] });
      showMsg("success", t("profile.readmeUpdated"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.saveFailed"),
      );
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
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.uploadFailed"),
      );
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
      if (res.user) setAuth(res.user);
      await qc.invalidateQueries({ queryKey: ["me"] });
      showMsg("success", t("profile.readmeUpdated"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.saveFailed"),
      );
    } finally {
      setReadmeSaving(false);
    }
  };

  const handleGithubTokenSave = async (next: string | null) => {
    setReadmeSaving(true);
    try {
      const res = await api.updateMe({ github_readme_token: next });
      if (res.user) setAuth(res.user);
      await qc.invalidateQueries({ queryKey: ["me"] });
      setGhTokenInput("");
      showMsg("success", t("profile.readmeUpdated"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.saveFailed"),
      );
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

  const handleAddEmail = async () => {
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
  };

  const emailAction = async (
    run: () => Promise<unknown>,
    successKey: string,
    refresh = false,
  ) => {
    try {
      await run();
      if (refresh) {
        await refetchEmails();
        await qc.invalidateQueries({ queryKey: ["me"] });
      }
      showMsg("success", t(successKey));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.error"),
      );
    }
  };

  if (isLoading)
    return (
      <SettingsPage>
        <SkeletonSettingsPage cards={[4, 2, 1]} />
      </SettingsPage>
    );

  const verifiedBadge = (verified: boolean) => (
    <Badge
      color={verified ? "success" : "warning"}
      appearance="tint"
      size="small"
    >
      {verified ? t("profile.verified") : t("profile.unverified")}
    </Badge>
  );

  const publicProfiles = (site?.enable_public_profiles ?? true) && !!me;

  return (
    <SettingsPage>
      <PageHeader
        title={t("profile.title")}
        subtitle={t("profile.subtitle")}
        style={{ marginBottom: 4 }}
      />
      <SettingsToast message={message} />

      {/* ── Profile details ── */}
      <SettingsCard
        id="basic"
        title={t("profile.basicInformation")}
        description={t("profile.basicInformationDesc")}
      >
        <SettingsRow
          label={t("profile.avatarLabel")}
          description={r2Enabled ? t("profile.avatarFormats") : undefined}
        >
          <Avatar
            name={me?.user.display_name}
            image={
              me?.user.avatar_url ? { src: me.user.avatar_url } : undefined
            }
            size={40}
          />
          {r2Enabled ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className={styles.hiddenInput}
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
            </>
          ) : (
            <div className={styles.urlInput}>
              <ImageUrlInput
                label={t("profile.avatarUrl")}
                hideLabel
                value={avatarUrl}
                onChange={setAvatarUrl}
                placeholder={t("profile.avatarPlaceholder")}
              />
            </div>
          )}
        </SettingsRow>
        <SettingsRow label={t("profile.displayName")}>
          <Input
            className={styles.input}
            aria-label={t("profile.displayName")}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </SettingsRow>
        <SettingsRow
          label={t("profile.usernameLabel")}
          description={t("profile.usernameDesc")}
        >
          <span className={styles.value}>{me?.user.username}</span>
        </SettingsRow>
        <SettingsRow label={t("profile.emailLabel")}>
          <span className={styles.value}>{me?.user.email}</span>
          {me && verifiedBadge(!!me.user.email_verified)}
          {me && !me.user.email_verified && (
            <Button size="small" onClick={() => navigate("/verify-choose")}>
              {t("profile.verifyEmail")}
            </Button>
          )}
        </SettingsRow>
        <SettingsFooter>
          <Button
            appearance="primary"
            onClick={handleSave}
            disabled={saveLoading || !profileDirty}
          >
            {saveLoading ? <Spinner size="tiny" /> : t("common.saveChanges")}
          </Button>
        </SettingsFooter>
      </SettingsCard>

      {/* ── Email addresses ── */}
      <SettingsCard
        id="emails"
        title={t("profile.emailAddresses")}
        description={t("profile.emailAddressesDesc")}
      >
        {emails && (
          <SettingsRow
            icon={<MailRegular />}
            label={
              <>
                <span>{emails.primary.email}</span>
                <Badge color="brand" appearance="tint" size="small">
                  {t("profile.primary")}
                </Badge>
                {verifiedBadge(emails.primary.verified)}
              </>
            }
          >
            {!emails.primary.verified && (
              <Button size="small" onClick={() => navigate("/verify-choose")}>
                {t("profile.verifyEmail")}
              </Button>
            )}
          </SettingsRow>
        )}
        {emails?.emails.map((alt) => (
          <SettingsRow
            key={alt.id}
            icon={<MailRegular />}
            label={
              <>
                <span>{alt.email}</span>
                {verifiedBadge(alt.verified)}
              </>
            }
          >
            {alt.verified ? (
              <Button
                size="small"
                appearance="subtle"
                onClick={() =>
                  emailAction(
                    () => api.setEmailPrimary(alt.id),
                    "profile.primaryUpdated",
                    true,
                  )
                }
              >
                {t("profile.makePrimary")}
              </Button>
            ) : (
              <Button
                size="small"
                appearance="subtle"
                onClick={() =>
                  emailAction(
                    () => api.resendEmailVerify(alt.id),
                    "profile.verifySent",
                  )
                }
              >
                {t("profile.resend")}
              </Button>
            )}
            <Tooltip content={t("common.remove")} relationship="label">
              <Button
                size="small"
                appearance="subtle"
                icon={<DeleteRegular />}
                onClick={async () => {
                  const ok = await confirm({
                    title: t("profile.removeEmailTitle"),
                    body: t("profile.removeEmailBody", { email: alt.email }),
                    confirmLabel: t("common.remove"),
                  });
                  if (ok)
                    void emailAction(
                      () => api.removeEmail(alt.id),
                      "profile.emailRemoved",
                      true,
                    );
                }}
              />
            </Tooltip>
          </SettingsRow>
        ))}
        <SettingsRow
          label={t("profile.addEmail")}
          description={t("profile.addEmailDesc")}
        >
          <form
            style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
            onSubmit={(e) => {
              e.preventDefault();
              if (newEmail.trim()) void handleAddEmail();
            }}
          >
            <Input
              type="email"
              className={styles.input}
              aria-label={t("profile.addEmail")}
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="user@example.com"
            />
            <Button
              type="submit"
              disabled={emailLoading || !newEmail.trim()}
              icon={emailLoading ? <Spinner size="tiny" /> : undefined}
            >
              {t("common.add")}
            </Button>
          </form>
        </SettingsRow>
        {emails && emails.emails.length > 0 && (
          <SettingsRow
            label={t("profile.altEmailLogin")}
            description={t("profile.altEmailLoginHint")}
          >
            <Dropdown
              className={styles.dropdown}
              aria-label={t("profile.altEmailLogin")}
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
          </SettingsRow>
        )}
      </SettingsCard>

      {/* ── Public profile ── */}
      {publicProfiles && me && (
        <SettingsCard
          id="public-profile"
          title={t("profile.publicProfileTitle")}
          description={t("profile.publicProfileDesc")}
          action={
            me.user.profile_is_public ? (
              <Link
                href={`/u/${me.user.username}`}
                target="_blank"
                className={styles.linkIcon}
              >
                {t("profile.viewPublicProfile")}
                <OpenRegular />
              </Link>
            ) : undefined
          }
        >
          <SettingsRow label={t("profile.makeProfilePublic")}>
            <Switch
              aria-label={t("profile.makeProfilePublic")}
              checked={me.user.profile_is_public}
              disabled={savingVisibility === "profile_is_public"}
              onChange={(_, d) =>
                handleVisibilityChange("profile_is_public", d.checked)
              }
            />
          </SettingsRow>
          {me.user.profile_is_public && site && (
            <>
              <SettingsSubhead>
                {t("profile.publicProfileFieldsHint")}
              </SettingsSubhead>
              {PUBLIC_FIELDS.map(([userKey, siteKey, labelKey]) => {
                const userValue = me.user[userKey];
                return (
                  <SettingsRow
                    key={userKey}
                    label={t(labelKey)}
                    description={
                      userValue === null
                        ? t("profile.publicProfileFollowingDefaultLong")
                        : undefined
                    }
                  >
                    <Switch
                      aria-label={t(labelKey)}
                      checked={userValue ?? site[siteKey]}
                      disabled={savingVisibility === userKey}
                      onChange={(_, d) =>
                        handleVisibilityChange(userKey, d.checked)
                      }
                    />
                  </SettingsRow>
                );
              })}
              {/* Per-team overrides of "Teams I'm a member of". */}
              {myTeams.length > 0 && (
                <>
                  <SettingsSubhead>
                    {t("profile.publicProfilePerTeamHint")}
                  </SettingsSubhead>
                  {myTeams.map((team) => {
                    const masterEffective =
                      me.user.profile_show_joined_teams ??
                      site.default_profile_show_joined_teams;
                    const override = team.show_on_profile;
                    const following =
                      override === null || override === undefined;
                    return (
                      <SettingsRow
                        key={team.id}
                        icon={<PeopleTeamRegular />}
                        label={team.name}
                        description={
                          !team.profile_is_public
                            ? t("profile.publicProfileTeamPrivate")
                            : following
                              ? t("profile.publicProfileFollowingDefaultLong")
                              : undefined
                        }
                      >
                        {!following && (
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
                        <Switch
                          aria-label={team.name}
                          checked={following ? masterEffective : override}
                          disabled={
                            savingVisibility === `team:${team.id}` ||
                            !team.profile_is_public
                          }
                          onChange={(_, d) =>
                            handleTeamShowOnProfile(team.id, d.checked)
                          }
                        />
                      </SettingsRow>
                    );
                  })}
                </>
              )}
            </>
          )}
        </SettingsCard>
      )}

      {/* ── README ── */}
      {publicProfiles && me && (
        <SettingsCard
          id="readme"
          title={t("profile.readmeTitle")}
          description={t("profile.readmeDesc", {
            kb: Math.floor(readmeMaxBytes / 1024),
          })}
        >
          <SettingsRow
            label={t("profile.readmeSourceLabel")}
            description={
              connectionsData &&
              githubConnections.length === 0 && (
                <Link onClick={() => navigate("/connections")}>
                  {t("profile.readmeLinkGithub")}
                </Link>
              )
            }
          >
            <RadioGroup
              layout="horizontal"
              aria-label={t("profile.readmeSourceLabel")}
              value={me.user.profile_readme_source}
              disabled={readmeSaving}
              onChange={(_, d) => {
                const next = d.value as "manual" | "github";
                if (next === me.user.profile_readme_source) return;
                if (next === "github") {
                  // Pick the first available connection by default.
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
              <Radio
                value="github"
                label={t("profile.readmeSourceGithub")}
                disabled={
                  githubConnections.length === 0 &&
                  me.user.profile_readme_source !== "github"
                }
              />
            </RadioGroup>
          </SettingsRow>

          {me.user.profile_readme_source === "manual" && (
            <>
              <SettingsBody>
                <Field
                  validationState={readmeOverLimit ? "error" : "none"}
                  validationMessage={
                    readmeOverLimit ? t("profile.readmeTooLarge") : undefined
                  }
                >
                  <Textarea
                    aria-label={t("profile.readmeTitle")}
                    value={readme}
                    onChange={(_, d) => setReadme(d.value)}
                    placeholder={t("profile.readmePlaceholder")}
                    rows={10}
                    resize="vertical"
                    textarea={{ className: styles.readme }}
                  />
                </Field>
              </SettingsBody>
              <SettingsFooter
                start={t("profile.readmeBytesUsed", {
                  used: readmeBytes,
                  max: readmeMaxBytes,
                })}
              >
                <input
                  ref={readmeFileRef}
                  type="file"
                  accept=".md,.markdown,text/markdown,text/plain"
                  className={styles.hiddenInput}
                  onChange={handleReadmeUpload}
                />
                {readme && (
                  <Button
                    appearance="subtle"
                    disabled={readmeSaving}
                    onClick={() => setReadme("")}
                  >
                    {t("profile.readmeClear")}
                  </Button>
                )}
                <Button
                  disabled={readmeSaving}
                  onClick={() => readmeFileRef.current?.click()}
                >
                  {t("profile.readmeUpload")}
                </Button>
                <Button
                  appearance="primary"
                  onClick={handleReadmeSave}
                  disabled={
                    readmeSaving ||
                    readmeOverLimit ||
                    readme === (me.user.profile_readme ?? "")
                  }
                >
                  {readmeSaving ? (
                    <Spinner size="tiny" />
                  ) : (
                    t("common.saveChanges")
                  )}
                </Button>
              </SettingsFooter>
            </>
          )}

          {me.user.profile_readme_source === "github" && (
            <>
              <SettingsBody>
                <div className={styles.formNarrow}>
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
                          void handleReadmeSourceChange(
                            "github",
                            d.optionValue,
                          );
                      }}
                    >
                      {githubConnections.map((conn) => {
                        const profile = conn.profile as {
                          login?: string;
                        } | null;
                        const login = profile?.login ?? conn.provider_user_id;
                        return (
                          <Option
                            key={conn.id}
                            value={conn.id}
                            text={`@${login}`}
                          >
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
                    <PasswordInput
                      value={ghTokenInput}
                      placeholder={
                        me.user.github_readme_token_set ? "••••••••" : "ghp_…"
                      }
                      onChange={(_, d) => setGhTokenInput(d.value)}
                    />
                  </Field>
                </div>
              </SettingsBody>
              <SettingsFooter
                start={
                  me.user.profile_readme_synced_at
                    ? t("profile.readmeLastSynced", {
                        when: new Date(
                          me.user.profile_readme_synced_at * 1000,
                        ).toLocaleString(),
                      })
                    : undefined
                }
              >
                {me.user.github_readme_token_set && (
                  <Button
                    appearance="subtle"
                    disabled={readmeSaving}
                    onClick={() => handleGithubTokenSave(null)}
                  >
                    {t("profile.readmeClearToken")}
                  </Button>
                )}
                <Button
                  disabled={readmeSaving || !ghTokenInput.trim()}
                  onClick={() => handleGithubTokenSave(ghTokenInput.trim())}
                >
                  {t("profile.readmeSaveToken")}
                </Button>
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
              </SettingsFooter>
            </>
          )}
        </SettingsCard>
      )}
      {confirmDialog}
    </SettingsPage>
  );
}
