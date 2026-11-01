// Reusable editor for an app's redirect URIs.
//
// Each entry pairs a match type (equals / regex / wildcard) with a value.
// The list may be empty, in which case the app "learns" the first redirect
// URI it is used with and pins it. A regex value of `.*` matches any URI —
// the tip below the list calls out that security footgun explicitly.

import {
  Button,
  Dropdown,
  Field,
  Input,
  MessageBar,
  Option,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { AddRegular, DeleteRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import type { RedirectUri, RedirectUriMatchType } from "../lib/api";

const useStyles = makeStyles({
  row: {
    display: "flex",
    gap: "8px",
    alignItems: "flex-start",
  },
  typeCol: { width: "130px", flexShrink: 0 },
  // Fluent's Dropdown ships with a 250px min-width, which overflowed the
  // 130px column and slid under the URI input. Let it fill the column.
  typeDropdown: { minWidth: "0", width: "100%" },
  valueCol: { flex: 1, minWidth: 0 },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  empty: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

const MATCH_TYPES: RedirectUriMatchType[] = ["equals", "regex", "wildcard"];

interface Props {
  /** Omit inside a card that already names the list; the hints go too. */
  label?: string;
  value: RedirectUri[];
  onChange: (value: RedirectUri[]) => void;
}

export function RedirectUriEditor({ label, value, onChange }: Props) {
  const styles = useStyles();
  const { t } = useTranslation();

  const typeLabel = (type: RedirectUriMatchType) =>
    t(`apps.redirectMatch.${type}`);

  const update = (index: number, patch: Partial<RedirectUri>) => {
    onChange(value.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  };
  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };
  const add = () => {
    onChange([...value, { type: "equals", value: "" }]);
  };

  const hasWideRegex = value.some(
    (e) => e.type === "regex" && (e.value === ".*" || e.value === "^.*$"),
  );

  const list = (
    <div className={styles.list}>
      {value.length === 0 && label && (
        <Text className={styles.empty}>{t("apps.redirectUrisEmpty")}</Text>
      )}
      {value.map((entry, i) => (
        <div key={i} className={styles.row}>
          <div className={styles.typeCol}>
            <Dropdown
              className={styles.typeDropdown}
              value={typeLabel(entry.type)}
              selectedOptions={[entry.type]}
              onOptionSelect={(_, d) =>
                update(i, {
                  type: (d.optionValue as RedirectUriMatchType) ?? "equals",
                })
              }
            >
              {MATCH_TYPES.map((mt) => (
                <Option key={mt} value={mt}>
                  {typeLabel(mt)}
                </Option>
              ))}
            </Dropdown>
          </div>
          <div className={styles.valueCol}>
            <Input
              style={{ width: "100%" }}
              value={entry.value}
              placeholder={
                entry.type === "equals"
                  ? t("apps.redirectUrisPlaceholder")
                  : entry.type === "wildcard"
                    ? "https://example.com/*"
                    : "https://example\\.com/.*"
              }
              onChange={(e) => update(i, { value: e.target.value })}
            />
          </div>
          <Button
            icon={<DeleteRegular />}
            appearance="subtle"
            aria-label={t("common.remove")}
            onClick={() => remove(i)}
          />
        </div>
      ))}
      <div>
        <Button icon={<AddRegular />} size="small" onClick={add}>
          {t("apps.redirectUrisAdd")}
        </Button>
      </div>
      {hasWideRegex && (
        <MessageBar intent="warning">
          {t("apps.redirectUrisWideRegexWarning")}
        </MessageBar>
      )}
      {label && (
        <Text className={styles.empty}>{t("apps.redirectUrisRegexTip")}</Text>
      )}
    </div>
  );
  if (!label) return list;
  return (
    <Field label={label} hint={t("apps.redirectUrisHint")}>
      {list}
    </Field>
  );
}
