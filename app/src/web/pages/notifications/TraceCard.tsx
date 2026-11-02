// Trace: run the ruleset against a made-up event and see what each rule did
// and where the notification would go. Uses the same evaluator as dispatch
// (src/shared/notificationRules.ts), so what it shows is what would happen.

import {
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  traceRuleset,
  type RuleTraceStep,
} from "../../../shared/notificationRules";
import type { NotificationRulesetRule } from "../../lib/api";
import { SettingsBody, SettingsCard } from "../../components/Settings";
import { DEST_ICONS, destKey, type Destination } from "./destinations";
import { newSample, sampleContext } from "./sample";
import { SampleEventFields } from "./SampleEvent";
import { useNotificationStyles } from "./styles";

const useStyles = makeStyles({
  steps: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    padding: 0,
    listStyle: "none",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  step: {
    display: "grid",
    gridTemplateColumns: "28px minmax(0, 1fr) auto",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    fontSize: tokens.fontSizeBase300,
    ":not(:first-child)": {
      borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
  },
  index: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    fontVariantNumeric: "tabular-nums",
  },
  result: { fontSize: tokens.fontSizeBase200 },
  matched: {
    color: tokens.colorStatusSuccessForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
  other: { color: tokens.colorNeutralForeground3 },
  invalid: { color: tokens.colorPaletteRedForeground1 },
  deliveries: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  delivery: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    "& svg": { color: tokens.colorNeutralForeground3, flexShrink: 0 },
  },
});

export function TraceCard({
  rules,
  destinations,
}: {
  rules: NotificationRulesetRule[];
  destinations: Destination[];
}) {
  const styles = useStyles();
  const shared = useNotificationStyles();
  const { t } = useTranslation();
  const [sample, setSample] = useState(newSample);
  const { delivery, steps } = traceRuleset(rules, sampleContext(sample));

  const resultText = (s: RuleTraceStep) =>
    s.result === "matched"
      ? s.stopped
        ? t("notifications.rule.traceMatchedStop")
        : t("notifications.rule.traceMatched")
      : t(`notifications.rule.trace_${s.result}`);

  const sent = [
    ...delivery.emails.map((d) => ({
      key: `email:${d.email_id}`,
      level: d.level,
    })),
    ...delivery.tgs.map((d) => ({
      key: `tg:${d.connection_id}`,
      level: d.level,
    })),
    ...delivery.discords.map((d) => ({
      key: `discord:${d.connection_id}`,
      level: d.level,
    })),
  ];

  return (
    <SettingsCard
      id="trace"
      title={t("notifications.rule.traceTitle")}
      description={t("notifications.rule.traceDesc")}
    >
      <SettingsBody>
        <SampleEventFields sample={sample} onChange={setSample} />
        {rules.length > 0 && (
          <ol className={styles.steps}>
            {steps.map((s, i) => (
              <li key={s.id} className={styles.step}>
                <span className={styles.index}>{i + 1}</span>
                <span className={shared.truncate}>
                  {rules[i].name ||
                    t("notifications.rule.untitled", { n: i + 1 })}
                </span>
                <span
                  className={mergeClasses(
                    styles.result,
                    s.result === "matched"
                      ? styles.matched
                      : s.result === "invalid"
                        ? styles.invalid
                        : styles.other,
                  )}
                >
                  {resultText(s)}
                </span>
              </li>
            ))}
          </ol>
        )}
        <div className={styles.deliveries} role="status">
          <Text weight="semibold">{t("notifications.rule.traceResult")}</Text>
          {sent.length === 0 ? (
            <Text className={shared.muted}>
              {t("notifications.rule.traceNothing")}
            </Text>
          ) : (
            sent.map(({ key, level }) => {
              const dest = destinations.find((d) => destKey(d) === key);
              const Icon = DEST_ICONS[key.split(":")[0] as Destination["kind"]];
              return (
                <span key={key} className={styles.delivery}>
                  <Icon aria-hidden />
                  <span className={shared.truncate}>
                    {dest?.label ?? t("notifications.rule.removedDestination")}
                  </span>
                  <span className={shared.muted}>
                    {t(
                      level === "full"
                        ? "notifications.levelFull"
                        : "notifications.levelBrief",
                    )}
                  </span>
                </span>
              );
            })
          )}
        </div>
      </SettingsBody>
    </SettingsCard>
  );
}
