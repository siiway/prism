// Overview: what a developer needs to wire the app up (credentials and
// endpoints), the app's public details, who owns it, and deletion.

import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  Link,
  MessageBar,
  Option,
  Spinner,
  Textarea,
} from "@fluentui/react-components";
import {
  DeleteRegular,
  EyeOffRegular,
  PeopleRegular,
  PersonRegular,
} from "@fluentui/react-icons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, type OAuthApp } from "../../../lib/api";
import { useApi, useAppOrigin } from "../../../lib/api-context";
import { useConfirm } from "../../../lib/useConfirm";
import { ImageUrlInput } from "../../../components/ImageUrlInput";
import {
  SettingsBody,
  SettingsCard,
  SettingsRow,
} from "../../../components/Settings";
import { SectionFooter } from "./shared";
import { CopyButton } from "../../../components/CopyButton";
import { useDetailStyles } from "./styles";
import { type AppFormApi } from "./form";

const ENDPOINTS: [string, string][] = [
  ["Discovery", "/.well-known/openid-configuration"],
  ["Authorization", "/api/oauth/authorize"],
  ["Token", "/api/oauth/token"],
  ["UserInfo", "/api/oauth/userinfo"],
  ["End session", "/api/oauth/end_session"],
];

interface Props {
  app: OAuthApp;
  formApi: AppFormApi;
  /** A secret just created or rotated; shown once. */
  newSecret: string;
  setNewSecret: (secret: string) => void;
  showMsg: (type: "success" | "error", text: string) => void;
}

export function OverviewTab({
  app,
  formApi,
  newSecret,
  setNewSecret,
  showMsg,
}: Props) {
  const api = useApi();
  const appOrigin = useAppOrigin();
  const styles = useDetailStyles();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t, i18n } = useTranslation();
  const { confirm, confirmDialog } = useConfirm();
  const { form, set } = formApi;

  const [rotating, setRotating] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTeamId, setMoveTeamId] = useState("");
  const [moving, setMoving] = useState(false);

  const { data: teamsData } = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.listTeams(),
  });
  // Teams the user can move the app into.
  const moveTargets = (teamsData?.teams ?? []).filter(
    (tm) =>
      (tm.role === "owner" || tm.role === "admin") && tm.id !== app.team_id,
  );

  const errorText = (err: unknown, fallback: string) =>
    err instanceof ApiError ? err.message : fallback;

  // A first secret is harmless to create; replacing one breaks whatever
  // still uses it, so that asks first.
  const rotate = async () => {
    if (
      app.has_client_secret &&
      !(await confirm({
        title: t("apps.rotateSecretConfirmTitle"),
        body: t("apps.rotateSecretConfirmBody"),
        confirmLabel: t("apps.rotateSecret"),
      }))
    )
      return;
    setRotating(true);
    try {
      const res = await api.rotateSecret(app.id);
      setNewSecret(res.client_secret);
      await qc.invalidateQueries({ queryKey: ["app", app.id] });
    } catch (err) {
      showMsg("error", errorText(err, t("common.saveFailed")));
    } finally {
      setRotating(false);
    }
  };

  const moveToTeam = async () => {
    if (!moveTeamId) return;
    setMoving(true);
    try {
      await api.transferAppToTeam(moveTeamId, app.id);
      await qc.invalidateQueries({ queryKey: ["app", app.id] });
      await qc.invalidateQueries({ queryKey: ["apps"] });
      setMoveOpen(false);
      setMoveTeamId("");
      showMsg("success", t("apps.appMovedToTeam"));
    } catch (err) {
      showMsg("error", errorText(err, t("apps.failedMoveApp")));
    } finally {
      setMoving(false);
    }
  };

  const removeFromTeam = async () => {
    if (!app.team_id) return;
    if (
      !(await confirm({
        title: t("apps.removeFromTeamTitle"),
        body: t("apps.removeFromTeamBody", {
          team: app.team_name ?? t("apps.team"),
        }),
        confirmLabel: t("apps.removeFromTeam"),
      }))
    )
      return;
    try {
      await api.removeAppFromTeam(app.team_id, app.id);
      await qc.invalidateQueries({ queryKey: ["app", app.id] });
      await qc.invalidateQueries({ queryKey: ["apps"] });
      showMsg("success", t("apps.appRemovedFromTeam"));
    } catch (err) {
      showMsg("error", errorText(err, t("apps.failedRemoveFromTeam")));
    }
  };

  const deleteApp = async () => {
    if (
      !(await confirm({
        title: t("apps.deleteAppTitle", { name: app.name }),
        body: t("apps.deleteAppDesc"),
        confirmLabel: t("apps.deletePermanently"),
      }))
    )
      return;
    try {
      await api.deleteApp(app.id);
      await qc.invalidateQueries({ queryKey: ["apps"] });
      navigate(app.team_id ? `/teams/${app.team_id}` : "/apps");
    } catch (err) {
      showMsg("error", errorText(err, t("common.deleteFailed")));
    }
  };

  const guideUrl = i18n.language.startsWith("zh")
    ? "https://prism.wss.moe/zh/oauth"
    : "https://prism.wss.moe/oauth";

  return (
    <>
      <SettingsCard
        id="credentials"
        title={t("apps.clientCredentials")}
        description={t("apps.credentialsDesc")}
      >
        <SettingsRow
          label={t("apps.clientId")}
          description={<span className={styles.mono}>{app.client_id}</span>}
        >
          <CopyButton text={app.client_id} label={t("common.copyClientId")} />
        </SettingsRow>
        <SettingsRow
          label={t("apps.clientSecret")}
          description={
            app.is_public
              ? t("apps.secretPublic")
              : app.has_client_secret
                ? t("apps.secretSet")
                : t("apps.secretNone")
          }
        >
          {!app.is_public && (
            <Button size="small" disabled={rotating} onClick={rotate}>
              {rotating ? (
                <Spinner size="tiny" />
              ) : app.has_client_secret ? (
                t("apps.rotateSecret")
              ) : (
                t("apps.generateSecret")
              )}
            </Button>
          )}
        </SettingsRow>
        {newSecret && (
          <SettingsBody>
            <MessageBar intent="warning">
              {t("apps.saveSecretWarning")}
            </MessageBar>
            <div className={styles.secret}>
              <span className={styles.secretText}>{newSecret}</span>
              <CopyButton text={newSecret} />
              <Button
                size="small"
                appearance="subtle"
                icon={<EyeOffRegular />}
                onClick={() => setNewSecret("")}
              >
                {t("apps.hideSecret")}
              </Button>
            </div>
          </SettingsBody>
        )}
      </SettingsCard>

      <SettingsCard
        id="endpoints"
        title={t("apps.oauthEndpoints")}
        description={
          <>
            {t("apps.endpointsDesc")}{" "}
            <Link href={guideUrl} target="_blank" rel="noreferrer">
              {t("apps.oauthOidcGuide")}
            </Link>
          </>
        }
      >
        {ENDPOINTS.map(([label, path]) => (
          <SettingsRow
            key={path}
            label={label}
            description={
              <span className={styles.mono}>
                {appOrigin}
                {path}
              </span>
            }
          >
            <CopyButton text={`${appOrigin}${path}`} />
          </SettingsRow>
        ))}
      </SettingsCard>

      <SettingsCard
        id="details"
        title={t("apps.detailsTitle")}
        description={t("apps.detailsDesc")}
      >
        <SettingsBody>
          <div className={styles.form}>
            <Field label={t("apps.nameLabel")} required>
              <Input
                value={form.name}
                onChange={(_, d) => set("name", d.value)}
              />
            </Field>
            <Field label={t("apps.description")}>
              <Textarea
                value={form.description}
                onChange={(_, d) => set("description", d.value)}
                rows={2}
                resize="vertical"
              />
            </Field>
            <ImageUrlInput
              label={t("apps.iconUrl")}
              value={form.icon_url}
              placeholder={t("apps.appIconPlaceholder")}
              onChange={(v) => set("icon_url", v)}
            />
            <Field label={t("apps.websiteUrl")}>
              <Input
                value={form.website_url}
                placeholder={t("apps.websiteUrlPlaceholder")}
                onChange={(_, d) => set("website_url", d.value)}
              />
            </Field>
          </div>
        </SettingsBody>
        <SectionFooter section="details" api={formApi} />
      </SettingsCard>

      <SettingsCard
        id="ownership"
        title={t("apps.ownershipTitle")}
        description={t("apps.ownershipDesc")}
      >
        <SettingsRow
          icon={app.team_id ? <PeopleRegular /> : <PersonRegular />}
          label={
            app.team_id
              ? (app.team_name ?? t("apps.team"))
              : t("apps.personalAppLabel")
          }
          description={
            app.team_id
              ? t("apps.ownedByTeam")
              : app.owner_username
                ? t("apps.ownedByUser", { username: app.owner_username })
                : undefined
          }
        >
          {app.team_id && (
            <Button
              size="small"
              appearance="subtle"
              onClick={() => navigate(`/teams/${app.team_id}`)}
            >
              {t("apps.viewTeam")}
            </Button>
          )}
          {moveTargets.length > 0 && (
            <Button size="small" onClick={() => setMoveOpen(true)}>
              {t("apps.moveToTeam")}
            </Button>
          )}
          {app.team_id && (
            <Button size="small" onClick={removeFromTeam}>
              {t("apps.removeFromTeam")}
            </Button>
          )}
        </SettingsRow>
      </SettingsCard>

      <SettingsCard id="delete" title={t("apps.dangerTab")}>
        <SettingsRow
          label={t("apps.deleteApplication")}
          description={t("apps.deleteAppDesc")}
        >
          <Button
            size="small"
            icon={<DeleteRegular />}
            className={styles.danger}
            onClick={deleteApp}
          >
            {t("common.delete")}
          </Button>
        </SettingsRow>
      </SettingsCard>

      <Dialog
        open={moveOpen}
        onOpenChange={(_, d) => {
          setMoveOpen(d.open);
          if (!d.open) setMoveTeamId("");
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("apps.moveAppToTeam")}</DialogTitle>
            <DialogContent>
              <Field
                label={t("apps.selectTeam")}
                hint={t("apps.migrateAppDesc")}
                required
              >
                <Dropdown
                  placeholder={t("apps.chooseTeam")}
                  value={
                    moveTargets.find((tm) => tm.id === moveTeamId)?.name ?? ""
                  }
                  selectedOptions={moveTeamId ? [moveTeamId] : []}
                  onOptionSelect={(_, d) => setMoveTeamId(d.optionValue ?? "")}
                >
                  {moveTargets.map((tm) => (
                    <Option key={tm.id} value={tm.id}>
                      {tm.name}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setMoveOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                appearance="primary"
                disabled={moving || !moveTeamId}
                onClick={moveToTeam}
              >
                {moving ? <Spinner size="tiny" /> : t("apps.moveToTeam")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {confirmDialog}
    </>
  );
}
