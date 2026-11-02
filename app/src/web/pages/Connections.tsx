// Linked accounts: third-party accounts (GitHub, Google, …) linked for
// sign-in. Two settings cards: the accounts you've linked, grouped by
// provider, and the providers you can link.

import {
  Avatar,
  Badge,
  Button,
  Image,
  Spinner,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { ArrowClockwiseRegular, GlobeRegular } from "@fluentui/react-icons";
import { Fragment, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../lib/api";
import { apiErrorText } from "../lib/apiError";
import { useApi } from "../lib/api-context";
import { formatDate } from "../lib/datetime";
import { useConfirm } from "../lib/useConfirm";
import { useToastMessage } from "../lib/useToastMessage";
import { useAuthStore } from "../store/auth";
import { GetStartedPanel } from "../components/GetStartedPanel";
import { NoProvidersArt, ProviderSetupArt } from "../components/Illustrations";
import { PageHeader } from "../components/PageHeader";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsPage,
  SettingsRow,
  SettingsSubhead,
  SettingsToast,
} from "../components/Settings";
import { SkeletonSettingsCard } from "../components/Skeletons";

const useStyles = makeStyles({
  // Provider logos are drawn for a light background, so the tile stays white.
  logo: {
    width: "32px",
    height: "32px",
    borderRadius: tokens.borderRadiusMedium,
    background: "#fff",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#616161",
    fontSize: "18px",
  },
  // Provider ids can be long unbroken strings (Cloudflare's are 32 hex chars).
  wrap: { overflowWrap: "anywhere" },
  danger: { color: tokens.colorPaletteRedForeground1 },
});

// URL is pre-proxied by /api/site, so no client-side proxy registration.
function ProviderLogo({ url, name }: { url: string | null; name: string }) {
  const styles = useStyles();
  // A dead icon URL would otherwise show the browser's broken-image glyph.
  const [failed, setFailed] = useState(false);
  return (
    <span className={styles.logo}>
      {url && !failed ? (
        <Image
          src={url}
          alt={name}
          width={20}
          height={20}
          fit="contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <GlobeRegular />
      )}
    </span>
  );
}

// Error codes the connect/refresh flows can come back with.
const ERROR_CODES = [
  "invalid_state",
  "profile_fetch_failed",
  "token_exchange_failed",
  "no_access_token",
  "no_user_id",
  "missing_params",
  "access_denied",
  "registration_disabled",
  "user_creation_failed",
  "already_connected",
  "account_taken",
  "invalid_signature",
  "auth_expired",
  "unsupported_refresh",
  "account_mismatch",
  "reauthorization_required",
] as const;
const isErrorCode = (code: string): code is (typeof ERROR_CODES)[number] =>
  (ERROR_CODES as readonly string[]).includes(code);

function textField(profile: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = profile[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "bigint")
      return String(value);
  }
  return null;
}

function profileOf(profile: unknown): Record<string, unknown> | null {
  return profile && typeof profile === "object"
    ? (profile as Record<string, unknown>)
    : null;
}

function avatarUrl(conn: {
  provider_type?: string;
  provider_user_id: string;
  profile: unknown;
}): string | null {
  const profile = profileOf(conn.profile);
  if (!profile) return null;
  const direct = textField(profile, [
    "avatar_url",
    "photo_url",
    "picture",
    "image",
    "profile_image_url",
  ]);
  if (direct) return direct;
  if (conn.provider_type === "discord") {
    const id = textField(profile, ["id"]) ?? conn.provider_user_id;
    const hash = textField(profile, ["avatar"]);
    if (!id || !hash) return null;
    const ext = hash.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${id}/${hash}.${ext}?size=128`;
  }
  return null;
}

/** Display name, @username and platform id from a provider profile. */
function accountDetails(conn: { profile: unknown; provider_user_id: string }) {
  const profile = profileOf(conn.profile);
  const telegramName = profile
    ? [profile.first_name, profile.last_name]
        .filter((p): p is string => typeof p === "string" && !!p)
        .join(" ")
        .trim() || null
    : null;
  const name = profile
    ? (textField(profile, [
        "nickname",
        "display_name",
        "name",
        "global_name",
      ]) ?? telegramName)
    : null;
  const username = profile
    ? textField(profile, [
        "username",
        "login",
        "preferred_username",
        "user_name",
      ])
    : null;
  const id =
    (profile ? textField(profile, ["id", "sub", "user_id", "uid"]) : null) ??
    conn.provider_user_id;
  const email = profile ? textField(profile, ["email"]) : null;
  return { name: name ?? username ?? email ?? id, username, id };
}

export function Connections() {
  const api = useApi();
  const styles = useStyles();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isAdmin = useAuthStore((s) => s.user?.role === "admin");
  const { message, showMsg } = useToastMessage(8000);
  const { confirm, confirmDialog } = useConfirm();

  const { data: connectionsData, isLoading: connsLoading } = useQuery({
    queryKey: ["connections"],
    queryFn: api.listConnections,
  });
  const { data: site, isLoading: siteLoading } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });
  const isLoading = connsLoading || siteLoading;

  const errorText = (code: string) =>
    isErrorCode(code)
      ? t(`connections.errors.${code}`)
      : t("connections.errors.unknown", { code: code.replace(/_/g, " ") });

  // Coming back from a provider: ?success=connected or ?error=<code>.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    const success = params.get("success");
    if (!error && success !== "connected") return;
    // Queued so the setState isn't part of the effect body proper; the
    // history rewrite stays here so a reload doesn't replay the message.
    queueMicrotask(() => {
      if (error) showMsg("error", errorText(error));
      else showMsg("success", t("connections.connectedSuccessfully"));
    });
    window.history.replaceState({}, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One change at a time; holds what's being changed.
  const [busy, setBusy] = useState<string | null>(null);

  const connect = async (slug: string) => {
    if (busy) return;
    setBusy(`connect:${slug}`);
    try {
      const { token: intent } = await api.connectionIntent();
      const { redirect } = await api.connectionBegin(slug, {
        mode: "connect",
        intent,
      });
      window.location.assign(redirect);
    } catch (err) {
      showMsg(
        "error",
        apiErrorText(err, t("connections.failedStartConnection")),
      );
      setBusy(null);
    }
  };

  const disconnect = async (
    id: string,
    accountName: string,
    providerName: string,
  ) => {
    if (busy) return;
    const ok = await confirm({
      title: t("connections.disconnectConfirm", {
        name: accountName,
        provider: providerName,
      }),
      body: t("connections.disconnectWarning"),
      confirmLabel: t("connections.disconnectAction"),
    });
    if (!ok) return;
    setBusy(`disconnect:${id}`);
    try {
      await api.disconnectConnection(id);
      await qc.invalidateQueries({ queryKey: ["connections"] });
      showMsg(
        "success",
        t("connections.disconnectedFrom", { provider: providerName }),
      );
    } catch (err) {
      showMsg("error", apiErrorText(err, t("connections.disconnectFailed")));
    } finally {
      setBusy(null);
    }
  };

  const refresh = async (id: string, providerName: string) => {
    if (busy) return;
    setBusy(`refresh:${id}`);
    try {
      await api.refreshConnection(id);
      await qc.invalidateQueries({ queryKey: ["connections"] });
      showMsg(
        "success",
        t("connections.refreshedFrom", { provider: providerName }),
      );
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError
          ? errorText(err.message)
          : t("connections.refreshFailed"),
      );
    } finally {
      setBusy(null);
    }
  };

  const providers = site?.enabled_providers ?? [];
  const connections = connectionsData?.connections ?? [];
  // Accounts linked through a provider an admin has since turned off still
  // exist; they're listed so they can be seen and disconnected.
  const slugs = [
    ...providers.map((p) => p.slug),
    ...new Set(
      connections
        .map((c) => c.provider)
        .filter((s) => !providers.some((p) => p.slug === s)),
    ),
  ];
  const providerInfo = (slug: string) => {
    const p = providers.find((x) => x.slug === slug);
    return {
      name: p?.name ?? slug,
      type: p?.provider,
      logo: p?.icon_proxied_url ?? null,
      enabled: !!p,
    };
  };
  const linkedGroups = slugs
    .map((slug) => ({
      slug,
      ...providerInfo(slug),
      conns: connections.filter((c) => c.provider === slug),
    }))
    .filter((g) => g.conns.length > 0);

  return (
    <SettingsPage>
      <PageHeader
        title={t("connections.title")}
        subtitle={t("connections.description")}
        style={{ marginBottom: 0 }}
      />
      <SettingsToast message={message} />

      {isLoading && (
        <>
          <SkeletonSettingsCard rows={2} />
          <SkeletonSettingsCard rows={3} />
        </>
      )}

      {/* Nothing to link. An admin can fix that, so they get the steps;
          everyone else learns why the page is empty. */}
      {!isLoading &&
        slugs.length === 0 &&
        (isAdmin ? (
          <GetStartedPanel
            art={<ProviderSetupArt />}
            title={t("connections.noProvidersAdminTitle")}
            description={t("connections.noProvidersAdminDesc")}
            steps={[
              t("connections.setupStep1"),
              t("connections.setupStep2"),
              t("connections.setupStep3"),
            ]}
            action={
              <Button
                appearance="primary"
                onClick={() => navigate("/admin/connections")}
              >
                {t("connections.setUpProviders")}
              </Button>
            }
          />
        ) : (
          <GetStartedPanel
            art={<NoProvidersArt />}
            title={t("connections.noProvidersTitle")}
            description={t("connections.noProvidersDesc")}
          />
        ))}

      {!isLoading && slugs.length > 0 && (
        <SettingsCard
          id="linked"
          title={t("connections.linkedTitle")}
          description={t("connections.linkedDesc")}
        >
          {linkedGroups.length === 0 ? (
            <SettingsEmpty>{t("connections.noneLinked")}</SettingsEmpty>
          ) : (
            linkedGroups.map((g) => (
              <Fragment key={g.slug}>
                <SettingsSubhead>{g.name}</SettingsSubhead>
                {g.conns.map((conn) => {
                  const d = accountDetails(conn);
                  const canRefresh = g.enabled && g.type !== "telegram";
                  const facts = [
                    d.username && d.username !== d.name ? `@${d.username}` : "",
                    d.id !== d.name && d.id !== d.username
                      ? t("connections.detailId", { value: d.id })
                      : "",
                    t("connections.connectedOn", {
                      date: formatDate(conn.connected_at),
                    }),
                  ].filter(Boolean);
                  return (
                    <SettingsRow
                      key={conn.id}
                      icon={
                        <Avatar
                          size={32}
                          name={d.name}
                          image={(() => {
                            const src = avatarUrl({
                              ...conn,
                              provider_type: g.type,
                            });
                            return src ? { src } : undefined;
                          })()}
                        />
                      }
                      label={
                        <>
                          <span className={styles.wrap}>{d.name}</span>
                          {!g.enabled && (
                            <Badge
                              appearance="tint"
                              color="warning"
                              size="small"
                            >
                              {t("connections.providerDisabled")}
                            </Badge>
                          )}
                        </>
                      }
                      description={
                        <span className={styles.wrap}>{facts.join(" · ")}</span>
                      }
                    >
                      {canRefresh && (
                        <Tooltip
                          content={t("connections.refreshAction")}
                          relationship="label"
                        >
                          <Button
                            size="small"
                            appearance="subtle"
                            icon={
                              busy === `refresh:${conn.id}` ? (
                                <Spinner size="tiny" />
                              ) : (
                                <ArrowClockwiseRegular />
                              )
                            }
                            disabled={busy !== null}
                            onClick={() => void refresh(conn.id, g.name)}
                          />
                        </Tooltip>
                      )}
                      <Button
                        size="small"
                        className={styles.danger}
                        disabled={busy !== null}
                        onClick={() => void disconnect(conn.id, d.name, g.name)}
                      >
                        {busy === `disconnect:${conn.id}` ? (
                          <Spinner size="tiny" />
                        ) : (
                          t("connections.disconnectAction")
                        )}
                      </Button>
                    </SettingsRow>
                  );
                })}
              </Fragment>
            ))
          )}
        </SettingsCard>
      )}

      {!isLoading && providers.length > 0 && (
        <SettingsCard
          id="link"
          title={t("connections.linkTitle")}
          description={t("connections.linkDesc")}
        >
          {providers.map((p) => {
            const count = connections.filter(
              (c) => c.provider === p.slug,
            ).length;
            return (
              <SettingsRow
                key={p.slug}
                icon={
                  <ProviderLogo
                    url={p.icon_proxied_url ?? null}
                    name={p.name}
                  />
                }
                label={p.name}
                description={
                  count > 0
                    ? t("connections.connected", { count })
                    : t("connections.notConnected")
                }
              >
                <Button
                  size="small"
                  disabled={busy !== null}
                  onClick={() => void connect(p.slug)}
                >
                  {busy === `connect:${p.slug}` ? (
                    <Spinner size="tiny" />
                  ) : count > 0 ? (
                    t("connections.linkAnother")
                  ) : (
                    t("connections.linkAction")
                  )}
                </Button>
              </SettingsRow>
            );
          })}
        </SettingsCard>
      )}
      {confirmDialog}
    </SettingsPage>
  );
}
