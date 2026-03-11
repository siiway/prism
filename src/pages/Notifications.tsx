// Email notification preference management

import {
  Button,
  MessageBar,
  MessageBarBody,
  Spinner,
  Switch,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { AlertRegular } from "@fluentui/react-icons";
import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";

// ─── Event catalogue (rich descriptions, not raw IDs) ────────────────────────

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
    gap: tokens.spacingHorizontalM,
    background: tokens.colorNeutralBackground1,
  },
  eventText: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    flex: 1,
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    paddingTop: tokens.spacingVerticalXS,
  },
});

// ─── Component ────────────────────────────────────────────────────────────────

export function Notifications() {
  const { t } = useTranslation();
  const styles = useStyles();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["notification-prefs"],
    queryFn: () => api.getNotificationPrefs(),
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setSelected(new Set(data.events as string[]));
      setDirty(false);
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: (events: string[]) => api.updateNotificationPrefs(events),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-prefs"] });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  function toggle(value: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
    setDirty(true);
    setSaved(false);
  }

  function save() {
    mutation.mutate([...selected]);
  }

  if (isLoading) return <Spinner size="small" />;

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

      {data && (data as { available?: unknown[] }).available?.length === 0 && (
        <MessageBar intent="warning">
          <MessageBarBody>{t("notifications.noEmail")}</MessageBarBody>
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
              <Switch
                checked={selected.has(entry.value)}
                onChange={() => toggle(entry.value)}
              />
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
