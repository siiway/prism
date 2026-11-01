// Notification preferences. Two cards:
//
// - Events (notifications/EventsCard): destination-first. A list of
//   destinations (each verified email, linked Telegram and Discord account);
//   picking one shows every event with a single Off / Brief / Full picker.
// - Rulesets (notifications/RulesetsCard): conditional rules ("if the event
//   matches X, send to Y at level Z"). While one is active it replaces the
//   per-event settings at dispatch time.

import {
  Button,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  makeStyles,
} from "@fluentui/react-components";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import type { NotificationRules } from "../lib/api";
import { useApi } from "../lib/api-context";
import { PageHeader } from "../components/PageHeader";
import { SkeletonSettingsPage } from "../components/Skeletons";
import { listDestinations } from "./notifications/destinations";
import { EventsCard } from "./notifications/EventsCard";
import { RulesetsCard } from "./notifications/RulesetsCard";

const useStyles = makeStyles({
  root: {
    maxWidth: "960px",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
});

// Stable, so the Events card's draft isn't reset on every render.
const NO_RULES: NotificationRules = {};

export function Notifications() {
  const api = useApi();
  const { t } = useTranslation();
  const styles = useStyles();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["notification-prefs"],
    queryFn: () => api.getNotificationPrefs(),
  });

  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });

  const hasTgBot = !!site?.tg_notify_source_slug;
  const hasDiscordBot = !!site?.discord_notify_source_slug;
  const destinations = listDestinations(data, hasDiscordBot);

  const header = (
    <PageHeader
      title={t("notifications.title")}
      subtitle={t("notifications.subtitle")}
      style={{ marginBottom: 4 }}
    />
  );

  if (isLoading)
    return (
      <div className={styles.root}>
        {header}
        <SkeletonSettingsPage cards={[8]} />
      </div>
    );

  const linkAccount = (
    <MessageBarActions>
      <Button size="small" onClick={() => navigate("/connections")}>
        {t("notifications.linkAccount")}
      </Button>
    </MessageBarActions>
  );

  return (
    <div className={styles.root}>
      {header}

      {!data?.emails.length && (
        <MessageBar intent="warning">
          <MessageBarBody>{t("notifications.noEmail")}</MessageBarBody>
        </MessageBar>
      )}
      {hasTgBot && !data?.tg_connections.length && (
        <MessageBar intent="info">
          <MessageBarBody>{t("notifications.tgNoAccount")}</MessageBarBody>
          {linkAccount}
        </MessageBar>
      )}
      {hasDiscordBot && !data?.discord_connections.length && (
        <MessageBar intent="info">
          <MessageBarBody>{t("notifications.discordNoAccount")}</MessageBarBody>
          {linkAccount}
        </MessageBar>
      )}

      <EventsCard
        savedRules={data?.rules ?? NO_RULES}
        destinations={destinations}
      />
      <RulesetsCard destinations={destinations} />
    </div>
  );
}
