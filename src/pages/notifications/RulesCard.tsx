// The ruleset page's rules, in the order they run: each row shows what the
// rule matches, what it does and whether it's on, and opens the rule's page.
// Enabling, moving and deleting from the row menu save at once.

import {
  Button,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { AddRegular, MoreHorizontalRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { NotificationRulesetRule } from "../../lib/api";
import { SettingsCard, SettingsEmpty } from "../../components/Settings";
import type { Destination } from "./destinations";
import { actionSummary, ruleExpressionText } from "./ruleEdit";
import { NARROW, useNotificationStyles } from "./styles";

const COLUMNS = "28px minmax(0, 1.5fr) minmax(0, 1fr) 80px 32px";

const useStyles = makeStyles({
  row: {
    display: "grid",
    gridTemplateColumns: COLUMNS,
    alignItems: "center",
    gap: "12px",
    minHeight: "56px",
    padding: "8px var(--card-pad)",
    boxSizing: "border-box",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    [NARROW]: { gridTemplateColumns: "24px minmax(0, 1fr) 32px" },
  },
  head: {
    minHeight: "36px",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    [NARROW]: { display: "none" },
  },
  index: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    fontVariantNumeric: "tabular-nums",
  },
  main: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
  },
  name: {
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
    textDecoration: "none",
    ":hover": { textDecoration: "underline" },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      borderRadius: "2px",
    },
  },
  expr: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  cell: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    [NARROW]: { display: "none" },
  },
  // Action and status under the name on phones, where their columns hide.
  narrowMeta: {
    display: "none",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    [NARROW]: { display: "block" },
  },
  off: { color: tokens.colorNeutralForeground3 },
  dim: { "& > :not(:last-child)": { opacity: 0.6 } },
});

export function RulesCard({
  rulesetId,
  rules,
  destinations,
  saveRules,
  confirmDelete,
  onError,
}: {
  rulesetId: string;
  rules: NotificationRulesetRule[];
  destinations: Destination[];
  saveRules: (rules: NotificationRulesetRule[]) => Promise<void>;
  confirmDelete: (name: string) => Promise<boolean>;
  onError: (err: unknown) => void;
}) {
  const styles = useStyles();
  const shared = useNotificationStyles();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const rulePath = (ruleId: string) =>
    `/notifications/rulesets/${rulesetId}/rules/${ruleId}`;
  const label = (r: NotificationRulesetRule, i: number) =>
    r.name || t("notifications.rule.untitled", { n: i + 1 });

  const apply = async (next: NotificationRulesetRule[]) => {
    if (busy) return;
    setBusy(true);
    try {
      await saveRules(next);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const move = (i: number, delta: number) => {
    const next = rules.slice();
    [next[i], next[i + delta]] = [next[i + delta], next[i]];
    void apply(next);
  };

  return (
    <SettingsCard
      id="rules"
      title={t("notifications.rulesetRulesTitle")}
      description={t("notifications.rulesetRulesDesc")}
      action={
        <Button
          size="small"
          icon={<AddRegular />}
          onClick={() =>
            navigate(`/notifications/rulesets/${rulesetId}/rules/new`)
          }
        >
          {t("notifications.rule.create")}
        </Button>
      }
    >
      {rules.length === 0 ? (
        <SettingsEmpty>{t("notifications.rulesetsRulesEmpty")}</SettingsEmpty>
      ) : (
        <>
          <div className={mergeClasses(styles.row, styles.head)} aria-hidden>
            <span>#</span>
            <span>{t("notifications.rule.colRule")}</span>
            <span>{t("notifications.rule.colAction")}</span>
            <span>{t("notifications.rule.status")}</span>
            <span />
          </div>
          {rules.map((rule, i) => {
            const on = rule.enabled !== false;
            const expr = ruleExpressionText(rule);
            const action = `${actionSummary(rule, destinations, t)}${
              rule.stop ? ` · ${t("notifications.rule.summaryStop")}` : ""
            }`;
            const status = on
              ? t("notifications.rule.enabled")
              : t("notifications.rule.disabled");
            return (
              <div
                key={rule.id}
                className={mergeClasses(styles.row, !on && styles.dim)}
              >
                <span className={styles.index}>{i + 1}</span>
                <div className={styles.main}>
                  <Link
                    to={rulePath(rule.id)}
                    className={mergeClasses(styles.name, shared.truncate)}
                  >
                    {label(rule, i)}
                  </Link>
                  <span
                    className={mergeClasses(styles.expr, shared.truncate)}
                    title={expr || undefined}
                  >
                    {expr || t("notifications.rule.matchAll")}
                  </span>
                  <span
                    className={mergeClasses(styles.narrowMeta, shared.truncate)}
                  >
                    {status} · {action}
                  </span>
                </div>
                <span
                  className={mergeClasses(styles.cell, shared.truncate)}
                  title={action}
                >
                  {action}
                </span>
                <span className={mergeClasses(styles.cell, !on && styles.off)}>
                  {status}
                </span>
                <Menu>
                  <MenuTrigger disableButtonEnhancement>
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<MoreHorizontalRegular />}
                      aria-label={label(rule, i)}
                      disabled={busy}
                    />
                  </MenuTrigger>
                  <MenuPopover>
                    <MenuList>
                      <MenuItem onClick={() => navigate(rulePath(rule.id))}>
                        {t("common.edit")}
                      </MenuItem>
                      <MenuItem
                        onClick={() =>
                          void apply(
                            rules.map((r) =>
                              r.id === rule.id ? { ...r, enabled: !on } : r,
                            ),
                          )
                        }
                      >
                        {on
                          ? t("notifications.rule.disable")
                          : t("notifications.rule.enable")}
                      </MenuItem>
                      <MenuItem disabled={i === 0} onClick={() => move(i, -1)}>
                        {t("notifications.rule.moveUp")}
                      </MenuItem>
                      <MenuItem
                        disabled={i === rules.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        {t("notifications.rule.moveDown")}
                      </MenuItem>
                      <MenuDivider />
                      <MenuItem
                        onClick={async () => {
                          if (await confirmDelete(label(rule, i)))
                            void apply(rules.filter((r) => r.id !== rule.id));
                        }}
                      >
                        {t("common.delete")}
                      </MenuItem>
                    </MenuList>
                  </MenuPopover>
                </Menu>
              </div>
            );
          })}
        </>
      )}
    </SettingsCard>
  );
}
