// "When events match…": every event, or a filter built with the expression
// builder or written as an expression. The preview shows the expression the
// builder makes; editing it as text switches modes, and the builder comes
// back whenever the text fits its shape.

import {
  Button,
  MessageBar,
  MessageBarBody,
  Radio,
  RadioGroup,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { AddRegular, CodeRegular, TableRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import {
  parseRuleExpression,
  printRuleExpression,
  type ExprError,
} from "../../../shared/ruleExpression";
import { SettingsCard } from "../../components/Settings";
import { ExpressionBuilder } from "./ExpressionBuilder";
import {
  exprToGroups,
  groupsToExpr,
  newCondition,
  type MatchState,
} from "./ruleBuilder";
import { useNotificationStyles } from "./styles";

const useStyles = makeStyles({
  body: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    padding: "16px var(--card-pad) 20px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  previewHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  },
  // Kumo's CodeBlock: hairline border, base surface, 6px corners.
  code: {
    margin: 0,
    padding: "10px",
    borderRadius: "6px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground2,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    lineHeight: "20px",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    minHeight: "20px",
  },
  addGroup: {
    alignSelf: "flex-start",
  },
  error: {
    color: tokens.colorPaletteRedForeground1,
  },
});

export function MatchCard({
  state,
  onChange,
  showErrors,
}: {
  state: MatchState;
  onChange: (next: MatchState) => void;
  /** Point out problems; set once the user tries to save. */
  showErrors: boolean;
}) {
  const styles = useStyles();
  const shared = useNotificationStyles();
  const { t } = useTranslation();

  const built = groupsToExpr(state.groups);
  const preview = printRuleExpression(built.expr);
  const parsedText = parseRuleExpression(state.text);
  const textGroups = parsedText.error
    ? null
    : parsedText.expr
      ? exprToGroups(parsedText.expr)
      : [];

  const exprError = (e: ExprError) =>
    t(`notifications.rule.expr_${e.code}`, {
      token: e.token ?? "",
      at: e.at + 1,
    });

  return (
    <SettingsCard
      id="match"
      title={t("notifications.rule.matchTitle")}
      description={t("notifications.rule.matchDesc")}
    >
      <div className={styles.body}>
        <RadioGroup
          layout="horizontal"
          value={state.mode === "all" ? "all" : "custom"}
          onChange={(_, d) =>
            onChange({
              ...state,
              mode: d.value === "all" ? "all" : "builder",
              groups: state.groups.length ? state.groups : [[newCondition()]],
            })
          }
        >
          <Radio value="all" label={t("notifications.rule.matchAll")} />
          <Radio value="custom" label={t("notifications.rule.matchCustom")} />
        </RadioGroup>

        {state.mode === "builder" && (
          <>
            <ExpressionBuilder
              groups={state.groups}
              invalid={showErrors ? built.invalid : new Set()}
              onChange={(groups) => onChange({ ...state, groups })}
            />
            {state.groups.length === 0 && (
              <Button
                size="small"
                icon={<AddRegular />}
                className={styles.addGroup}
                onClick={() =>
                  onChange({ ...state, groups: [[newCondition()]] })
                }
              >
                {t("notifications.rule.addCondition")}
              </Button>
            )}
            {showErrors && built.invalid.size > 0 && (
              <MessageBar intent="error">
                <MessageBarBody>
                  {t("notifications.rule.invalidRows")}
                </MessageBarBody>
              </MessageBar>
            )}
            <div className={styles.previewHead}>
              <Text weight="semibold">{t("notifications.rule.preview")}</Text>
              <Button
                size="small"
                appearance="subtle"
                icon={<CodeRegular />}
                onClick={() =>
                  onChange({ ...state, mode: "text", text: preview })
                }
              >
                {t("notifications.rule.editExpression")}
              </Button>
            </div>
            <pre className={styles.code}>
              {preview || (
                <span className={shared.muted}>
                  {t("notifications.rule.previewEmpty")}
                </span>
              )}
            </pre>
          </>
        )}

        {state.mode === "text" && (
          <>
            <div className={styles.previewHead}>
              <Text weight="semibold">
                {t("notifications.rule.expression")}
              </Text>
              <Button
                size="small"
                appearance="subtle"
                icon={<TableRegular />}
                disabled={!textGroups}
                title={
                  textGroups
                    ? undefined
                    : t("notifications.rule.builderUnavailable")
                }
                onClick={() =>
                  textGroups &&
                  onChange({
                    ...state,
                    mode: "builder",
                    groups: textGroups.length ? textGroups : [[newCondition()]],
                  })
                }
              >
                {t("notifications.rule.useBuilder")}
              </Button>
            </div>
            <Textarea
              aria-label={t("notifications.rule.expression")}
              value={state.text}
              onChange={(_, d) => onChange({ ...state, text: d.value })}
              rows={6}
              resize="vertical"
              textarea={{ className: shared.monoInput, spellCheck: false }}
            />
            {parsedText.error ? (
              <Text size={200} className={styles.error} role="alert">
                {exprError(parsedText.error)}
              </Text>
            ) : (
              <Text size={200} className={shared.muted}>
                {textGroups
                  ? t("notifications.rule.expressionOk")
                  : t("notifications.rule.builderUnavailable")}
              </Text>
            )}
          </>
        )}
      </div>
    </SettingsCard>
  );
}
