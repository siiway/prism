// Moderation (site admins, admin view only): the switches an operator flips
// on someone else's app, moving it to another owner, and cutting off every
// grant in an incident. Each is a site-admin action, audited server-side.

import {
  Button,
  Field,
  Input,
  Switch,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { type OAuthApp } from "../../../lib/api";
import { apiErrorText } from "../../../lib/apiError";
import { useApi } from "../../../lib/api-context";
import { useConfirm } from "../../../lib/useConfirm";
import { Segmented } from "../../../components/Segmented";
import {
  SettingsBody,
  SettingsCard,
  SettingsFooter,
  SettingsRow,
} from "../../../components/Settings";
import { AdminSamlCard } from "../../admin/AdminSamlCard";
import type { AppFormApi } from "./form";

const useStyles = makeStyles({
  kind: { alignSelf: "flex-start" },
  danger: { color: tokens.colorPaletteRedForeground1 },
});

type Flag = "is_active" | "is_verified" | "is_official" | "is_first_party";

interface Props {
  app: OAuthApp;
  formApi: AppFormApi;
  showMsg: (type: "success" | "error", text: string) => void;
}

export function ModerationTab({ app, formApi, showMsg }: Props) {
  const api = useApi();
  const styles = useStyles();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { confirm, confirmDialog } = useConfirm();
  const busy = formApi.saving !== null;

  const fail = (err: unknown) =>
    showMsg("error", apiErrorText(err, t("common.error")));
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["app", app.id] });
    await qc.invalidateQueries({ queryKey: ["admin-apps"] });
  };

  // Shares the page's one-write-at-a-time lock with the other tabs.
  const setFlag = (flag: Flag, value: boolean) =>
    formApi.exclusive(async () => {
      try {
        await api.adminUpdateApp(app.id, { [flag]: value });
        await refresh();
        showMsg("success", t("admin.appUpdated"));
      } catch (err) {
        fail(err);
      }
    });

  const flags: { flag: Flag; label: string; desc: string }[] = [
    {
      flag: "is_active",
      label: t("admin.activeToggle"),
      desc: t("apps.moderation.activeDesc"),
    },
    {
      flag: "is_verified",
      label: t("admin.verifiedToggle"),
      desc: t("apps.moderation.verifiedDesc"),
    },
    {
      flag: "is_official",
      label: t("admin.officialToggle"),
      desc: t("apps.moderation.officialDesc"),
    },
    {
      flag: "is_first_party",
      label: t("admin.firstPartyToggle"),
      desc: t("apps.moderation.firstPartyDesc"),
    },
  ];

  // ── Transfer ───────────────────────────────────────────────────────────────
  const [kind, setKind] = useState<"user" | "team">("user");
  const [target, setTarget] = useState("");
  const transfer = async () => {
    const value = target.trim();
    if (!value) return;
    const ok = await confirm({
      title: t("admin.transferAppTitle", { name: app.name }),
      body: t("admin.transferAppHint"),
      confirmLabel: t("admin.transferApp"),
    });
    if (!ok) return;
    await formApi.exclusive(async () => {
      try {
        await api.adminTransferApp(
          app.id,
          kind === "team" ? { team_id: value } : { owner_id: value },
        );
        setTarget("");
        await refresh();
        showMsg("success", t("admin.appTransferredDone"));
      } catch (err) {
        fail(err);
      }
    });
  };

  // ── Revoke ─────────────────────────────────────────────────────────────────
  const [deactivate, setDeactivate] = useState(false);
  const revoke = async () => {
    const ok = await confirm({
      title: t("admin.revokeAppTitle", { name: app.name }),
      body: t("admin.revokeAppBody"),
      confirmLabel: t("common.revoke"),
    });
    if (!ok) return;
    await formApi.exclusive(async () => {
      try {
        const res = await api.adminRevokeApp(app.id, deactivate);
        setDeactivate(false);
        await refresh();
        showMsg(
          "success",
          t("admin.revokeAppDone", {
            tokens: res.tokens_revoked,
            consents: res.consents_revoked,
          }),
        );
      } catch (err) {
        fail(err);
      }
    });
  };

  return (
    <>
      <SettingsCard
        id="moderation"
        title={t("apps.moderation.title")}
        description={t("apps.moderation.desc")}
      >
        {flags.map(({ flag, label, desc }) => (
          <SettingsRow key={flag} label={label} description={desc}>
            <Switch
              aria-label={label}
              checked={!!app[flag]}
              disabled={busy}
              onChange={(_, d) => void setFlag(flag, d.checked)}
            />
          </SettingsRow>
        ))}
      </SettingsCard>

      <AdminSamlCard target="app" id={app.id} showMsg={showMsg} />

      <SettingsCard
        id="transfer"
        title={t("apps.moderation.transferTitle")}
        description={t("admin.transferAppHint")}
      >
        <SettingsBody>
          <Segmented
            className={styles.kind}
            label={t("admin.transferTargetKind")}
            value={kind}
            onChange={setKind}
            options={[
              { value: "user", label: t("admin.transferToUser") },
              { value: "team", label: t("admin.transferToTeam") },
            ]}
          />
          <Field
            label={
              kind === "user"
                ? t("admin.transferUserLabel")
                : t("admin.transferTeamLabel")
            }
          >
            <Input
              value={target}
              onChange={(_, d) => setTarget(d.value)}
              onKeyDown={(e) => e.key === "Enter" && void transfer()}
            />
          </Field>
        </SettingsBody>
        <SettingsFooter>
          <Button
            disabled={!target.trim() || busy}
            onClick={() => void transfer()}
          >
            {t("admin.transferApp")}
          </Button>
        </SettingsFooter>
      </SettingsCard>

      <SettingsCard
        id="revoke"
        title={t("admin.revokeAppTooltip")}
        description={t("admin.revokeAppBody")}
      >
        <SettingsRow label={t("admin.revokeAppDeactivate")}>
          <Switch
            aria-label={t("admin.revokeAppDeactivate")}
            checked={deactivate}
            onChange={(_, d) => setDeactivate(d.checked)}
          />
        </SettingsRow>
        <SettingsFooter>
          <Button
            className={styles.danger}
            disabled={busy}
            onClick={() => void revoke()}
          >
            {t("common.revoke")}
          </Button>
        </SettingsFooter>
      </SettingsCard>

      {confirmDialog}
    </>
  );
}
