// The reader half of the notice board.
//
// Rendered above the page content in the signed-in shell and on the
// signed-out auth pages. It is deliberately quiet when there is nothing to
// say: no heading, no empty state, no reserved space — a board that occupies
// the top of every page to announce that it is empty is worse than no board.
// When there is something to say it stays quiet too: a plain card with the
// level in a thin accent and the icon, rather than a slab of colour, and only
// the two most urgent notices open, the rest a click away.
//
// The body is markdown from an administrator, but it still goes through the
// same sanitizer as profile READMEs. Trusting it because of who wrote it
// would mean the one place a stored-XSS bug reaches every signed-in user is
// also the one place nothing checks.

import {
  Button,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from "@fluentui/react-components";
import {
  ChevronDownRegular,
  ChevronUpRegular,
  DismissRegular,
  ErrorCircleFilled,
  InfoFilled,
  WarningFilled,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { type Notice, type NoticeLevel } from "../lib/api";
import { useApi } from "../lib/api-context";
import { renderMarkdown } from "../lib/markdown";

/** Notices open on the board before the rest fold away. */
const OPEN = 2;
const SEVERITY: Record<NoticeLevel, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const useStyles = makeStyles({
  board: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    marginBottom: "20px",
  },
  notice: {
    position: "relative",
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
    padding: "12px 12px 12px 16px",
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    overflow: "hidden",
    // The level, as a thin bar down the left edge.
    "::before": {
      content: '""',
      position: "absolute",
      insetBlock: 0,
      insetInlineStart: 0,
      width: "3px",
      background: "var(--notice-accent)",
    },
  },
  info: {
    "--notice-accent": tokens.colorBrandBackground,
    "--notice-icon": tokens.colorBrandForeground1,
  },
  warning: {
    "--notice-accent": tokens.colorStatusWarningBorderActive,
    "--notice-icon": tokens.colorStatusWarningForeground1,
  },
  // Something is wrong right now: a red border as well, but no fill — a
  // red slab across every page reads as the product being broken.
  critical: {
    "--notice-accent": tokens.colorStatusDangerBorderActive,
    "--notice-icon": tokens.colorStatusDangerForeground1,
    ...shorthands.borderColor(tokens.colorStatusDangerBorder2),
  },
  icon: {
    flexShrink: 0,
    fontSize: "20px",
    // Line the icon up with the title's first line.
    marginTop: "1px",
    color: "var(--notice-icon)",
  },
  content: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  body: {
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    color: tokens.colorNeutralForeground2,
    overflowWrap: "anywhere",
    // The rendered markdown is a block of HTML.
    "& p": { margin: "4px 0" },
    "& p:first-child": { marginTop: 0 },
    "& p:last-child": { marginBottom: 0 },
    "& ul, & ol": { margin: "4px 0", paddingInlineStart: "20px" },
    "& code": {
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: tokens.fontSizeBase200,
    },
    "& a": { color: tokens.colorBrandForegroundLink },
  },
  meta: {
    marginTop: "2px",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  dismiss: { flexShrink: 0, marginTop: "-4px", marginRight: "-4px" },
  more: { alignSelf: "flex-start" },
});

const ICON: Record<NoticeLevel, typeof InfoFilled> = {
  info: InfoFilled,
  warning: WarningFilled,
  critical: ErrorCircleFilled,
};

function NoticeBody({ markdown }: { markdown: string }) {
  const styles = useStyles();
  const [html, setHtml] = useState("");

  useEffect(() => {
    let cancelled = false;
    // renderMarkdown registers any <img> with the image proxy, so it is async.
    void renderMarkdown(markdown).then((out) => {
      if (!cancelled) setHtml(out);
    });
    return () => {
      cancelled = true;
    };
  }, [markdown]);

  return (
    <div
      className={styles.body}
      // Sanitized by renderMarkdown (DOMPurify, conservative allowlist).
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** One notice as readers see it. Also the admin composer's preview, so the
 *  two can't drift apart. */
export function NoticeBar({
  notice,
  onDismiss,
}: {
  notice: Pick<Notice, "title" | "body" | "level" | "team_name">;
  /** Shows the dismiss button. */
  onDismiss?: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const level: NoticeLevel = notice.level in ICON ? notice.level : "info";
  const Icon = ICON[level];
  return (
    <section
      className={mergeClasses(styles.notice, styles[level])}
      aria-label={notice.title}
    >
      <Icon className={styles.icon} aria-hidden />
      <div className={styles.content}>
        <div className={styles.title}>{notice.title}</div>
        {notice.body.trim() && <NoticeBody markdown={notice.body} />}
        {notice.team_name && (
          <div className={styles.meta}>
            {t("notices.forTeam", { team: notice.team_name })}
          </div>
        )}
      </div>
      {onDismiss && (
        <Button
          className={styles.dismiss}
          appearance="subtle"
          size="small"
          icon={<DismissRegular />}
          aria-label={t("notices.dismiss")}
          onClick={onDismiss}
        />
      )}
    </section>
  );
}

export function NoticeBoard() {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const { data } = useQuery({
    queryKey: ["notices"],
    queryFn: () => api.notices(),
    // This runs on every page. A minute of staleness is invisible to the
    // reader and turns a per-navigation query into a per-session one.
    staleTime: 60_000,
    retry: false,
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => api.dismissNotice(id),
    // Optimistic: the row disappears on click. The server call only records
    // it, so a failure means it comes back on the next load — which is the
    // right outcome and not worth blocking the interaction for.
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["notices"] });
      const previous = qc.getQueryData<{ notices: Notice[] }>(["notices"]);
      qc.setQueryData<{ notices: Notice[] }>(["notices"], (old) =>
        old ? { notices: old.notices.filter((n) => n.id !== id) } : old,
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) qc.setQueryData(["notices"], context.previous);
    },
  });

  // Most urgent first (the server's pinned-then-newest order within a
  // level), so what folds away is never the critical one.
  const notices = [...(data?.notices ?? [])].sort(
    (a, b) => (SEVERITY[a.level] ?? 2) - (SEVERITY[b.level] ?? 2),
  );
  if (!notices.length) return null;
  const hidden = notices.length - OPEN;
  const shown = expanded || hidden <= 0 ? notices : notices.slice(0, OPEN);

  return (
    <div
      className={styles.board}
      role="region"
      aria-label={t("notices.region")}
    >
      {shown.map((notice) => (
        <NoticeBar
          key={notice.id}
          notice={notice}
          onDismiss={
            notice.is_dismissible ? () => dismiss.mutate(notice.id) : undefined
          }
        />
      ))}
      {hidden > 0 && (
        <Button
          className={styles.more}
          appearance="subtle"
          size="small"
          icon={expanded ? <ChevronUpRegular /> : <ChevronDownRegular />}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? t("notices.showFewer")
            : t("notices.showMore", { count: hidden })}
        </Button>
      )}
    </div>
  );
}
