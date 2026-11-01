// The Rulesets card: the user's rulesets, each opening its own page
// (RulesetDetail), and a link to make a new one (RulesetNew). A ruleset is a
// list of conditional rules ("if the event matches X, send to Y at level
// Z"); while one is active the server evaluates it INSTEAD of the per-event
// settings.

import { Button } from "@fluentui/react-components";
import { AddRegular } from "@fluentui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useApi } from "../../lib/api-context";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsLinkRow,
} from "../../components/Settings";

export function RulesetsCard() {
  const api = useApi();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const { data } = useQuery({
    queryKey: ["notification-rulesets"],
    queryFn: () => api.listNotificationRulesets(),
  });
  const rulesets = data?.rulesets ?? [];

  return (
    <SettingsCard
      id="rulesets"
      title={t("notifications.rulesetsTitle")}
      description={t("notifications.rulesetsDesc")}
      action={
        <Button
          size="small"
          icon={<AddRegular />}
          onClick={() => navigate("/notifications/rulesets/new")}
        >
          {t("notifications.rulesetsNew")}
        </Button>
      }
    >
      {rulesets.length === 0 ? (
        <SettingsEmpty>{t("notifications.rulesetsEmpty")}</SettingsEmpty>
      ) : (
        rulesets.map((rs) => {
          const count = t("notifications.rulesetsRuleCount", {
            count: rs.rules.length,
          });
          return (
            <SettingsLinkRow
              key={rs.id}
              to={`/notifications/rulesets/${rs.id}`}
              label={rs.name}
              description={
                rs.is_active
                  ? `${t("notifications.rulesetActive")} · ${count}`
                  : count
              }
            />
          );
        })
      )}
    </SettingsCard>
  );
}
