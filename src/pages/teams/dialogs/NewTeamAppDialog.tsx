import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  Spinner,
  Textarea,
} from "@fluentui/react-components";
import { AddRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../../lib/api";

interface NewTeamAppDialogProps {
  teamId: string;
  showMsg: (type: "success" | "error", text: string) => void;
}

export function NewTeamAppDialog({ teamId, showMsg }: NewTeamAppDialogProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    website_url: "",
    redirect_uris: "",
  });
  const [creating, setCreating] = useState(false);

  const update =
    (k: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    const uris = form.redirect_uris
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!uris.length) {
      showMsg("error", t("teams.atLeastOneRedirectUri"));
      return;
    }
    setCreating(true);
    try {
      const res = await api.createTeamApp(teamId, {
        name: form.name.trim(),
        description: form.description || undefined,
        website_url: form.website_url || undefined,
        redirect_uris: uris,
      });
      await qc.invalidateQueries({ queryKey: ["team-apps", teamId] });
      setOpen(false);
      setForm({
        name: "",
        description: "",
        website_url: "",
        redirect_uris: "",
      });
      navigate(`/apps/${res.app.id}`);
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("teams.failedCreateApp"),
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => setOpen(d.open)}>
      <DialogTrigger disableButtonEnhancement>
        <Button appearance="primary" icon={<AddRegular />} size="small">
          {t("teams.newAppButton")}
        </Button>
      </DialogTrigger>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t("teams.createTeamAppTitle")}</DialogTitle>
          <DialogContent>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <Field label={t("teams.appName")} required>
                <Input
                  value={form.name}
                  onChange={update("name")}
                  placeholder={t("teams.appNamePlaceholder")}
                />
              </Field>
              <Field label={t("teams.descriptionField")}>
                <Input
                  value={form.description}
                  onChange={update("description")}
                />
              </Field>
              <Field label={t("teams.websiteUrlField")}>
                <Input
                  value={form.website_url}
                  onChange={update("website_url")}
                  placeholder={t("teams.websiteUrlPlaceholder")}
                />
              </Field>
              <Field
                label={t("teams.redirectUrisField")}
                hint={t("teams.redirectUrisHint")}
                required
              >
                <Textarea
                  value={form.redirect_uris}
                  onChange={update("redirect_uris")}
                  rows={3}
                  placeholder={t("teams.redirectUrisPlaceholder")}
                />
              </Field>
            </div>
          </DialogContent>
          <DialogActions>
            <DialogTrigger>
              <Button>{t("common.cancel")}</Button>
            </DialogTrigger>
            <Button
              appearance="primary"
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? <Spinner size="tiny" /> : t("common.create")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
