// OAuth: what a developer needs to wire the app up (credentials and
// endpoints), and how the flow behaves — where people come back to and how
// the app authenticates itself. What it may ask for is on Permissions.

import {
  Button,
  Dropdown,
  Field,
  Input,
  Link,
  MessageBar,
  Option,
  Spinner,
  Switch,
  Textarea,
} from "@fluentui/react-components";
import { EyeOffRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { type OAuthApp } from "../../../lib/api";
import { apiErrorText } from "../../../lib/apiError";
import { docsUrl } from "../../../lib/docsUrl";
import { useApi, useAppOrigin } from "../../../lib/api-context";
import { useConfirm } from "../../../lib/useConfirm";
import { CopyButton } from "../../../components/CopyButton";
import { RedirectUriEditor } from "../../../components/RedirectUriEditor";
import {
  SettingsBody,
  SettingsCard,
  SettingsRow,
} from "../../../components/Settings";
import { SectionFooter } from "./shared";
import { useDetailStyles } from "./styles";
import { type AppFormApi } from "./form";

const AUTH_METHODS = [
  "client_secret_basic",
  "client_secret_post",
  "private_key_jwt",
  "none",
];

// Label key (under apps.) and path.
const ENDPOINTS = [
  ["endpointDiscovery", "/.well-known/openid-configuration"],
  ["endpointAuthorization", "/api/oauth/authorize"],
  ["endpointToken", "/api/oauth/token"],
  ["endpointUserInfo", "/api/oauth/userinfo"],
  ["endpointEndSession", "/api/oauth/end_session"],
] as const;

interface Props {
  app: OAuthApp;
  formApi: AppFormApi;
  /** A secret just created or rotated; shown once. */
  newSecret: string;
  setNewSecret: (secret: string) => void;
  showMsg: (type: "success" | "error", text: string) => void;
}

export function OAuthTab({
  app,
  formApi,
  newSecret,
  setNewSecret,
  showMsg,
}: Props) {
  const api = useApi();
  const appOrigin = useAppOrigin();
  const styles = useDetailStyles();
  const qc = useQueryClient();
  const { t, i18n } = useTranslation();
  const { confirm, confirmDialog } = useConfirm();
  const { form, set } = formApi;

  const [rotating, setRotating] = useState(false);

  // A first secret is harmless to create; replacing one breaks whatever
  // still uses it, so that asks first.
  const rotate = async () => {
    if (
      app.has_client_secret &&
      !(await confirm({
        title: t("apps.rotateSecretConfirmTitle"),
        body: t("apps.rotateSecretConfirmBody"),
        confirmLabel: t("apps.rotateSecret"),
      }))
    )
      return;
    setRotating(true);
    try {
      const res = await api.rotateSecret(app.id);
      setNewSecret(res.client_secret);
      await qc.invalidateQueries({ queryKey: ["app", app.id] });
    } catch (err) {
      showMsg("error", apiErrorText(err, t("common.saveFailed")));
    } finally {
      setRotating(false);
    }
  };

  const guideUrl = docsUrl(i18n.language, "oauth");

  return (
    <>
      <SettingsCard
        id="credentials"
        title={t("apps.clientCredentials")}
        description={t("apps.credentialsDesc")}
      >
        <SettingsRow
          label={t("apps.clientId")}
          description={<span className={styles.mono}>{app.client_id}</span>}
        >
          <CopyButton text={app.client_id} label={t("common.copyClientId")} />
        </SettingsRow>
        <SettingsRow
          label={t("apps.clientSecret")}
          description={
            app.is_public
              ? t("apps.secretPublic")
              : app.has_client_secret
                ? t("apps.secretSet")
                : t("apps.secretNone")
          }
        >
          {!app.is_public && (
            <Button size="small" disabled={rotating} onClick={rotate}>
              {rotating ? (
                <Spinner size="tiny" />
              ) : app.has_client_secret ? (
                t("apps.rotateSecret")
              ) : (
                t("apps.generateSecret")
              )}
            </Button>
          )}
        </SettingsRow>
        {newSecret && (
          <SettingsBody>
            <MessageBar intent="warning">
              {t("apps.saveSecretWarning")}
            </MessageBar>
            <div className={styles.secret}>
              <span className={styles.secretText}>{newSecret}</span>
              <CopyButton text={newSecret} />
              <Button
                size="small"
                appearance="subtle"
                icon={<EyeOffRegular />}
                onClick={() => setNewSecret("")}
              >
                {t("apps.hideSecret")}
              </Button>
            </div>
          </SettingsBody>
        )}
      </SettingsCard>

      <SettingsCard
        id="endpoints"
        title={t("apps.oauthEndpoints")}
        description={
          <>
            {t("apps.endpointsDesc")}{" "}
            <Link href={guideUrl} target="_blank" rel="noreferrer">
              {t("apps.oauthOidcGuide")}
            </Link>
          </>
        }
      >
        {ENDPOINTS.map(([key, path]) => (
          <SettingsRow
            key={path}
            label={t(`apps.${key}`)}
            description={
              <span className={styles.mono}>
                {appOrigin}
                {path}
              </span>
            }
          >
            <CopyButton text={`${appOrigin}${path}`} />
          </SettingsRow>
        ))}
      </SettingsCard>

      <SettingsCard
        id="redirects"
        title={t("apps.redirectUris")}
        description={t("apps.redirectsDesc")}
      >
        <SettingsBody>
          <RedirectUriEditor
            value={form.redirect_uris}
            onChange={(v) => set("redirect_uris", v)}
          />
        </SettingsBody>
        <SectionFooter section="redirects" api={formApi} />
      </SettingsCard>

      <SettingsCard
        id="sign-out"
        title={t("apps.signOutTitle")}
        description={t("apps.signOutDesc")}
      >
        <SettingsBody>
          <div className={styles.form}>
            <Field
              label={t("apps.postLogoutRedirectUris")}
              hint={t("apps.postLogoutRedirectUrisHint")}
            >
              <Textarea
                value={form.post_logout_text}
                onChange={(_, d) => set("post_logout_text", d.value)}
                placeholder="https://app.example.com/logged-out"
                rows={3}
                resize="vertical"
                textarea={{ className: styles.monoInput }}
              />
            </Field>
            <Field
              label={t("apps.backchannelLogoutUri")}
              hint={t("apps.backchannelLogoutUriHint")}
            >
              <Input
                value={form.backchannel_logout_uri}
                onChange={(_, d) => set("backchannel_logout_uri", d.value)}
                placeholder="https://app.example.com/backchannel-logout"
                input={{ className: styles.monoInput }}
              />
            </Field>
          </div>
        </SettingsBody>
        <SectionFooter section="logout" api={formApi} />
      </SettingsCard>

      <SettingsCard
        id="client-auth"
        title={t("apps.clientAuthTitle")}
        description={t("apps.clientAuthDesc")}
      >
        <SettingsRow
          label={t("apps.publicClientLabel")}
          description={t("apps.publicClientDesc")}
        >
          <Switch
            aria-label={t("apps.publicClientLabel")}
            checked={form.is_public}
            onChange={(_, d) => set("is_public", d.checked)}
          />
        </SettingsRow>
        <SettingsRow
          label={t("apps.tokenEndpointAuthMethod")}
          description={t("apps.tokenEndpointAuthMethodHint")}
        >
          <div className={styles.control}>
            <Dropdown
              className={styles.dropdown}
              aria-label={t("apps.tokenEndpointAuthMethod")}
              value={
                form.token_endpoint_auth_method || t("apps.authMethodDefault")
              }
              selectedOptions={[form.token_endpoint_auth_method]}
              onOptionSelect={(_, d) =>
                set("token_endpoint_auth_method", d.optionValue ?? "")
              }
            >
              <Option value="" text={t("apps.authMethodDefault")}>
                {t("apps.authMethodDefault")}
              </Option>
              {AUTH_METHODS.map((m) => (
                <Option key={m} value={m}>
                  {m}
                </Option>
              ))}
            </Dropdown>
          </div>
        </SettingsRow>
        {form.token_endpoint_auth_method === "private_key_jwt" && (
          <SettingsBody>
            <div className={styles.form}>
              <Field label={t("apps.jwks")} hint={t("apps.jwksHint")}>
                <Textarea
                  value={form.jwks}
                  onChange={(_, d) => set("jwks", d.value)}
                  placeholder='{"keys":[{"kty":"RSA","kid":"…","n":"…","e":"AQAB"}]}'
                  rows={5}
                  resize="vertical"
                  textarea={{ className: styles.monoInput }}
                />
              </Field>
              <Field label={t("apps.jwksUri")} hint={t("apps.jwksUriHint")}>
                <Input
                  value={form.jwks_uri}
                  onChange={(_, d) => set("jwks_uri", d.value)}
                  placeholder="https://app.example.com/.well-known/jwks.json"
                  input={{ className: styles.monoInput }}
                />
              </Field>
            </div>
          </SettingsBody>
        )}
        <SettingsRow
          label={t("apps.jwtTokensLabel")}
          description={t("apps.jwtTokensDesc")}
        >
          <Switch
            aria-label={t("apps.jwtTokensLabel")}
            checked={form.use_jwt_tokens}
            onChange={(_, d) => set("use_jwt_tokens", d.checked)}
          />
        </SettingsRow>
        <SectionFooter section="client" api={formApi} />
      </SettingsCard>

      {confirmDialog}
    </>
  );
}
