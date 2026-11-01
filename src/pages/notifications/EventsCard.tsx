// The Events card: per-event levels for each destination, edited as a draft
// and saved together from a sticky footer. While a ruleset is active it
// replaces these settings at dispatch time, which the card says.

import {
  Button,
  MessageBar,
  MessageBarBody,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { CodeRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { NotificationRules } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { SettingsCard } from "../../components/Settings";
import { DestinationList } from "./DestinationList";
import { EventLevels } from "./EventLevels";
import { JsonDialog } from "./JsonDialog";
import { SaveBar } from "./SaveBar";
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

      <SaveBar
        dirty={dirty}
        saved={saved}
        pending={mutation.isPending}
        savedLabel={t("notifications.saved")}
        onDiscard={() => {
          setRules(savedRules);
          setDirty(false);
        }}
        onSave={() => mutation.mutate(rules)}
      />

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
