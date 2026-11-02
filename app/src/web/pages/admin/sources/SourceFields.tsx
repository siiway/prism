// The pieces of an OAuth source form, shared by the new-source page (one
// form, in groups) and the source page (one card per group, each saved on
// its own): what to register at the provider, credentials, endpoints for
// generic providers, and the sign-in button with a live preview.

import {
  Button,
  Field,
  Input,
  MessageBar,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useProxiedImage } from "../../../lib/api";
import { apiErrorText } from "../../../lib/apiError";
import { useApi, useAppOrigin } from "../../../lib/api-context";
import { CopyButton } from "../../../components/CopyButton";
import { PasswordInput } from "../../../components/PasswordInput";
import { ProviderButton } from "../../../components/ProviderButton";
import { Segmented } from "../../../components/Segmented";
import {
  NO_AUTOFILL,
  credentialLabels,
  hasBuiltinIcon,
  invertsOnDark,
  isHttpsUrl,
  providerLabel,
  resolvedIcon,
  setupTarget,
  type IconChoice,
  type SourceForm,
} from "./sourceForm";

const useStyles = makeStyles({
  // Fields side by side; start-aligned so a hint under one doesn't push
  // its neighbour's control down.
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    alignItems: "start",
    gap: "16px",
    "@media (max-width: 600px)": { gridTemplateColumns: "1fr" },
  },
  stack: { display: "flex", flexDirection: "column", gap: "16px" },
  group: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    paddingTop: "20px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  groupHead: { display: "flex", flexDirection: "column", gap: "2px" },
  groupTitle: { fontWeight: tokens.fontWeightSemibold },
  muted: { color: tokens.colorNeutralForeground3 },
  // A read-only value to copy, styled like a quiet input.
  copyBox: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minHeight: "32px",
    padding: "0 4px 0 10px",
    boxSizing: "border-box",
    borderRadius: tokens.borderRadiusMedium,
    background: tokens.colorNeutralBackground3,
  },
  copyValue: {
    flex: 1,
    minWidth: 0,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    overflowWrap: "anywhere",
    paddingTop: "6px",
    paddingBottom: "6px",
  },
  issuer: { display: "flex", gap: "8px", alignItems: "flex-start" },
  grow: { flex: 1, minWidth: 0 },
  start: { justifySelf: "start", maxWidth: "100%" },
  button: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 280px",
    alignItems: "start",
    gap: "24px",
    "@media (max-width: 760px)": { gridTemplateColumns: "1fr" },
  },
  preview: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "16px",
    borderRadius: tokens.borderRadiusLarge,
    background: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  previewLabel: {
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: tokens.colorNeutralForeground3,
  },
  previewError: { color: tokens.colorPaletteRedForeground1 },
  // Same column as the sign-in page's provider list.
  previewButtons: { display: "flex", flexDirection: "column", gap: "8px" },
});

interface FieldsProps {
  form: SourceForm;
  onChange: (next: SourceForm) => void;
  /** Editing a saved source: blank credentials keep the stored ones. */
  editing?: boolean;
}

/** A titled group of fields on the new-source page. */
export function FormGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <Text className={styles.groupTitle}>{title}</Text>
        {description && (
          <Text size={200} className={styles.muted}>
            {description}
          </Text>
        )}
      </div>
      {children}
    </div>
  );
}

/** The callback URL (or, for Telegram, the domain) to give the provider. */
export function SetupField({ form }: { form: SourceForm }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const origin = useAppOrigin();
  const target = setupTarget(origin, form.provider, form.slug.trim());
  const label =
    target.kind === "domain"
      ? t("admin.oauthBotDomain")
      : t("admin.oauthCallbackUrl");
  return (
    <Field label={label}>
      <div className={styles.copyBox}>
        <span className={styles.copyValue}>{target.value}</span>
        <CopyButton text={target.value} label={label} />
      </div>
    </Field>
  );
}

export function CredentialFields({ form, onChange, editing }: FieldsProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const labels = credentialLabels(t, form.provider);
  const keep = editing ? t("admin.oauthLeaveBlankToKeep") : undefined;
  return (
    <div className={styles.grid}>
      <Field label={labels.id} hint={keep} required={!editing}>
        <Input
          {...NO_AUTOFILL}
          value={form.client_id}
          onChange={(_, d) => onChange({ ...form, client_id: d.value })}
        />
      </Field>
      <Field label={labels.secret} hint={keep} required={!editing}>
        <PasswordInput
          {...NO_AUTOFILL}
          autoComplete="new-password"
          value={form.client_secret}
          onChange={(_, d) => onChange({ ...form, client_secret: d.value })}
        />
      </Field>
    </div>
  );
}

export function EndpointFields({ form, onChange }: FieldsProps) {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState("");

  const text = (
    key: "issuer_url" | "auth_url" | "token_url" | "userinfo_url" | "scopes",
  ) => ({
    value: form[key],
    onChange: (_: unknown, d: { value: string }) =>
      onChange({ ...form, [key]: d.value }),
  });

  const discover = async () => {
    setDiscovering(true);
    setDiscoverError("");
    try {
      const res = await api.adminDiscoverOIDC(form.issuer_url.trim());
      onChange({ ...form, ...res });
    } catch (err) {
      setDiscoverError(apiErrorText(err, t("admin.oauthDiscoverFailed")));
    } finally {
      setDiscovering(false);
    }
  };

  return (
    <div className={styles.stack}>
      {form.provider === "oidc" && (
        <Field
          label={t("admin.oauthIssuerUrl")}
          hint={t("admin.oauthIssuerUrlHint")}
        >
          <div className={styles.issuer}>
            <Input
              className={styles.grow}
              {...text("issuer_url")}
              placeholder="https://accounts.example.com"
            />
            <Button
              disabled={discovering || !form.issuer_url.trim()}
              onClick={() => void discover()}
            >
              {discovering ? <Spinner size="tiny" /> : t("admin.oauthDiscover")}
            </Button>
          </div>
        </Field>
      )}
      {discoverError && <MessageBar intent="error">{discoverError}</MessageBar>}
      <Field label={t("admin.oauthAuthUrl")} required>
        <Input
          {...text("auth_url")}
          placeholder="https://provider.example.com/oauth2/authorize"
        />
      </Field>
      <Field label={t("admin.oauthTokenUrl")} required>
        <Input
          {...text("token_url")}
          placeholder="https://provider.example.com/oauth2/token"
        />
      </Field>
      <Field label={t("admin.oauthUserinfoUrl")} required>
        <Input
          {...text("userinfo_url")}
          placeholder="https://provider.example.com/oauth2/userinfo"
        />
      </Field>
      <Field label={t("admin.oauthScopes")} hint={t("admin.oauthScopesHint")}>
        <Input
          {...text("scopes")}
          placeholder={form.provider === "oidc" ? "openid email profile" : ""}
        />
      </Field>
    </div>
  );
}

/** The button as the sign-in page will draw it. Custom icon URLs are only
 *  fetched once typing pauses, so each keystroke isn't sent to the proxy. */
function ButtonPreview({ form }: { form: SourceForm }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const icon = resolvedIcon(form);
  const [settled, setSettled] = useState(icon);
  useEffect(() => {
    const id = setTimeout(() => setSettled(icon), 400);
    return () => clearTimeout(id);
  }, [icon]);
  // Built-in icons are local paths; custom ones must be HTTPS.
  const wanted =
    settled && (settled.startsWith("/") || isHttpsUrl(settled))
      ? settled
      : null;
  const proxied = useProxiedImage(wanted);
  // Load it first so a dead icon shows as a note, not a blank button.
  const [loaded, setLoaded] = useState<{ src: string; ok: boolean } | null>(
    null,
  );
  useEffect(() => {
    if (!proxied) return;
    let live = true;
    const img = new Image();
    img.onload = () => live && setLoaded({ src: proxied, ok: true });
    img.onerror = () => live && setLoaded({ src: proxied, ok: false });
    img.src = proxied;
    return () => {
      live = false;
    };
  }, [proxied]);
  const state =
    !wanted || !proxied
      ? null
      : loaded?.src === proxied
        ? loaded.ok
        : undefined; // still loading
  const src = state ? proxied : "";
  // The image failed to load (bad URL, or the proxy couldn't fetch it).
  const failed =
    form.icon !== "none" && !!settled && settled === icon && state === false;
  const name = form.name.trim() || providerLabel(t, form.provider);
  return (
    <div className={styles.preview}>
      <span className={styles.previewLabel}>{t("admin.oauthPreview")}</span>
      {/* A picture of the button: not focusable, not announced. */}
      <div className={styles.previewButtons} inert aria-hidden>
        <ProviderButton
          provider={{
            slug: form.slug || "preview",
            name,
            icon_proxied_url: src || null,
            icon_invert_on_dark:
              form.icon === "builtin" && invertsOnDark(form.provider),
            // As the server does: no icon, no icon-only button.
            icon_only: src ? form.icon_only : 0,
          }}
          onClick={() => {}}
        />
      </div>
      {failed && (
        <Text size={200} className={styles.previewError}>
          {t("admin.oauthIconFailed")}
        </Text>
      )}
    </div>
  );
}

export function ButtonFields({ form, onChange }: FieldsProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const iconOptions: { value: IconChoice; label: string }[] = [
    ...(hasBuiltinIcon(form.provider)
      ? [{ value: "builtin" as const, label: t("admin.oauthIconBuiltin") }]
      : []),
    { value: "custom", label: t("admin.oauthIconCustom") },
    { value: "none", label: t("admin.oauthIconNone") },
  ];
  const urlError =
    form.icon === "custom" &&
    !!form.icon_url.trim() &&
    !isHttpsUrl(form.icon_url.trim());

  return (
    <div className={styles.button}>
      <div className={styles.stack}>
        <Field label={t("admin.oauthName")} hint={t("admin.oauthNameHint")}>
          <Input
            {...NO_AUTOFILL}
            value={form.name}
            placeholder={providerLabel(t, form.provider)}
            onChange={(_, d) => onChange({ ...form, name: d.value })}
          />
        </Field>
        <Field label={t("admin.oauthIcon")}>
          <Segmented
            className={styles.start}
            label={t("admin.oauthIcon")}
            value={form.icon}
            options={iconOptions}
            onChange={(icon) => onChange({ ...form, icon })}
          />
        </Field>
        {form.icon === "custom" && (
          <Field
            label={t("admin.oauthIconUrl")}
            hint={t("admin.oauthIconUrlHint")}
            validationState={urlError ? "error" : undefined}
            validationMessage={
              urlError ? t("imageUrl.httpsRequired") : undefined
            }
          >
            <Input
              value={form.icon_url}
              placeholder="https://example.com/icon.svg"
              onChange={(_, d) => onChange({ ...form, icon_url: d.value })}
            />
          </Field>
        )}
        <Field
          label={t("admin.oauthLayout")}
          hint={form.icon === "none" ? t("admin.oauthLayoutNeedsIcon") : ""}
        >
          <Segmented
            className={styles.start}
            label={t("admin.oauthLayout")}
            value={form.icon === "none" ? "0" : String(form.icon_only)}
            disabled={form.icon === "none"}
            onChange={(v) =>
              onChange({ ...form, icon_only: Number(v) as 0 | 1 | 2 })
            }
            options={[
              { value: "0", label: t("admin.oauthLayoutText") },
              { value: "1", label: t("admin.oauthLayoutCompact") },
              { value: "2", label: t("admin.oauthLayoutWide") },
            ]}
          />
        </Field>
      </div>
      <ButtonPreview form={form} />
    </div>
  );
}
