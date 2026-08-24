// Public, operator-authored legal pages: Privacy Policy (/privacy) and Terms
// of Service (/terms).
//
// The content is markdown an administrator writes in Admin → Settings →
// Legal. It is fetched on its own (not from the /site payload, which is
// prefetched everywhere) and rendered through the SAME sanitizer as profile
// READMEs and notices — trusting it because an admin wrote it would make this
// the one stored-markdown surface nothing checks, and it is reachable without
// signing in.
//
// An unpublished document is a real, reachable page rather than a 404: the
// footer only links here when the document exists, but someone following an
// old link to a policy that was since cleared should get a clear "not
// published" message, not a generic not-found.

import {
  Image,
  Spinner,
  Text,
  Title1,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, type LegalDocType } from "../lib/api";
import { renderMarkdown } from "../lib/markdown";

const useStyles = makeStyles({
  page: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    background: tokens.colorNeutralBackground1,
    padding: "40px 16px",
    boxSizing: "border-box",
  },
  container: {
    width: "100%",
    maxWidth: "760px",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    textDecorationLine: "none",
    color: tokens.colorNeutralForeground2,
    alignSelf: "flex-start",
    ":hover": { color: tokens.colorNeutralForeground1 },
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    paddingBottom: "12px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  updated: { color: tokens.colorNeutralForeground3 },
  // Typographic defaults for the rendered markdown. The sanitizer already
  // constrains which tags can appear; this only styles the ones that do.
  body: {
    color: tokens.colorNeutralForeground1,
    lineHeight: tokens.lineHeightBase400,
    fontSize: tokens.fontSizeBase300,
    "& h1, & h2, & h3, & h4": {
      marginTop: "1.4em",
      marginBottom: "0.5em",
      lineHeight: tokens.lineHeightBase500,
    },
    "& h1": { fontSize: tokens.fontSizeHero700 },
    "& h2": { fontSize: tokens.fontSizeBase600 },
    "& h3": { fontSize: tokens.fontSizeBase500 },
    "& p": { margin: "0 0 1em" },
    "& ul, & ol": { margin: "0 0 1em", paddingInlineStart: "24px" },
    "& li": { margin: "0.25em 0" },
    "& a": { color: tokens.colorBrandForegroundLink },
    "& code": {
      fontFamily: tokens.fontFamilyMonospace,
      fontSize: tokens.fontSizeBase200,
      background: tokens.colorNeutralBackground3,
      padding: "1px 4px",
      borderRadius: "3px",
    },
    "& pre": {
      background: tokens.colorNeutralBackground3,
      padding: "12px",
      borderRadius: "6px",
      overflowX: "auto",
    },
    "& pre code": { background: "none", padding: 0 },
    "& blockquote": {
      margin: "0 0 1em",
      paddingInlineStart: "12px",
      borderLeft: `3px solid ${tokens.colorNeutralStroke1}`,
      color: tokens.colorNeutralForeground2,
    },
    "& table": { borderCollapse: "collapse", margin: "0 0 1em" },
    "& th, & td": {
      border: `1px solid ${tokens.colorNeutralStroke2}`,
      padding: "6px 10px",
    },
    "& img": { maxWidth: "100%" },
    "& hr": {
      border: "none",
      borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
      margin: "1.5em 0",
    },
  },
  empty: {
    color: tokens.colorNeutralForeground3,
    padding: "32px 0",
  },
  footer: {
    display: "flex",
    gap: "16px",
    paddingTop: "16px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    fontSize: tokens.fontSizeBase200,
  },
  footerLink: {
    color: tokens.colorNeutralForeground3,
    textDecorationLine: "none",
    ":hover": {
      color: tokens.colorNeutralForeground1,
      textDecorationLine: "underline",
    },
  },
});

function LegalPage({ doc }: { doc: LegalDocType }) {
  const styles = useStyles();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });
  const { data, isLoading } = useQuery({
    queryKey: ["legal", doc],
    queryFn: () => api.legal(doc),
  });

  const title =
    doc === "privacy" ? t("legal.privacyTitle") : t("legal.termsTitle");

  // Retitle the tab so a bookmarked policy reads as itself, not "Prism".
  useEffect(() => {
    if (typeof document === "undefined") return;
    const prev = document.title;
    document.title = `${title} · ${site?.site_name ?? "Prism"}`;
    return () => {
      document.title = prev;
    };
  }, [title, site?.site_name]);

  // Markdown → sanitized HTML. Done in an effect (not in render) because
  // renderMarkdown is async — it pre-registers any images with the proxy —
  // and because keeping the body client-only sidesteps SSR hydration
  // mismatches on the sanitized output.
  const [html, setHtml] = useState("");
  useEffect(() => {
    let cancelled = false;
    const content = data?.content ?? "";
    // Empty content resolves to "" through the same async path rather than a
    // synchronous setState in the effect body — keeps the one code path and
    // clears any stale render if the document is unpublished while open.
    void (content ? renderMarkdown(content) : Promise.resolve("")).then(
      (out) => {
        if (!cancelled) setHtml(out);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [data?.content]);

  const updatedLabel =
    data?.updated_at != null
      ? new Date(data.updated_at * 1000).toLocaleDateString(
          i18n.resolvedLanguage,
          { year: "numeric", month: "long", day: "numeric" },
        )
      : null;

  const otherDoc: LegalDocType = doc === "privacy" ? "terms" : "privacy";
  const otherAvailable =
    otherDoc === "privacy"
      ? site?.has_privacy_policy
      : site?.has_terms_of_service;

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <Link to="/" className={styles.brand}>
          {site?.site_icon_url && (
            <Image
              src={site.site_icon_url}
              alt=""
              shape="rounded"
              fit="cover"
              width={28}
              height={28}
            />
          )}
          <Text weight="semibold" size={400}>
            {site?.site_name ?? "Prism"}
          </Text>
        </Link>

        <div className={styles.header}>
          <Title1>{title}</Title1>
          {updatedLabel && (
            <Text size={200} className={styles.updated}>
              {t("legal.lastUpdated", { date: updatedLabel })}
            </Text>
          )}
        </div>

        {isLoading ? (
          <Spinner />
        ) : data?.content ? (
          <div
            className={styles.body}
            // Sanitized by renderMarkdown (DOMPurify, conservative allowlist).
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <Text className={styles.empty}>{t("legal.notPublished")}</Text>
        )}

        <div className={styles.footer}>
          <Link to="/" className={styles.footerLink}>
            {t("legal.backHome")}
          </Link>
          {otherAvailable && (
            <Link to={`/${otherDoc}`} className={styles.footerLink}>
              {otherDoc === "privacy" ? t("legal.privacy") : t("legal.terms")}
            </Link>
          )}
          <button
            type="button"
            className={styles.footerLink}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              font: "inherit",
              padding: 0,
            }}
            onClick={() => navigate(-1)}
          >
            {t("legal.goBack")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PrivacyPage() {
  return <LegalPage doc="privacy" />;
}

export function TermsPage() {
  return <LegalPage doc="terms" />;
}
