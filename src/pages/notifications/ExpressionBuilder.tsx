// The visual expression builder: OR-ed groups of AND-ed conditions, each a
// field, an operator and a value, laid out like Cloudflare's rule builder.

import {
  Button,
  Dropdown,
  Input,
  Option,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { DeleteRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import {
  RULE_FIELD_NAMES,
  fieldType,
  type RuleField,
} from "../../../shared/ruleExpression";
import { Select } from "../../components/Select";
import {
  BUILDER_OPS,
  isSetOp,
  newCondition,
  type BuilderOp,
  type Condition,
  type Groups,
} from "./ruleBuilder";
import {
  FIELD_LABEL_KEYS,
  OP_LABEL_KEYS,
  valueChoices,
  valuePlaceholder,
} from "./ruleFields";
import { NARROW } from "./styles";

// The header and each row are separate grids, so they share fixed column
// widths; the last one fits the compact And / Or buttons and Remove.
const COLUMNS = "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.4fr) 128px";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  head: {
    display: "grid",
    gridTemplateColumns: COLUMNS,
    gap: "8px",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    [NARROW]: { display: "none" },
  },
  row: {
    display: "grid",
    gridTemplateColumns: COLUMNS,
    gap: "8px",
    alignItems: "start",
    [NARROW]: {
      gridTemplateColumns: "minmax(0, 1fr)",
      padding: "10px 0",
      borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
  },
  // Same height as the inputs, so the buttons line up with them.
  actions: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    minHeight: "32px",
  },
  // "And" between the conditions of a group; "Or" between groups.
  joiner: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  orJoiner: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    margin: "4px 0",
    "::after": {
      content: '""',
      flex: 1,
      borderTop: `1px dashed ${tokens.colorNeutralStroke1}`,
    },
  },
  invalid: {
    borderBottomColor: tokens.colorPaletteRedBorder2,
  },
  joinButton: {
    minWidth: "48px",
    paddingLeft: "6px",
    paddingRight: "6px",
  },
  multi: {
    minWidth: 0,
    width: "100%",
  },
});

function ValueInput({
  condition,
  invalid,
  onChange,
}: {
  condition: Condition;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const { field, op, value } = condition;
  const choices = valueChoices(field, op);
  const label = t("notifications.rule.colValue");
  const text = (c: { labelKey?: string; text?: string; value: string }) =>
    c.labelKey ? t(c.labelKey) : (c.text ?? c.value);

  if (choices && isSetOp(op)) {
    const selected = value ? value.split(",").map((s) => s.trim()) : [];
    return (
      <Dropdown
        multiselect
        aria-label={label}
        className={mergeClasses(styles.multi, invalid && styles.invalid)}
        placeholder={t("notifications.rule.choose")}
        value={selected
          .map((v) => {
            const c = choices.find((x) => x.value === v);
            return c ? text(c) : v;
          })
          .join(", ")}
        selectedOptions={selected}
        onOptionSelect={(_, d) => onChange(d.selectedOptions.join(", "))}
      >
        {choices.map((c) => (
          <Option key={c.value} value={c.value} text={text(c)}>
            {text(c)}
          </Option>
        ))}
      </Dropdown>
    );
  }
  if (choices) {
    return (
      <Select
        aria-label={label}
        className={invalid ? styles.invalid : undefined}
        value={value}
        onChange={(_, d) => onChange(d.value)}
      >
        <option value="" disabled>
          {t("notifications.rule.choose")}
        </option>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {text(c)}
          </option>
        ))}
      </Select>
    );
  }
  return (
    <Input
      aria-label={label}
      className={invalid ? styles.invalid : undefined}
      value={value}
      placeholder={valuePlaceholder(field, op)}
      onChange={(_, d) => onChange(d.value)}
    />
  );
}

export function ExpressionBuilder({
  groups,
  invalid,
  onChange,
}: {
  groups: Groups;
  /** Keys of conditions whose value can't be used. */
  invalid: Set<string>;
  onChange: (groups: Groups) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();

  const update = (gi: number, ci: number, patch: Partial<Condition>) =>
    onChange(
      groups.map((g, i) =>
        i === gi ? g.map((c, j) => (j === ci ? { ...c, ...patch } : c)) : g,
      ),
    );

  const setField = (gi: number, ci: number, field: RuleField) => {
    const prev = groups[gi][ci];
    const ops = BUILDER_OPS[fieldType(field)];
    const op = ops.includes(prev.op) ? prev.op : ops[0];
    update(gi, ci, { field, op, value: "" });
  };

  const setOp = (gi: number, ci: number, op: BuilderOp) => {
    const prev = groups[gi][ci];
    // Keep the value unless the kind of input changes.
    const sameKind =
      isSetOp(prev.op) === isSetOp(op) &&
      !!valueChoices(prev.field, prev.op) === !!valueChoices(prev.field, op);
    update(gi, ci, { op, value: sameKind ? prev.value : "" });
  };

  const addAnd = (gi: number, ci: number) =>
    onChange(
      groups.map((g, i) =>
        i === gi
          ? [
              ...g.slice(0, ci + 1),
              newCondition(g[ci].field),
              ...g.slice(ci + 1),
            ]
          : g,
      ),
    );

  const addOr = (gi: number) =>
    onChange([
      ...groups.slice(0, gi + 1),
      [newCondition()],
      ...groups.slice(gi + 1),
    ]);

  const remove = (gi: number, ci: number) =>
    onChange(
      groups
        .map((g, i) => (i === gi ? g.filter((_, j) => j !== ci) : g))
        .filter((g) => g.length > 0),
    );

  return (
    <div className={styles.root}>
      <div className={styles.head} aria-hidden>
        <span>{t("notifications.rule.colField")}</span>
        <span>{t("notifications.rule.colOperator")}</span>
        <span>{t("notifications.rule.colValue")}</span>
        <span />
      </div>
      {groups.map((group, gi) => (
        <div key={group[0]?.key ?? gi} className={styles.root}>
          {gi > 0 && (
            <div className={mergeClasses(styles.joiner, styles.orJoiner)}>
              {t("notifications.rule.or")}
            </div>
          )}
          {group.map((c, ci) => (
            <div key={c.key} className={styles.root}>
              {ci > 0 && (
                <span className={styles.joiner}>
                  {t("notifications.rule.and")}
                </span>
              )}
              <div className={styles.row}>
                <Select
                  aria-label={t("notifications.rule.colField")}
                  value={c.field}
                  onChange={(_, d) => setField(gi, ci, d.value as RuleField)}
                >
                  {RULE_FIELD_NAMES.map((f) => (
                    <option key={f} value={f}>
                      {t(FIELD_LABEL_KEYS[f])}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label={t("notifications.rule.colOperator")}
                  value={c.op}
                  onChange={(_, d) => setOp(gi, ci, d.value as BuilderOp)}
                >
                  {BUILDER_OPS[fieldType(c.field)].map((op) => (
                    <option key={op} value={op}>
                      {t(OP_LABEL_KEYS[op])}
                    </option>
                  ))}
                </Select>
                <ValueInput
                  condition={c}
                  invalid={invalid.has(c.key)}
                  onChange={(value) => update(gi, ci, { value })}
                />
                <div className={styles.actions}>
                  <Button
                    size="small"
                    className={styles.joinButton}
                    onClick={() => addAnd(gi, ci)}
                  >
                    {t("notifications.rule.and")}
                  </Button>
                  <Button
                    size="small"
                    className={styles.joinButton}
                    onClick={() => addOr(gi)}
                  >
                    {t("notifications.rule.or")}
                  </Button>
                  <Tooltip
                    content={t("notifications.rule.removeCondition")}
                    relationship="label"
                  >
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<DeleteRegular />}
                      onClick={() => remove(gi, ci)}
                    />
                  </Tooltip>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
