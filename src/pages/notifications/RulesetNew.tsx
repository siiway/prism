// New ruleset (/notifications/rulesets/new): just a name. Creating lands on
// the ruleset's page, where its rules are added; it starts inactive.

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
import { ApiError } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { FormPage } from "../../components/FormPage";

export function RulesetNew() {
  const api = useApi();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const create = async () => {
    const value = name.trim();
    if (!value || creating) return;
    setCreating(true);
    setError("");
    try {
      const res = await api.createNotificationRuleset({
        name: value,
        rules: [],
        is_active: false,
      });
      await qc.invalidateQueries({ queryKey: ["notification-rulesets"] });
      navigate(`/notifications/rulesets/${res.ruleset.id}`, { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : t("notifications.rulesetsSaveFailed"),
      );
      setCreating(false);
    }
  };

  return (
    <FormPage
      backTo="/notifications#rulesets"
      backLabel={t("notifications.title")}
      title={t("notifications.rulesetNewTitle")}
      subtitle={t("notifications.rulesetNewSubtitle")}
      onSubmit={() => void create()}
      actions={
        <>
          <Button onClick={() => navigate("/notifications#rulesets")}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            appearance="primary"
            disabled={!name.trim() || creating}
          >
            {creating ? <Spinner size="tiny" /> : t("common.create")}
          </Button>
        </>
      }
    >
      {error && <MessageBar intent="error">{error}</MessageBar>}
      <Field label={t("notifications.rulesetName")} required>
        <Input
          autoFocus
          maxLength={64}
          value={name}
          onChange={(_, d) => setName(d.value)}
        />
      </Field>
    </FormPage>
  );
}
