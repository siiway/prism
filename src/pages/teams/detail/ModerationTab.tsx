// Moderation (site admins, admin view only): whether this team may mint
// accounts through invite links, and the staged dissolution that removes the
// accounts it minted. Both are site-admin actions, audited server-side.

import {
  Badge,
  Button,
  Field,
  Input,
  Spinner,
  Switch,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../../lib/api";
import { useApi } from "../../../lib/api-context";
import { formatDateTime } from "../../../lib/datetime";
import { useConfirm } from "../../../lib/useConfirm";
import { useSiteName } from "../../../lib/useSiteName";
import {
  SettingsBody,
  SettingsCard,
  SettingsFooter,
  SettingsRow,
} from "../../../components/Settings";
import { Select } from "../../../components/Select";
import type { TeamTabProps } from "./types";

const useStyles = makeStyles({
  muted: { color: tokens.colorNeutralForeground3 },
  select: { width: "200px" },
  danger: { color: tokens.colorPaletteRedForeground1 },
});

export function ModerationTab({ team, showMsg }: TeamTabProps) {
  const api = useApi();
  const styles = useStyles();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const siteName = useSiteName();
  const { confirm, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");

  const run = async (key: string, action: () => Promise<string | void>) => {
    if (busy) return;
    setBusy(key);
    try {
      const done = await action();
      await qc.invalidateQueries({ queryKey: ["team", team.id] });
      await qc.invalidateQueries({ queryKey: ["admin-teams"] });
      showMsg("success", done || t("teams.moderation.saved"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("common.error"),
      );
    } finally {
      setBusy(null);
    }
  };

  const granted = !!team.invite_registration_granted;
  const skipEmail = !!team.invite_registration_exemptions?.email_verification;

  // Self-conversion: this team's override, or the site default under Sign-up.
  const { data: config } = useQuery({
    queryKey: ["admin-config"],
    queryFn: api.adminConfig,
  });
  const siteConvert =
    !!config?.config.restricted_user_capabilities?.["self:convert"];
  const convert =
    team.invite_registration_allow_convert === null ||
    team.invite_registration_allow_convert === undefined
      ? "default"
      : team.invite_registration_allow_convert
        ? "allow"
        : "deny";

  const cancelDissolve = async () => {
    const ok = await confirm({
      title: t("teams.moderation.cancelDissolveTitle"),
      body: t("teams.moderation.cancelDissolveBody"),
      confirmLabel: t("teams.moderation.cancelDissolve"),
    });
    if (ok)
      await run("cancel", async () => {
        await api.adminCancelDissolve(team.id);
        return t("teams.moderation.dissolveCancelledDone");
      });
  };

  return (
    <>
      <SettingsCard
        id="invite-registration"
        title={t("teams.moderation.inviteTitle")}
        description={t("teams.moderation.inviteDesc")}
      >
        <SettingsRow
          label={t("teams.moderation.grantLabel")}
          description={t("teams.moderation.grantDesc")}
        >
          <Switch
            aria-label={t("teams.moderation.grantLabel")}
            checked={granted}
            disabled={busy !== null}
            onChange={(_, d) =>
              void run("grant", async () => {
                await api.adminSetInviteRegistration(team.id, {
                  granted: d.checked,
                });
              })
            }
          />
        </SettingsRow>
        <SettingsRow
          label={t("teams.moderation.skipEmailLabel")}
          description={t("teams.moderation.skipEmailDesc")}
        >
          <Switch
            aria-label={t("teams.moderation.skipEmailLabel")}
            checked={skipEmail}
            disabled={!granted || busy !== null}
            onChange={(_, d) =>
              void run("email", async () => {
                await api.adminSetInviteRegistration(team.id, {
                  exemptions: { email_verification: d.checked },
                });
              })
            }
          />
        </SettingsRow>
        {/* Not tied to the grant: accounts created while it was on keep
            needing an answer after it's turned off. */}
        <SettingsRow
          label={t("teams.moderation.convertLabel")}
          description={t("teams.moderation.convertDesc")}
        >
          <Select
            aria-label={t("teams.moderation.convertLabel")}
            className={styles.select}
            value={convert}
            disabled={busy !== null}
            onChange={(_, d) =>
              void run("convert", async () => {
                await api.adminSetInviteRegistration(team.id, {
                  allow_convert:
                    d.value === "default" ? null : d.value === "allow",
                });
              })
            }
          >
            <option value="default">
              {siteConvert
                ? t("teams.moderation.convertDefaultOn")
                : t("teams.moderation.convertDefaultOff")}
            </option>
            <option value="allow">{t("teams.moderation.convertAllow")}</option>
            <option value="deny">{t("teams.moderation.convertDeny")}</option>
          </Select>
        </SettingsRow>
      </SettingsCard>

      <SettingsCard
        id="dissolve"
        title={t("admin.stagedDissolveTitle")}
        description={t("admin.stagedDissolveBody", {
          siteName,
          name: team.name,
        })}
        badge={
          team.dissolving_at ? (
            <Badge appearance="tint" color="danger" size="small">
              {t("teams.moderation.dissolving")}
            </Badge>
          ) : undefined
        }
      >
        {team.dissolving_at ? (
          <SettingsRow
            label={t("teams.moderation.dissolvingSince", {
              date: formatDateTime(team.dissolving_at),
            })}
            description={t("teams.moderation.dissolvingDesc")}
          >
            <Button
              size="small"
              disabled={busy !== null}
              onClick={() => void cancelDissolve()}
            >
              {busy === "cancel" ? (
                <Spinner size="tiny" />
              ) : (
                t("teams.moderation.cancelDissolve")
              )}
            </Button>
          </SettingsRow>
        ) : (
          <>
            {/* Typing the name back is the confirmation: it can't come from
                a mis-click. */}
            <SettingsBody>
              <Field
                label={t("admin.stagedDissolveConfirmLabel", {
                  name: team.name,
                })}
              >
                <Input
                  value={confirmName}
                  onChange={(_, d) => setConfirmName(d.value)}
                />
              </Field>
              {!granted && (
                <Text size={200} className={styles.muted}>
                  {t("teams.moderation.dissolveNotGranted")}
                </Text>
              )}
            </SettingsBody>
            <SettingsFooter>
              <Button
                className={
                  confirmName.trim() === team.name ? styles.danger : undefined
                }
                disabled={confirmName.trim() !== team.name || busy !== null}
                onClick={() =>
                  void run("dissolve", async () => {
                    const res = await api.adminStartDissolve(
                      team.id,
                      confirmName.trim(),
                    );
                    setConfirmName("");
                    return t("teams.moderation.dissolveStarted", {
                      count: res.deactivated_accounts,
                    });
                  })
                }
              >
                {busy === "dissolve" ? (
                  <Spinner size="tiny" />
                ) : (
                  t("admin.stagedDissolveStart")
                )}
              </Button>
            </SettingsFooter>
          </>
        )}
      </SettingsCard>

      {confirmDialog}
    </>
  );
}
