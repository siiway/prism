// Create team page (/teams/new)

import {
  Button,
  Field,
  Input,
  MessageBar,
  Spinner,
  Textarea,
} from "@fluentui/react-components";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { FormPage } from "../../components/FormPage";
import { useAuthStore } from "../../store/auth";

export function TeamCreate() {
  const api = useApi();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const isSiteAdmin = useAuthStore((s) => s.user?.role === "admin");
  // Opened from the admin team list: cancel and back lead there.
  const location = useLocation();
  const fromAdmin =
    (location.state as { from?: string } | null)?.from === "admin-teams";
  const listPath = fromAdmin ? "/admin/teams" : "/teams";

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    avatar_url: "",
    owner: "",
  });

  const update =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleCreate = async () => {
    if (!form.name.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api.createTeam({
        name: form.name.trim(),
        description: form.description || undefined,
        avatar_url: form.avatar_url || undefined,
        // Site admins can hand the team straight to its intended owner.
        owner_username: (isSiteAdmin && form.owner.trim()) || undefined,
      });
      await qc.invalidateQueries({ queryKey: ["teams"] });
      await qc.invalidateQueries({ queryKey: ["admin-teams"] });
      navigate(`/teams/${res.team.id}`, { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t("teams.failedCreateTeam"),
      );
      setCreating(false);
    }
  };

  return (
    <FormPage
      backTo={listPath}
      backLabel={fromAdmin ? t("admin.teamsTab") : t("nav.teams")}
      title={t("teams.createTeam")}
      subtitle={t("teams.createSubtitle")}
      onSubmit={handleCreate}
      actions={
        <>
          <Button onClick={() => navigate(listPath)}>
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
      <Field label={t("teams.teamName")} required>
        <Input
          value={form.name}
          onChange={update("name")}
          placeholder={t("teams.teamNamePlaceholder")}
          autoFocus
        />
      </Field>
      <Field label={t("teams.description")}>
        <Textarea
          value={form.description}
          onChange={update("description")}
          rows={3}
        />
      </Field>
      <Field label={t("teams.avatarUrl")}>
        <Input
          value={form.avatar_url}
          onChange={update("avatar_url")}
          placeholder={t("teams.avatarUrlPlaceholder")}
        />
      </Field>
      {isSiteAdmin && (
        <Field
          label={t("admin.teamOwnerLabel")}
          hint={t("admin.teamOwnerHint")}
        >
          <Input value={form.owner} onChange={update("owner")} />
        </Field>
      )}
    </FormPage>
  );
}
