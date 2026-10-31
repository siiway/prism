// Shared pagination bar: previous / next / jump-to-page with the current and
// total page count. With a single page only the item count is shown — the
// controls would all be disabled anyway.

import {
  Button,
  Input,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const useStyles = makeStyles({
  pager: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "8px",
    flexWrap: "wrap",
    // Directly under the list it pages, not pinned to the window bottom
    // where it ends up far from a short list.
    paddingTop: "12px",
  },
  pageCount: {
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
  },
  jump: { width: "64px" },
});

interface PaginationProps {
  page: number;
  /** Total number of pages (>= 1). */
  pageCount: number;
  onChange: (page: number) => void;
  /** Pass the total item count to show it next to the page indicator. */
  total?: number;
  /** Disable navigation while a fetch is in flight. */
  disabled?: boolean;
}

export function Pagination({
  page,
  pageCount,
  onChange,
  total,
  disabled,
}: PaginationProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [jump, setJump] = useState("");

  const goToPage = () => {
    const n = Number.parseInt(jump, 10);
    if (!Number.isNaN(n)) {
      onChange(Math.min(pageCount, Math.max(1, n)));
      setJump("");
    }
  };

  const count = total !== undefined && (
    <Text size={200} className={styles.pageCount}>
      {t("common.totalItems", { count: total })}
    </Text>
  );

  if (pageCount <= 1) {
    return count ? <div className={styles.pager}>{count}</div> : null;
  }

  return (
    <div className={styles.pager}>
      {count}
      <Button
        size="small"
        appearance="subtle"
        disabled={disabled || page <= 1}
        onClick={() => onChange(page - 1)}
      >
        {t("common.previous")}
      </Button>
      <Text size={200} className={styles.pageCount}>
        {t("common.pageOf", { page, total: pageCount })}
      </Text>
      <Button
        size="small"
        appearance="subtle"
        disabled={disabled || page >= pageCount}
        onClick={() => onChange(page + 1)}
      >
        {t("common.next")}
      </Button>
      <Input
        className={styles.jump}
        size="small"
        type="number"
        min={1}
        max={pageCount}
        value={jump}
        onChange={(_, d) => setJump(d.value)}
        onKeyDown={(e) => e.key === "Enter" && goToPage()}
        placeholder={t("common.pageNumber")}
        aria-label={t("common.goToPage")}
      />
      <Button size="small" appearance="subtle" onClick={goToPage}>
        {t("common.go")}
      </Button>
    </div>
  );
}
