// The search box above a list: a search icon, and a clear button once
// something is typed. Callers debounce the value themselves.

import { Button, Input, makeStyles } from "@fluentui/react-components";
import { DismissRegular, SearchRegular } from "@fluentui/react-icons";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

const useStyles = makeStyles({
  bar: {
    display: "flex",
    gap: "8px",
    marginBottom: "12px",
    flexWrap: "wrap",
    alignItems: "center",
  },
  input: { minWidth: "220px", flex: "1 1 220px" },
});

export function ListSearch({
  value,
  onChange,
  placeholder,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Filters or actions beside the box. */
  children?: ReactNode;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <div className={styles.bar}>
      <Input
        className={styles.input}
        value={value}
        onChange={(_, d) => onChange(d.value)}
        placeholder={placeholder}
        contentBefore={<SearchRegular />}
        contentAfter={
          value ? (
            <Button
              appearance="transparent"
              size="small"
              icon={<DismissRegular />}
              aria-label={t("common.clear")}
              onClick={() => onChange("")}
            />
          ) : undefined
        }
      />
      {children}
    </div>
  );
}
