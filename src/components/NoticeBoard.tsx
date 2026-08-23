// The reader half of the notice board.
//
// Rendered above the page content in the signed-in shell and on the
// signed-out auth pages. It is deliberately quiet when there is nothing to
// say: no heading, no empty state, no reserved space — a board that occupies
// the top of every page to announce that it is empty is worse than no board.
//
// The body is markdown from an administrator, but it still goes through the
// same sanitizer as profile READMEs. Trusting it because of who wrote it
// would mean the one place a stored-XSS bug reaches every signed-in user is
// also the one place nothing checks.

import {
  Button,
  Link,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, type Notice, type NoticeLevel } from "../lib/api";
import { renderMarkdown } from "../lib/markdown";

const useStyles = makeStyles({
  board: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    marginBottom: "16px",
  },
  body: {
    // The rendered markdown is a block of HTML; keep it from inheriting the
    // MessageBar's single-line assumptions.
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
});

const INTENT: Record<NoticeLevel, "info" | "warning" | "error"> = {
  info: "info",
  warning: "warning",
  critical: "error",
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
    <span
      className={styles.body}
      // Sanitized by renderMarkdown (DOMPurify, conservative allowlist).
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function NoticeBoard() {
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();

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

  const notices = data?.notices ?? [];
  if (!notices.length) return null;

  return (
    <div
      className={styles.board}
      role="region"
      aria-label={t("notices.region")}
    >
      {notices.map((notice) => (
        <MessageBar key={notice.id} intent={INTENT[notice.level] ?? "info"}>
          <MessageBarBody>
            <MessageBarTitle>{notice.title}</MessageBarTitle>
            <NoticeBody markdown={notice.body} />
            {notice.team_name && (
              <>
                {" "}
                <Link as="span">
                  {t("notices.forTeam", { team: notice.team_name })}
                </Link>
              </>
            )}
          </MessageBarBody>
          {notice.is_dismissible && (
            <MessageBarActions>
              <Button
                appearance="transparent"
                icon={<DismissRegular />}
                aria-label={t("notices.dismiss")}
                onClick={() => dismiss.mutate(notice.id)}
              />
            </MessageBarActions>
          )}
        </MessageBar>
      ))}
    </div>
  );
}
