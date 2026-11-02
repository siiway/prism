// Notification preferences. Two cards:
//
// - Events (notifications/EventsCard): destination-first. A list of
//   destinations (each verified email, linked Telegram and Discord account);
//   picking one shows every event with a single Off / Brief / Full picker.
// - Rulesets (notifications/RulesetsCard): the user's rulesets, each on its
//   own page (/notifications/rulesets/:id). While one is active it replaces
//   the per-event settings at dispatch time.

import {
  Button,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  makeStyles,
} from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import type { NotificationRules } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { SkeletonSettingsPage } from "../components/Skeletons";
import { EventsCard } from "./notifications/EventsCard";
import { RulesetsCard } from "./notifications/RulesetsCard";
import { useDestinations } from "./notifications/useDestinations";

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
  const { t } = useTranslation();
  const styles = useStyles();
  const navigate = useNavigate();
  const { prefs, isLoading, hasTgBot, hasDiscordBot, destinations } =
    useDestinations();

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

      {!prefs?.emails.length && (
        <MessageBar intent="warning">
          <MessageBarBody>{t("notifications.noEmail")}</MessageBarBody>
        </MessageBar>
      )}
      {hasTgBot && !prefs?.tg_connections.length && (
        <MessageBar intent="info">
          <MessageBarBody>{t("notifications.tgNoAccount")}</MessageBarBody>
          {linkAccount}
        </MessageBar>
      )}
      {hasDiscordBot && !prefs?.discord_connections.length && (
        <MessageBar intent="info">
          <MessageBarBody>{t("notifications.discordNoAccount")}</MessageBarBody>
          {linkAccount}
        </MessageBar>
      )}

      <EventsCard
        savedRules={prefs?.rules ?? NO_RULES}
        destinations={destinations}
      />
      <RulesetsCard />
    </div>
  );
}
