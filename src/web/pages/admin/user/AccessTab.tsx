// Access: everything that can act as the account — sessions, personal
// access tokens, linked providers, GPG keys and app authorizations — each
// removable on its own, with "everything" buttons for a compromised account.

import {
  Avatar,
  Button,
  Spinner,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiErrorText } from "../../../lib/apiError";
import { useApi } from "../../../lib/api-context";
import { maskIp, parseClient } from "../../../lib/auditFormat";
import { formatDate, formatDateTime } from "../../../lib/datetime";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsRow,
} from "../../../components/Settings";
import { SkeletonSettingsCard } from "../../../components/Skeletons";
import { RemovableCard } from "./RemovableCard";
import type { UserTabProps } from "./types";
import { clientI18n } from "../../../i18n/init";

const useStyles = makeStyles({
  mono: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  danger: { color: tokens.colorPaletteRedForeground1 },
  ip: {
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
    textUnderlineOffset: "2px",
  },
});

// Event handlers only, so the browser's i18n instance is the right one.
const fail = (err: unknown) => apiErrorText(err, clientI18n.t("common.error"));

function SessionsCard({ userId, showMsg, confirm }: UserTabProps) {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["admin-user-sessions", userId],
    queryFn: () => api.adminUserSessions(userId),
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
      await qc.invalidateQueries({ queryKey: ["admin-user-sessions", userId] });
      showMsg("success", done);
    } catch (err) {
      showMsg("error", fail(err));
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <SkeletonSettingsCard rows={2} />;

  const endAll = async () => {
    const ok = await confirm({
      title: t("admin.userPage.endAllTitle"),
      body: t("admin.userPage.endAllBody"),
      confirmLabel: t("admin.endAllSessions"),
    });
    if (ok)
      await run(
        "all",
        () => api.adminTerminateSessions(userId),
        t("admin.sessionsEndedDone"),
      );
  };

  return (
    <SettingsCard
      id="sessions"
      title={t("admin.sessionsSection")}
      description={t("admin.userPage.sessionsDesc")}
      action={
        <Button
          size="small"
          disabled={data.sessions.length === 0 || busy !== null}
          onClick={() => void endAll()}
        >
          {busy === "all" ? <Spinner size="tiny" /> : t("admin.endAllSessions")}
        </Button>
      }
    >
      {data.sessions.length === 0 ? (
        <SettingsEmpty>{t("admin.noSessions")}</SettingsEmpty>
      ) : (
        data.sessions.map((s) => {
          // Where a session has been used is what tells an attacker's login
          // apart, so the places are on screen, not a click away.
          const ips = s.ips.length
            ? s.ips
            : [{ ip_address: s.ip_address, last_seen: s.created_at }];
          return (
            <SettingsRow
              key={s.id}
              label={parseClient(s.user_agent)}
              description={
                <>
                  {t("admin.userPage.startedOn", {
                    date: formatDateTime(s.created_at),
                  })}
                  {" · "}
                  {ips.slice(0, 3).map((ip, i) => (
                    <span key={i}>
                      {i > 0 && ", "}
                      <Tooltip
                        relationship="description"
                        withArrow
                        content={`${ip.ip_address ?? "—"} · ${formatDateTime(ip.last_seen)}`}
                      >
                        <span className={styles.ip}>
                          {maskIp(ip.ip_address)}
                        </span>
                      </Tooltip>
                    </span>
                  ))}
                  {ips.length > 3 && ` +${ips.length - 3}`}
                </>
              }
            >
              <Button
                size="small"
                className={styles.danger}
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    s.id,
                    () => api.adminRevokeSession(userId, s.id),
                    t("admin.sessionEndedDone"),
                  )
                }
              >
                {busy === s.id ? (
                  <Spinner size="tiny" />
                ) : (
                  t("admin.userPage.end")
                )}
              </Button>
            </SettingsRow>
          );
        })
      )}
    </SettingsCard>
  );
}

export function AccessTab(props: UserTabProps) {
  const { userId, showMsg, confirm } = props;
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [revoking, setRevoking] = useState(false);

  const tokensQ = useQuery({
    queryKey: ["admin-user-tokens", userId],
    queryFn: () => api.adminUserTokens(userId),
  });
  const connections = useQuery({
    queryKey: ["admin-user-connections", userId],
    queryFn: () => api.adminUserConnections(userId),
  });
  const gpgKeys = useQuery({
    queryKey: ["admin-user-gpg", userId],
    queryFn: () => api.adminUserGpgKeys(userId),
  });
  const authorizations = useQuery({
    queryKey: ["admin-user-authorizations", userId],
    queryFn: () => api.adminUserAuthorizations(userId),
  });

  // The per-row revoke handles one app; this handles a compromised account,
  // where the answer is all of them.
  const revokeAll = async () => {
    const ok = await confirm({
      title: t("admin.revokeAllGrants"),
      body: t("admin.revokeGrantsHint"),
      confirmLabel: t("admin.revokeAllGrants"),
    });
    if (!ok) return;
    setRevoking(true);
    try {
      const res = await api.adminRevokeUserGrants(userId);
      await qc.invalidateQueries({
        queryKey: ["admin-user-authorizations", userId],
      });
      showMsg(
        "success",
        t("admin.revokeGrantsDone", {
          tokens: res.tokens_revoked,
          consents: res.consents_revoked,
        }),
      );
    } catch (err) {
      showMsg("error", fail(err));
    } finally {
      setRevoking(false);
    }
  };

  const common = { showMsg, confirm };

  return (
    <>
      <SessionsCard {...props} />

      <RemovableCard
        {...common}
        id="tokens"
        title={t("admin.tokensSection")}
        rows={tokensQ.data?.tokens.map((row) => ({
          id: row.id,
          name: row.name,
          description: (
            <>
              <span className={styles.mono}>{row.scopes.join(" ")}</span>
              {" · "}
              {row.last_used_at
                ? t("admin.userPage.lastUsedOn", {
                    date: formatDate(row.last_used_at),
                  })
                : t("admin.userPage.neverUsed")}
            </>
          ),
        }))}
        emptyText={t("admin.noTokens")}
        removeLabel={t("common.revoke")}
        onRemove={(tokenId) => api.adminRevokeUserToken(userId, tokenId)}
        doneText={t("common.revokedDone")}
      />

      <RemovableCard
        {...common}
        id="authorizations"
        title={t("admin.authorizationsSection")}
        action={
          <Button
            size="small"
            disabled={
              revoking ||
              (authorizations.data?.authorizations.length ?? 0) === 0
            }
            onClick={() => void revokeAll()}
          >
            {revoking ? <Spinner size="tiny" /> : t("admin.revokeAllGrants")}
          </Button>
        }
        rows={authorizations.data?.authorizations.map((row) => ({
          id: row.id,
          name: row.app_name ?? row.client_id,
          icon: (
            <Avatar
              size={32}
              shape="square"
              name={row.app_name ?? row.client_id}
              image={row.icon_url ? { src: row.icon_url } : undefined}
            />
          ),
          description: (
            <>
              <span className={styles.mono}>{row.scopes.join(" ")}</span>
              {" · "}
              {t("admin.userPage.grantedOn", {
                date: formatDate(row.granted_at),
              })}
            </>
          ),
        }))}
        emptyText={t("admin.noAuthorizations")}
        removeLabel={t("common.revoke")}
        onRemove={(consentId) =>
          api.adminRevokeUserAuthorization(userId, consentId)
        }
        doneText={t("common.revokedDone")}
      />

      <RemovableCard
        {...common}
        id="connections"
        title={t("admin.connectionsSection")}
        rows={connections.data?.connections.map((row) => ({
          id: row.id,
          name: row.provider,
          description: (
            <>
              <span className={styles.mono}>{row.provider_user_id}</span>
              {" · "}
              {t("admin.userPage.linkedOn", {
                date: formatDate(row.connected_at),
              })}
            </>
          ),
        }))}
        emptyText={t("admin.noConnections")}
        removeLabel={t("common.remove")}
        onRemove={(connId) => api.adminRemoveUserConnection(userId, connId)}
        doneText={t("common.removedDone")}
      />

      <RemovableCard
        {...common}
        id="gpg"
        title={t("admin.gpgSection")}
        rows={gpgKeys.data?.keys.map((row) => ({
          id: row.id,
          name: row.name,
          description: (
            <>
              <span className={styles.mono}>{row.fingerprint}</span>
              {" · "}
              {t("admin.userPage.addedOn", {
                date: formatDate(row.created_at),
              })}
            </>
          ),
        }))}
        emptyText={t("admin.noGpgKeys")}
        removeLabel={t("common.remove")}
        onRemove={(keyId) => api.adminRemoveUserGpgKey(userId, keyId)}
        doneText={t("common.removedDone")}
      />
    </>
  );
}
