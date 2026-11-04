// Make a shared SAML profile (/saml-profiles/new). It gets a new random ID;
// apps get it once the user picks it when first signing in to them.

import {
  Button,
  Field,
  Input,
  MessageBar,
  Spinner,
} from "@fluentui/react-components";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { SAML_PROFILE_NAME_MAX_LENGTH } from "../../../shared/limits";
import { apiErrorText } from "../../lib/apiError";
import { useApi } from "../../lib/api-context";
import { FormPage } from "../../components/FormPage";

export function SamlProfileNew() {
  const api = useApi();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const create = async () => {
    const value = name.trim();
    if (!value || saving) return;
    setSaving(true);
    setError("");
    try {
      const { profile } = await api.createSamlProfile(value);
      await qc.invalidateQueries({ queryKey: ["saml-profiles"] });
      navigate(`/saml-profiles/${profile.id}`, { replace: true });
    } catch (err) {
      setError(apiErrorText(err, t("samlProfiles.createFailed")));
      setSaving(false);
    }
  };

  return (
    <FormPage
      backTo="/saml-profiles"
      backLabel={t("samlProfiles.title")}
      title={t("samlProfiles.newTitle")}
      subtitle={t("samlProfiles.newSubtitle")}
      onSubmit={() => void create()}
      actions={
        <>
          <Button type="button" onClick={() => navigate("/saml-profiles")}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            appearance="primary"
            disabled={saving || !name.trim()}
          >
            {saving ? <Spinner size="tiny" /> : t("samlProfiles.create")}
          </Button>
        </>
      }
    >
      {error && <MessageBar intent="error">{error}</MessageBar>}
      <Field
        label={t("samlProfiles.nameLabel")}
        hint={t("samlProfiles.nameHint")}
        required
      >
        <Input
          autoFocus
          value={name}
          maxLength={SAML_PROFILE_NAME_MAX_LENGTH}
          onChange={(_, d) => setName(d.value)}
          placeholder={t("samlProfiles.namePlaceholder")}
        />
      </Field>
    </FormPage>
  );
}
