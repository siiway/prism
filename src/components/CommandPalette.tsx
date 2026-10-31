// Ctrl/⌘ K search across pages, settings cards, admin sections and data
// (apps, teams, users, …). Arrow keys move, Enter opens, Esc closes. What
// is searchable comes from lib/search.

import {
  Dialog,
  DialogSurface,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { ArrowEnterLeftRegular, SearchRegular } from "@fluentui/react-icons";
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  searchEntries,
  useRemoteEntries,
  useStaticEntries,
  type SearchGroup,
  type SearchResult,
} from "../lib/search";

const MAX_RESULTS = 40;

const useStyles = makeStyles({
  surface: {
    width: "min(640px, calc(100vw - 32px))",
    maxWidth: "640px",
    padding: 0,
    alignSelf: "flex-start",
    marginTop: "12vh",
    overflow: "hidden",
    "@media (max-width: 640px)": { marginTop: "16px" },
  },
  inputRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "0 16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    "& > svg": {
      fontSize: "18px",
      color: tokens.colorNeutralForeground3,
      flexShrink: 0,
    },
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: "52px",
    border: "none",
    outline: "none",
    background: "transparent",
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase400,
    "::placeholder": { color: tokens.colorNeutralForeground4 },
  },
  esc: {
    padding: "1px 6px",
    borderRadius: tokens.borderRadiusSmall,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
  },
  list: {
    maxHeight: "min(60vh, 480px)",
    overflowY: "auto",
    padding: "6px",
  },
  groupLabel: {
    padding: "10px 10px 4px",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "8px 10px",
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    color: tokens.colorNeutralForeground1,
  },
  active: {
    background: tokens.colorNeutralBackground1Hover,
  },
  itemIcon: {
    display: "inline-flex",
    flexShrink: 0,
    fontSize: "18px",
    color: tokens.colorNeutralForeground3,
  },
  itemText: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
  },
  itemTitle: {
    fontSize: tokens.fontSizeBase300,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  itemSub: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  enter: {
    flexShrink: 0,
    fontSize: "14px",
    color: tokens.colorNeutralForeground3,
    visibility: "hidden",
  },
  enterVisible: { visibility: "visible" },
  searching: {
    padding: "8px 10px",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  empty: {
    padding: "28px 16px",
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
  footer: {
    display: "flex",
    gap: "16px",
    padding: "8px 16px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    "@media (max-width: 640px)": { display: "none" },
  },
});

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const styles = useStyles();
  return (
    <Dialog
      open={open}
      onOpenChange={(_, d) => {
        if (!d.open) onClose();
      }}
    >
      <DialogSurface className={styles.surface}>
        {/* Mounted only while open, so the query resets each time. */}
        {open && <PaletteBody onClose={onClose} />}
      </DialogSurface>
    </Dialog>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const staticEntries = useStaticEntries();
  const [query, setQuery] = useState("");
  // Server-side search waits for a pause in typing.
  const [remoteQuery, setRemoteQuery] = useState("");
  useEffect(() => {
    const id = window.setTimeout(() => setRemoteQuery(query), 250);
    return () => window.clearTimeout(id);
  }, [query]);
  const remote = useRemoteEntries(remoteQuery);
  const entries = useMemo(
    () => [...staticEntries, ...remote.entries],
    [staticEntries, remote.entries],
  );
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const results = useMemo(
    () => searchEntries(entries, query).slice(0, MAX_RESULTS),
    [entries, query],
  );
  // With no query the list is grouped as the sidebar is; with one, it's
  // ranked, and group labels would only interrupt the ranking.
  const grouped = query.trim() === "";

  const go = (r: SearchResult | undefined) => {
    if (!r) return;
    onClose();
    navigate(r.entry.to);
  };

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <>
      <div className={styles.inputRow}>
        <SearchRegular />
        <input
          autoFocus
          className={styles.input}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={results.length ? optionId(active) : undefined}
          aria-label={t("search.placeholder")}
          placeholder={t("search.placeholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(results.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(results[active]);
            }
          }}
        />
        <kbd className={styles.esc}>Esc</kbd>
      </div>

      <div ref={listRef} id={listId} role="listbox" className={styles.list}>
        {results.length === 0 ? (
          <div className={styles.empty}>
            {remote.loading
              ? t("search.searching")
              : t("search.noResults", { query: query.trim() })}
          </div>
        ) : (
          results.map((r, i) => {
            const prev = results[i - 1]?.entry.group;
            const showGroup = grouped && r.entry.group !== prev;
            const Icon = r.entry.icon;
            const sub = [
              r.entry.context?.text,
              r.matchedKeyword ?? r.entry.description?.text,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <Fragment key={r.entry.id}>
                {showGroup && (
                  <div className={styles.groupLabel} role="presentation">
                    {t(groupKey(r.entry.group))}
                  </div>
                )}
                <div
                  id={optionId(i)}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  className={mergeClasses(
                    styles.item,
                    i === active && styles.active,
                  )}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => go(r)}
                >
                  <span className={styles.itemIcon}>
                    <Icon />
                  </span>
                  <span className={styles.itemText}>
                    <span className={styles.itemTitle}>
                      {r.entry.title.text}
                    </span>
                    {sub && <span className={styles.itemSub}>{sub}</span>}
                  </span>
                  <ArrowEnterLeftRegular
                    className={mergeClasses(
                      styles.enter,
                      i === active && styles.enterVisible,
                    )}
                  />
                </div>
              </Fragment>
            );
          })
        )}
        {results.length > 0 && remote.loading && (
          <div className={styles.searching}>{t("search.searching")}</div>
        )}
      </div>

      <div className={styles.footer}>
        <span>{t("search.hintMove")}</span>
        <span>{t("search.hintOpen")}</span>
        <span>{t("search.hintClose")}</span>
      </div>
    </>
  );
}

function groupKey(group: SearchGroup): string {
  return `search.group.${group}`;
}
