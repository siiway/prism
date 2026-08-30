// Connected Apps — OAuth consents & token management

import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Input,
  MessageBar,
  Spinner,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowSyncRegular,
  ClockRegular,
  DismissRegular,
  GlobeRegular,
  KeyRegular,
  SearchRegular,
  ShieldRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError, type OAuthConsent, type OAuthToken } from "../lib/api";
import { CopyIdTrigger } from "../components/CopyIdTrigger";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { Pagination } from "../components/Pagination";
import { SkeletonConsentCards } from "../components/Skeletons";

const useStyles = makeStyles({
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  card: {
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground1,
    overflow: "hidden",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    padding: "16px 20px",
  },
  appIcon: {
    width: "48px",
    height: "48px",
    borderRadius: "8px",
    background: tokens.colorNeutralBackground3,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  info: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  nameRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },
  scopes: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px",
    marginTop: "2px",
  },
  tokenPanel: {
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    padding: "0 20px 16px 20px",
  },
  tokenRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "10px 0",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    ":last-child": { borderBottom: "none" },
  },
  tokenIcon: {
    width: "32px",
    height: "32px",
    borderRadius: "6px",
    background: tokens.colorNeutralBackground3,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  tokenInfo: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
});

function formatRelative(
  ts: number,
  t: (key: string, options?: Record<string, unknown>) => string,
  locale?: string,
): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const diffSec = ts - nowSec;
  const absSec = Math.abs(diffSec);

  if (absSec < 60) {
    return diffSec >= 0
      ? t("connectedApps.inLessThanMinute")
      : t("connectedApps.justNow");
  }

  const absMins = Math.floor(absSec / 60);
  if (absMins < 60) {
    return diffSec >= 0
      ? t("connectedApps.inMinutes", { count: absMins })
      : t("connectedApps.minutesAgo", { count: absMins });
  }

  const absHours = Math.floor(absMins / 60);
  if (absHours < 24) {
    return diffSec >= 0
      ? t("connectedApps.inHours", { count: absHours })
      : t("connectedApps.hoursAgo", { count: absHours });
  }

  return new Date(ts * 1000).toLocaleDateString(locale);
}

function TokenRow({
  token,
  onRevoke,
  revoking,
}: {
  token: OAuthToken;
  onRevoke: (id: string) => void;
  revoking: string | null;
}) {
  const styles = useStyles();
  const { t, i18n } = useTranslation();

  return (
    <div className={styles.tokenRow}>
      <Tooltip
        content={
          token.is_persistent
            ? t("connectedApps.persistent")
            : t("connectedApps.session")
        }
        relationship="label"
      >
        <div className={styles.tokenIcon}>
          {token.is_persistent ? (
            <ArrowSyncRegular
              fontSize={16}
              style={{ color: tokens.colorBrandForeground1 }}
            />
          ) : (
            <ClockRegular
              fontSize={16}
              style={{ color: tokens.colorNeutralForeground3 }}
            />
          )}
        </div>
      </Tooltip>

      <div className={styles.tokenInfo}>
        <Text size={300} weight="semibold">
          {token.is_persistent
            ? t("connectedApps.persistent")
            : t("connectedApps.session")}
        </Text>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          {t("connectedApps.issuedAgo", {
            time: formatRelative(token.created_at, t, i18n.resolvedLanguage),
          })}
          {" · "}
          {t("connectedApps.expiresAgo", {
            time: formatRelative(token.expires_at, t, i18n.resolvedLanguage),
          })}
        </Text>
      </div>

      <Button
        appearance="subtle"
        icon={<DismissRegular />}
        size="small"
        disabled={revoking === token.id}
        onClick={() => onRevoke(token.id)}
        style={{ flexShrink: 0 }}
      >
        {revoking === token.id ? (
          <Spinner size="tiny" />
        ) : (
          t("connectedApps.revokeToken")
        )}
      </Button>
    </div>
  );
}

function ConsentCard({
  consent,
  onRevokeConsent,
  onRevokeToken,
  revokingConsent,
  revokingToken,
}: {
  consent: OAuthConsent;
  onRevokeConsent: (c: OAuthConsent) => void;
  onRevokeToken: (id: string) => void;
  revokingConsent: string | null;
  revokingToken: string | null;
}) {
  const styles = useStyles();
  const { t } = useTranslation();

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <CopyIdTrigger id={consent.client_id} label={t("common.copyClientId")}>
          {consent.app.icon_url ? (
            <Avatar
              image={{ src: consent.app.icon_url }}
              name={consent.app.name}
              size={48}
              shape="square"
            />
          ) : (
            <div className={styles.appIcon}>
              <GlobeRegular
                fontSize={24}
                style={{ color: tokens.colorNeutralForeground3 }}
              />
            </div>
          )}
        </CopyIdTrigger>

        <div className={styles.info}>
          <div className={styles.nameRow}>
            <Text weight="semibold" size={400}>
              {consent.app.name}
            </Text>
            {consent.app.is_verified && (
              <Badge
                color="success"
                appearance="filled"
                size="small"
                icon={<ShieldRegular />}
              >
                {t("connectedApps.verified")}
              </Badge>
            )}
            <Badge
              color="informative"
              appearance="tint"
              size="small"
              icon={<KeyRegular />}
            >
              {t("connectedApps.tokenCount", { count: consent.tokens.length })}
            </Badge>
          </div>

          {consent.app.website_url && (
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {consent.app.website_url}
            </Text>
          )}

          <div className={styles.scopes}>
            {consent.scopes.map((s) => (
              <Badge key={s} appearance="tint" color="subtle" size="small">
                {s}
              </Badge>
            ))}
          </div>

          <Text
            size={100}
            style={{ color: tokens.colorNeutralForeground3, marginTop: 2 }}
          >
            {t("connectedApps.authorized", {
              date: new Date(consent.granted_at * 1000).toLocaleDateString(),
            })}
          </Text>
        </div>

        <Dialog>
          <DialogTrigger disableButtonEnhancement>
            <Button
              appearance="outline"
              size="small"
              style={{
                color: tokens.colorPaletteRedForeground1,
                flexShrink: 0,
              }}
              disabled={revokingConsent === consent.client_id}
            >
              {t("connectedApps.revokeAll")}
            </Button>
          </DialogTrigger>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>
                {t("connectedApps.revokeTitle", { name: consent.app.name })}
              </DialogTitle>
              <DialogContent>
                {t("connectedApps.revokeDesc", { name: consent.app.name })}
              </DialogContent>
              <DialogActions>
                <DialogTrigger>
                  <Button>{t("common.cancel")}</Button>
                </DialogTrigger>
                <Button
                  appearance="primary"
                  style={{ background: tokens.colorPaletteRedBackground3 }}
                  onClick={() => onRevokeConsent(consent)}
                >
                  {t("connectedApps.revokeAccess")}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      </div>

      {consent.tokens.length > 0 && (
        <Accordion collapsible>
          <AccordionItem value="tokens">
            <AccordionHeader size="small" style={{ padding: "0 20px" }}>
              <Text
                size={200}
                style={{ color: tokens.colorNeutralForeground2 }}
              >
                {t("connectedApps.activeSessions", {
                  count: consent.tokens.length,
                })}
              </Text>
            </AccordionHeader>
            <AccordionPanel>
              <div className={styles.tokenPanel}>
                {consent.tokens.map((token) => (
                  <TokenRow
                    key={token.id}
                    token={token}
                    onRevoke={onRevokeToken}
                    revoking={revokingToken}
                  />
                ))}
              </div>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
}

export function ConnectedApps() {
  const styles = useStyles();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [revokingConsent, setRevokingConsent] = useState<string | null>(null);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [query]);

  const { data, isFetching } = useQuery({
    queryKey: ["consents", page, debouncedQuery],
    queryFn: () =>
      api.listConsents({ page, limit: 20, q: debouncedQuery || undefined }),
  });

  const handleRevokeConsent = async (consent: OAuthConsent) => {
    setRevokingConsent(consent.client_id);
    try {
      await api.revokeConsent(consent.client_id);
      await qc.invalidateQueries({ queryKey: ["consents"] });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t("connectedApps.revokeFailed"),
      );
    } finally {
      setRevokingConsent(null);
    }
  };

  const handleRevokeToken = async (tokenId: string) => {
    setRevokingToken(tokenId);
    try {
      await api.revokeToken(tokenId);
      await qc.invalidateQueries({ queryKey: ["consents"] });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t("connectedApps.revokeFailed"),
      );
    } finally {
      setRevokingToken(null);
    }
  };

  const consents = data?.consents ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, flex: 1 }}>
      <PageHeader
        title={t("connectedApps.title")}
        subtitle={t("connectedApps.description")}
        style={{ marginBottom: 0 }}
      />

      {error && <MessageBar intent="error">{error}</MessageBar>}

      {isFetching && !data ? (
        <SkeletonConsentCards count={3} />
      ) : !isFetching && data?.consents.length === 0 && !debouncedQuery ? (
        <EmptyState icon={<GlobeRegular />} title={t("connectedApps.noApps")} />
      ) : !isFetching && data?.consents.length === 0 && debouncedQuery ? (
        <EmptyState icon={<GlobeRegular />} title={t("teams.noResultsMatch")} />
      ) : data && data.consents.length > 0 ? (
        <>
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 12,
              flexWrap: "wrap",
            }}
          >
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("connectedApps.searchConsentsPlaceholder")}
              contentBefore={<SearchRegular />}
              contentAfter={
                query ? (
                  <Button
                    appearance="transparent"
                    size="small"
                    icon={<DismissRegular />}
                    aria-label={t("common.clear")}
                    onClick={() => setQuery("")}
                  />
                ) : undefined
              }
              style={{ minWidth: 220, flex: "1 1 220px" }}
            />
          </div>
          <div className={styles.list}>
            {consents.map((consent) => (
              <ConsentCard
                key={consent.client_id}
                consent={consent}
                onRevokeConsent={handleRevokeConsent}
                onRevokeToken={handleRevokeToken}
                revokingConsent={revokingConsent}
                revokingToken={revokingToken}
              />
            ))}
          </div>
          <Pagination
            page={page}
            pageCount={Math.max(1, Math.ceil((data.total || 0) / 20))}
            total={data.total}
            onChange={setPage}
            disabled={isFetching}
          />
        </>
      ) : null}
    </div>
  );
}
