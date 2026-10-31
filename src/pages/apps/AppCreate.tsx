// Create OAuth app page (/apps/new)

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
import { ApiError, type RedirectUri } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { FormPage } from "../../components/FormPage";
import { RedirectUriEditor } from "../../components/RedirectUriEditor";

export function AppCreate() {
  const api = useApi();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{
    name: string;
    description: string;
    icon_url: string;
    website_url: string;
    redirect_uris: RedirectUri[];
  }>({
    name: "",
    description: "",
    icon_url: "",
    website_url: "",
    redirect_uris: [],
  });

  const update =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleCreate = async () => {
    if (!form.name.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api.createApp({
        name: form.name.trim(),
        description: form.description,
        icon_url: form.icon_url.trim() || undefined,
        website_url: form.website_url.trim() || undefined,
        redirect_uris: form.redirect_uris.filter((u) => u.value.trim()),
      });
      await qc.invalidateQueries({ queryKey: ["apps"] });
      // The secret is only returned once; AppDetail shows it from state.
      navigate(`/apps/${res.app.id}`, {
        replace: true,
        state: { clientSecret: res.app.client_secret },
      });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t("apps.failedCreateApp"),
      );
      setCreating(false);
    }
  };

  return (
    <FormPage
      backTo="/apps"
      backLabel={t("nav.myApps")}
      title={t("apps.createOAuthApp")}
      subtitle={t("apps.createSubtitle")}
      onSubmit={handleCreate}
      actions={
        <>
          <Button onClick={() => navigate("/apps")}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            appearance="primary"
            disabled={creating || !form.name.trim()}
          >
            {creating ? <Spinner size="tiny" /> : t("common.create")}
          </Button>
        </>
      }
    >
      {error && <MessageBar intent="error">{error}</MessageBar>}
      <Field label={t("apps.appName")} required>
        <Input
          value={form.name}
          onChange={update("name")}
          placeholder={t("apps.appNamePlaceholder")}
          autoFocus
        />
      </Field>
      <Field label={t("apps.description")}>
        <Input value={form.description} onChange={update("description")} />
      </Field>
      <Field label={t("apps.appIconUrl")}>
        <Input
          value={form.icon_url}
          onChange={update("icon_url")}
          placeholder={t("apps.appIconPlaceholder")}
        />
      </Field>
      <Field label={t("apps.websiteUrl")}>
        <Input
          value={form.website_url}
          onChange={update("website_url")}
          placeholder={t("apps.websiteUrlPlaceholder")}
        />
      </Field>
      <RedirectUriEditor
        label={t("apps.redirectUris")}
        value={form.redirect_uris}
        onChange={(v) => setForm((f) => ({ ...f, redirect_uris: v }))}
      />
    </FormPage>
  );
}
