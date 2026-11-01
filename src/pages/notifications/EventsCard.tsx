// The Events card: per-event levels for each destination, edited as a draft
// and saved together from a sticky footer. While a ruleset is active it
// replaces these settings at dispatch time, which the card says.

import {
  Button,
  MessageBar,
  MessageBarBody,
  Spinner,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { CheckmarkRegular, CodeRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { NotificationRules } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { SettingsCard } from "../../components/Settings";
import { DestinationList } from "./DestinationList";
import { EventLevels } from "./EventLevels";
import { JsonDialog } from "./JsonDialog";
import { destKey, type Destination } from "./destinations";
import { WIDE, useNotificationStyles } from "./styles";

const useStyles = makeStyles({
  // Destination list | event pane; one column below WIDE.
  body: {
    display: "grid",
    gridTemplateColumns: "232px minmax(0, 1fr)",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    [WIDE]: { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  footer: {
    position: "sticky",
    bottom: 0,
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "8px",
    padding: "12px var(--card-pad)",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    borderBottomLeftRadius: tokens.borderRadiusXLarge,
    borderBottomRightRadius: tokens.borderRadiusXLarge,
    background: tokens.colorNeutralBackground1,
  },
  footerStatus: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginRight: "auto",
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground3,
  },
  footerStatusOk: {
    color: tokens.colorStatusSuccessForeground1,
  },
});

export function EventsCard({
  savedRules,
  destinations,
}: {
  /** The rules as last loaded from the server. */
  savedRules: NotificationRules;
  destinations: Destination[];
}) {
  const api = useApi();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const styles = useStyles();
  const shared = useNotificationStyles();

  const [rules, setRules] = useState<NotificationRules>(savedRules);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [selectedDest, setSelectedDest] = useState<string | null>(null);

  // Take the server's copy whenever it changes (after a save or refetch).
  // A render-time set rather than an effect, guarded by identity.
  const [syncedRules, setSyncedRules] = useState(savedRules);
  if (savedRules !== syncedRules) {
    setSyncedRules(savedRules);
    setRules(savedRules);
    setDirty(false);
  }

  // Shares its cache with the Rulesets card.
  const { data: rulesetsData } = useQuery({
    queryKey: ["notification-rulesets"],
    queryFn: () => api.listNotificationRulesets(),
  });
  const activeRuleset = rulesetsData?.rulesets.find((r) => r.is_active);

  const mutation = useMutation({
    mutationFn: (r: NotificationRules) => api.updateNotificationPrefs(r),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-prefs"] });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  function updateRules(next: NotificationRules) {
    setRules(next);
    setDirty(true);
    setSaved(false);
  }

  const current =
    destinations.find((d) => destKey(d) === selectedDest) ?? destinations[0];

  return (
    <SettingsCard
      id="events"
      title={t("notifications.eventsTitle")}
      description={t("notifications.eventsDesc")}
      action={
        <Button
          size="small"
          appearance="subtle"
          icon={<CodeRegular />}
          onClick={() => setJsonOpen(true)}
        >
          {t("notifications.jsonEdit")}
        </Button>
      }
    >
      {activeRuleset && (
        <div className={shared.cardNotice}>
          <MessageBar intent="info">
            <MessageBarBody>
              {t("notifications.rulesetActiveOverride", {
                name: activeRuleset.name,
              })}
            </MessageBarBody>
          </MessageBar>
        </div>
      )}
      {mutation.isError && (
        <div className={shared.cardNotice}>
          <MessageBar intent="error">
            <MessageBarBody>{t("common.saveFailed")}</MessageBarBody>
          </MessageBar>
        </div>
      )}

      {current ? (
        <div className={styles.body}>
          <DestinationList
            destinations={destinations}
            current={current}
            rules={rules}
            onSelect={(d) => setSelectedDest(destKey(d))}
          />
          <EventLevels
            dest={current}
            destinations={destinations}
            rules={rules}
            onChange={updateRules}
          />
        </div>
      ) : (
        <div className={shared.cardEmpty}>
          {t("notifications.noDestinations")}
        </div>
      )}

      {/* Only while there is something to save or just saved; idle, the
          card ends at its last row. */}
      {(dirty || saved || mutation.isPending) && (
        <div className={styles.footer}>
          <span
            className={mergeClasses(
              styles.footerStatus,
              saved && styles.footerStatusOk,
            )}
            role="status"
          >
            {saved ? (
              <>
                <CheckmarkRegular />
                {t("notifications.saved")}
              </>
            ) : dirty ? (
              t("notifications.unsaved")
            ) : null}
          </span>
          <Button
            disabled={!dirty || mutation.isPending}
            onClick={() => {
              setRules(savedRules);
              setDirty(false);
            }}
          >
            {t("common.discard")}
          </Button>
          <Button
            appearance="primary"
            disabled={!dirty || mutation.isPending}
            onClick={() => mutation.mutate(rules)}
          >
            {mutation.isPending ? (
              <Spinner size="tiny" />
            ) : (
              t("common.saveChanges")
            )}
          </Button>
        </div>
      )}

      <JsonDialog
        open={jsonOpen}
        rules={rules}
        onApply={(next) => {
          updateRules(next);
          setJsonOpen(false);
        }}
        onClose={() => setJsonOpen(false)}
      />
    </SettingsCard>
  );
}
