// New OAuth source (/admin/connections/new): a sign-in provider such as
// GitHub or a generic OIDC issuer. The page walks through it in the order
// it's set up: pick the provider, register Prism's callback URL there, paste
// the credentials, then decide how the button looks. Creating lands on the
// source's page.

import {
  Button,
  Field,
  Input,
  MessageBar,
  Spinner,
  makeStyles,
} from "@fluentui/react-components";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../../lib/api";
import { useApi } from "../../../lib/api-context";
import { FormPage } from "../../../components/FormPage";
import { Select } from "../../../components/Select";
import {
  ButtonFields,
  CredentialFields,
  EndpointFields,
  FormGroup,
  SetupField,
  ToggleField,
} from "./SourceFields";
import {
  EMPTY_SOURCE,
  NO_AUTOFILL,
  PROVIDERS,
  createComplete,
  createPayload,
  isGeneric,
  slugValid,
  providerLabel,
  setupHint,
  withProvider,
  type SourceForm,
} from "./sourceForm";

const useStyles = makeStyles({
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    alignItems: "start",
    gap: "16px",
    "@media (max-width: 600px)": { gridTemplateColumns: "1fr" },
  },
});

export function SourceNew() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [form, setForm] = useState<SourceForm>(EMPTY_SOURCE);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  // A blank display name falls back to the provider's name.
  const filled = form.name.trim()
    ? form
    : { ...form, name: providerLabel(t, form.provider) };
  const complete = createComplete(filled);
  const slugError = !!form.slug && !slugValid(form.slug);

  const create = async () => {
    if (!complete || creating) return;
    setCreating(true);
    setError("");
    try {
      const res = await api.adminCreateOAuthSource(createPayload(filled));
      await qc.invalidateQueries({ queryKey: ["admin-oauth-sources"] });
      await qc.invalidateQueries({ queryKey: ["site"] });
      navigate(`/admin/connections/${res.source.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.saveFailed"));
      setCreating(false);
    }
  };

  return (
    <FormPage
      backTo="/admin/connections"
      backLabel={t("admin.connectionsTab")}
      title={t("admin.oauthAddSource")}
      subtitle={t("admin.oauthNewDesc")}
      onSubmit={() => void create()}
      actions={
        <>
          <Button type="button" onClick={() => navigate("/admin/connections")}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            appearance="primary"
            disabled={!complete || creating}
          >
            {creating ? <Spinner size="tiny" /> : t("admin.oauthAddSource")}
          </Button>
        </>
      }
    >
      {error && <MessageBar intent="error">{error}</MessageBar>}

      <div className={styles.grid}>
        <Field label={t("admin.oauthProvider")} required>
          <Select
            value={form.provider}
            onChange={(_, d) => setForm(withProvider(form, d.value))}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {providerLabel(t, p)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t("admin.oauthSlug")}
          hint={slugError ? undefined : t("admin.oauthSlugHint")}
          validationState={slugError ? "error" : undefined}
          validationMessage={
            slugError ? t("admin.oauthSlugInvalid") : undefined
          }
          required
        >
          <Input
            {...NO_AUTOFILL}
            value={form.slug}
            placeholder={`${form.provider}-work`}
            // Lowercase as you type; anything else that isn't allowed is
            // flagged rather than silently changed.
            onChange={(_, d) =>
              setForm({ ...form, slug: d.value.toLowerCase() })
            }
          />
        </Field>
      </div>

      <FormGroup
        title={t("admin.oauthAppTitle")}
        description={setupHint(t, form.provider)}
      >
        <SetupField form={form} />
        <CredentialFields form={form} onChange={setForm} />
      </FormGroup>

      {isGeneric(form.provider) && (
        <FormGroup
          title={t("admin.oauthEndpointsTitle")}
          description={t("admin.oauthEndpointsDesc")}
        >
          <EndpointFields form={form} onChange={setForm} />
        </FormGroup>
      )}

      <FormGroup
        title={t("admin.oauthButtonTitle")}
        description={t("admin.oauthButtonDesc")}
      >
        <ButtonFields form={form} onChange={setForm} />
      </FormGroup>

      <FormGroup title={t("admin.oauthSecurityTitle")}>
        <ToggleField
          label={t("admin.oauthTrusted")}
          hint={t("admin.oauthTrustedHint")}
          checked={form.trusted}
          onChange={(trusted) => setForm({ ...form, trusted })}
        />
      </FormGroup>
    </FormPage>
  );
}
