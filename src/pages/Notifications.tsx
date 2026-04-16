// Email and Telegram notification preference management

import {
  Button,
  MessageBar,
  MessageBarBody,
  Spinner,
  Switch,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { AlertRegular } from "@fluentui/react-icons";
import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { SkeletonToggleRows } from "../components/Skeletons";

type NotificationLevel = "brief" | "full";
type PrefsMap = Record<string, NotificationLevel>;

// ─── Event catalogue ─────────────────────────────────────────────────────────

interface EventEntry {
  value: string;
  labelKey: string;
  descKey: string;
}

interface EventGroup {
  groupKey: string;
  events: EventEntry[];
}

const EVENT_GROUPS: EventGroup[] = [
  {
    groupKey: "notifications.groupApps",
    events: [
      {
        value: "app.created",
        labelKey: "notifications.appCreatedLabel",
        descKey: "notifications.appCreatedDesc",
      },
      {
        value: "app.updated",
        labelKey: "notifications.appUpdatedLabel",
        descKey: "notifications.appUpdatedDesc",
      },
      {
        value: "app.deleted",
        labelKey: "notifications.appDeletedLabel",
        descKey: "notifications.appDeletedDesc",
      },
    ],
  },
  {
    groupKey: "notifications.groupDomains",
    events: [
      {
        value: "domain.added",
        labelKey: "notifications.domainAddedLabel",
        descKey: "notifications.domainAddedDesc",
      },
      {
        value: "domain.verified",
        labelKey: "notifications.domainVerifiedLabel",
        descKey: "notifications.domainVerifiedDesc",
      },
      {
        value: "domain.deleted",
        labelKey: "notifications.domainDeletedLabel",
        descKey: "notifications.domainDeletedDesc",
      },
    ],
  },
  {
    groupKey: "notifications.groupConnections",
    events: [
      {
        value: "connection.added",
        labelKey: "notifications.connectionAddedLabel",
        descKey: "notifications.connectionAddedDesc",
      },
      {
        value: "connection.removed",
        labelKey: "notifications.connectionRemovedLabel",
        descKey: "notifications.connectionRemovedDesc",
      },
      {
        value: "connection.login",
        labelKey: "notifications.connectionLoginLabel",
        descKey: "notifications.connectionLoginDesc",
      },
    ],
  },
  {
    groupKey: "notifications.groupAccount",
    events: [
      {
        value: "profile.updated",
        labelKey: "notifications.profileUpdatedLabel",
        descKey: "notifications.profileUpdatedDesc",
      },
    ],
  },
  {
    groupKey: "notifications.groupSecurity",
    events: [
      {
        value: "security.passkey_added",
        labelKey: "notifications.passkeyAddedLabel",
        descKey: "notifications.passkeyAddedDesc",
      },
      {
        value: "security.passkey_removed",
        labelKey: "notifications.passkeyRemovedLabel",
        descKey: "notifications.passkeyRemovedDesc",
      },
      {
        value: "security.totp_enabled",
        labelKey: "notifications.totpEnabledLabel",
        descKey: "notifications.totpEnabledDesc",
      },
      {
        value: "security.totp_disabled",
        labelKey: "notifications.totpDisabledLabel",
        descKey: "notifications.totpDisabledDesc",
      },
    ],
  },
  {
    groupKey: "notifications.groupTokens",
    events: [
      {
        value: "token.created",
        labelKey: "notifications.tokenCreatedLabel",
        descKey: "notifications.tokenCreatedDesc",
      },
      {
        value: "token.revoked",
        labelKey: "notifications.tokenRevokedLabel",
        descKey: "notifications.tokenRevokedDesc",
      },
    ],
  },
  {
    groupKey: "notifications.groupTeams",
    events: [
      {
        value: "team.member_added",
        labelKey: "notifications.teamMemberAddedLabel",
        descKey: "notifications.teamMemberAddedDesc",
      },
      {
        value: "team.member_removed",
        labelKey: "notifications.teamMemberRemovedLabel",
        descKey: "notifications.teamMemberRemovedDesc",
      },
    ],
  },
  {
    groupKey: "notifications.groupOAuth",
    events: [
      {
        value: "oauth.consent_granted",
        labelKey: "notifications.consentGrantedLabel",
        descKey: "notifications.consentGrantedDesc",
      },
      {
        value: "oauth.consent_revoked",
        labelKey: "notifications.consentRevokedLabel",
        descKey: "notifications.consentRevokedDesc",
      },
    ],
  },
];

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  root: {
    maxWidth: "640px",
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  icon: {
    fontSize: "24px",
    color: tokens.colorBrandForeground1,
  },
  group: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  groupLabel: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    paddingBottom: tokens.spacingVerticalXS,
  },
  eventRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    gap: tokens.spacingHorizontalL,
    background: tokens.colorNeutralBackground1,
  },
  eventText: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    flex: 1,
  },
  channelRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    flexShrink: 0,
  },
  tgToggle: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
  },
  levelPicker: {
    display: "flex",
    flexShrink: 0,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    overflow: "hidden",
  },
  levelBtn: {
    borderRadius: "0",
    border: "none",
    borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
    minWidth: "52px",
    ":last-child": { borderRight: "none" },
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    paddingTop: tokens.spacingVerticalXS,
  },
});

// ─── Level picker ─────────────────────────────────────────────────────────────

function LevelPicker({
  value,
  onChange,
}: {
  value: NotificationLevel | null;
  onChange: (v: NotificationLevel | null) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();

  const levels: Array<{ v: NotificationLevel | null; key: string }> = [
    { v: null, key: "notifications.levelOff" },
    { v: "brief", key: "notifications.levelBrief" },
    { v: "full", key: "notifications.levelFull" },
  ];

  return (
    <div className={styles.levelPicker}>
      {levels.map(({ v, key }) => (
        <Button
          key={key}
          className={styles.levelBtn}
          size="small"
          appearance={value === v ? "primary" : "subtle"}
          onClick={() => onChange(v)}
        >
          {t(key)}
        </Button>
      ))}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Notifications() {
  const { t } = useTranslation();
  const styles = useStyles();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["notification-prefs"],
    queryFn: () => api.getNotificationPrefs(),
  });

  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });

  const { data: connectionsData } = useQuery({
    queryKey: ["connections"],
    queryFn: api.listConnections,
  });

  // Whether Telegram notifications are available: admin configured a bot AND user has a linked Telegram account
  const hasTgBot = !!(site as { tg_notify_source_slug?: string } | undefined)
    ?.tg_notify_source_slug;
  const hasTgAccount = !!(connectionsData?.connections ?? []).some(
    (c) => c.provider === "telegram",
  );
  const tgAvailable = hasTgBot && hasTgAccount;

  const [prefs, setPrefs] = useState<PrefsMap>({});
  const [tgPrefs, setTgPrefs] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setPrefs(data.events as PrefsMap);
      setTgPrefs(data.tg_events ?? []);
      setDirty(false);
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: ({
      events,
      tg_events,
    }: {
      events: PrefsMap;
      tg_events: string[];
    }) => api.updateNotificationPrefs(events, tg_events),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-prefs"] });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  function setLevel(event: string, level: NotificationLevel | null) {
    setPrefs((prev) => {
      const next = { ...prev };
      if (level === null) {
        delete next[event];
      } else {
        next[event] = level;
      }
      return next;
    });
    setDirty(true);
    setSaved(false);
  }

  function toggleTg(event: string, on: boolean) {
    setTgPrefs((prev) =>
      on
        ? [...prev.filter((e) => e !== event), event]
        : prev.filter((e) => e !== event),
    );
    setDirty(true);
    setSaved(false);
  }

  function save() {
    mutation.mutate({ events: prefs, tg_events: tgPrefs });
  }

  if (isLoading) return <SkeletonToggleRows rows={8} />;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <AlertRegular className={styles.icon} />
        <div>
          <Text as="h1" size={500} weight="semibold" block>
            {t("notifications.title")}
          </Text>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("notifications.subtitle")}
          </Text>
        </div>
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          {t("notifications.levelLegend")}
        </Text>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {(["off", "brief", "full"] as const).map((l) => (
            <div
              key={l}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                borderRadius: 4,
                border: `1px solid ${tokens.colorNeutralStroke2}`,
                background: tokens.colorNeutralBackground2,
              }}
            >
              <Text size={200} weight="semibold">
                {t(
                  `notifications.level${l.charAt(0).toUpperCase() + l.slice(1)}`,
                )}
              </Text>
              <Text
                size={100}
                style={{ color: tokens.colorNeutralForeground3 }}
              >
                —{" "}
                {t(
                  `notifications.level${l.charAt(0).toUpperCase() + l.slice(1)}Hint`,
                )}
              </Text>
            </div>
          ))}
        </div>
      </div>

      {data && (data as { available?: unknown[] }).available?.length === 0 && (
        <MessageBar intent="warning">
          <MessageBarBody>{t("notifications.noEmail")}</MessageBarBody>
        </MessageBar>
      )}

      {hasTgBot && !hasTgAccount && (
        <MessageBar intent="info">
          <MessageBarBody>{t("notifications.tgNoAccount")}</MessageBarBody>
        </MessageBar>
      )}

      {saved && (
        <MessageBar intent="success">
          <MessageBarBody>{t("notifications.saved")}</MessageBarBody>
        </MessageBar>
      )}

      {mutation.isError && (
        <MessageBar intent="error">
          <MessageBarBody>{t("common.saveFailed")}</MessageBarBody>
        </MessageBar>
      )}

      {EVENT_GROUPS.map((group) => (
        <div key={group.groupKey} className={styles.group}>
          <Text className={styles.groupLabel}>{t(group.groupKey)}</Text>
          {group.events.map((entry) => (
            <div key={entry.value} className={styles.eventRow}>
              <div className={styles.eventText}>
                <Text weight="semibold" size={300}>
                  {t(entry.labelKey)}
                </Text>
                <Text
                  size={200}
                  style={{ color: tokens.colorNeutralForeground3 }}
                >
                  {t(entry.descKey)}
                </Text>
              </div>
              <div className={styles.channelRow}>
                <LevelPicker
                  value={prefs[entry.value] ?? null}
                  onChange={(v) => setLevel(entry.value, v)}
                />
                {tgAvailable && (
                  <Tooltip
                    content={t("notifications.tgToggleTooltip")}
                    relationship="label"
                  >
                    <div className={styles.tgToggle}>
                      <Text
                        size={100}
                        style={{ color: tokens.colorNeutralForeground3 }}
                      >
                        TG
                      </Text>
                      <Switch
                        checked={tgPrefs.includes(entry.value)}
                        onChange={(_, d) => toggleTg(entry.value, d.checked)}
                      />
                    </div>
                  </Tooltip>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}

      <div className={styles.actions}>
        <Button
          appearance="primary"
          disabled={!dirty || mutation.isPending}
          onClick={save}
        >
          {mutation.isPending ? (
            <Spinner size="tiny" />
          ) : (
            t("common.saveChanges")
          )}
        </Button>
      </div>
    </div>
  );
}
