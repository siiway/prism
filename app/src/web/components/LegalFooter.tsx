// Footer links to the operator's legal pages.
//
// Rendered at the bottom of both shells — the signed-out auth pages and the
// signed-in app — so the Privacy Policy and Terms of Service are always one
// click away wherever a visitor is. It is deliberately silent when neither
// document is published: an operator who has written no policy gets no empty
// footer, the same way the notice board shows nothing when there is nothing
// to say.
//
// Which links appear is driven by the `has_*` booleans on /site, not the
// content itself — the payload stays small and the actual markdown is only
// fetched when the reader opens the page.

import { makeStyles, tokens } from "@fluentui/react-components";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useApi } from "../lib/api-context";

const useStyles = makeStyles({
  footer: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: "6px 14px",
    padding: "12px 8px",
    fontSize: tokens.fontSizeBase200,
  },
  link: {
    color: tokens.colorNeutralForeground3,
    textDecorationLine: "none",
    ":hover": {
      color: tokens.colorNeutralForeground1,
      textDecorationLine: "underline",
    },
  },
});

export function LegalFooter() {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });

  const links: Array<{ to: string; label: string }> = [];
  if (site?.has_privacy_policy)
    links.push({ to: "/privacy", label: t("legal.privacy") });
  if (site?.has_terms_of_service)
    links.push({ to: "/terms", label: t("legal.terms") });

  if (links.length === 0) return null;

  return (
    <footer className={styles.footer}>
      {links.map((l) => (
        <Link key={l.to} to={l.to} className={styles.link}>
          {l.label}
        </Link>
      ))}
    </footer>
  );
}
