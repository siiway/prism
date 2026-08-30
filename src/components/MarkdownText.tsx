// Inline markdown rendering for trusted UI strings.
//
// Some info-bar messages carry `code` spans or emphasis that plain text
// flattens. This runs them through the same marked + DOMPurify pipeline as
// user-generated markdown, so the allowlist and link hardening apply here
// too — trusted author, untrusted rendering path.

import { makeStyles, tokens } from "@fluentui/react-components";
import { useEffect, useState } from "react";
import { renderMarkdown } from "../lib/markdown";

const useStyles = makeStyles({
  body: {
    // The rendered markdown is a block of HTML; keep it from inheriting the
    // MessageBar's single-line assumptions.
    display: "block",
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

export function MarkdownText({ source }: { source: string }) {
  const styles = useStyles();
  const [html, setHtml] = useState("");

  useEffect(() => {
    let cancelled = false;
    // renderMarkdown registers any <img> with the image proxy, so it is async.
    void renderMarkdown(source).then((out) => {
      if (!cancelled) setHtml(out);
    });
    return () => {
      cancelled = true;
    };
  }, [source]);

  return (
    <span
      className={styles.body}
      // Sanitized by renderMarkdown (DOMPurify, conservative allowlist).
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
