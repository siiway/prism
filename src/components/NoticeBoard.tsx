// The reader half of the notice board.
//
// Rendered above the page content in the signed-in shell and on the
// signed-out auth pages. It is deliberately quiet when there is nothing to
// say: no heading, no empty state, no reserved space — a board that occupies
// the top of every page to announce that it is empty is worse than no board.
// When there is something to say, only the two most urgent notices are open
// and the rest are a click away.
//
// The body is markdown from an administrator, but it still goes through the
// same sanitizer as profile READMEs. Trusting it because of who wrote it
// would mean the one place a stored-XSS bug reaches every signed-in user is
// also the one place nothing checks.

import {
  Button,
  makeStyles,
  mergeClasses,
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

// Each notice is laid out like Cloudflare's Kumo Banner (packages/kumo/src/
// components/banner/banner.tsx): a tint of the level's colour with no
// border, the title and description in the level's text colour, a filled
// icon, and the dismiss at the trailing end. The colours are Fluent's brand
// and status tokens, so they follow the theme like everything else.
const useStyles = makeStyles({
  board: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    marginBottom: "20px",
  },
  notice: {
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
    padding: "12px 16px",
    borderRadius: tokens.borderRadiusXLarge,
    background: "var(--notice-tint)",
    color: "var(--notice-text)",
    fontSize: "14px",
    lineHeight: 1.375,
  },
  info: {
    "--notice-tint": tokens.colorBrandBackground2,
    "--notice-text": tokens.colorBrandForeground2,
    "--notice-icon": tokens.colorBrandForeground1,
  },
  warning: {
    "--notice-tint": tokens.colorStatusWarningBackground1,
    "--notice-text": tokens.colorStatusWarningForeground2,
    "--notice-icon": tokens.colorStatusWarningForeground3,
  },
  critical: {
    "--notice-tint": tokens.colorStatusDangerBackground1,
    "--notice-text": tokens.colorStatusDangerForeground1,
    "--notice-icon": tokens.colorStatusDangerForeground3,
  },
  // As tall as the title's first line, so the icon centres on it.
  icon: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    height: "1.375em",
    fontSize: "16px",
    color: "var(--notice-icon)",
  },
  content: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    flex: 1,
    minWidth: 0,
  },
  title: { fontWeight: tokens.fontWeightMedium },
  body: {
    fontSize: "13px",
    overflowWrap: "anywhere",
    // The rendered markdown is a block of HTML.
    "& p": { margin: "4px 0" },
    "& p:first-child": { marginTop: 0 },
    "& p:last-child": { marginBottom: 0 },
    "& ul, & ol": { margin: "4px 0", paddingInlineStart: "20px" },
    "& code": { fontFamily: tokens.fontFamilyMonospace },
    "& a": { color: "inherit", textDecoration: "underline" },
  },
  meta: { fontSize: "13px", opacity: 0.8 },
  dismiss: {
    flexShrink: 0,
    alignSelf: "center",
    color: "inherit",
    ":hover": { color: "inherit" },
    ":hover:active": { color: "inherit" },
  },
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
      <span className={styles.icon} aria-hidden>
        <Icon />
      </span>
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
