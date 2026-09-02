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
  makeStyles,
} from "@fluentui/react-components";
import { AddRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../../lib/api";
import { useApi } from "../../../lib/api-context";
import { ImageUrlInput } from "../../../components/ImageUrlInput";

const useStyles = makeStyles({
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
});

interface CreateSubTeamDialogProps {
  parentTeamId: string;
  showMsg: (type: "success" | "error", text: string) => void;
}

const EMPTY_FORM = { name: "", description: "", avatar_url: "" };

export function CreateSubTeamDialog({
  parentTeamId,
  showMsg,
}: CreateSubTeamDialogProps) {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const canSubmit = form.name.trim().length > 0 && !creating;

  const handleOpenChange = (next: boolean) => {
    if (creating) return;
    setOpen(next);
    if (!next) setForm(EMPTY_FORM);
  };

  const handleCreate = async () => {
    if (!canSubmit) return;
    setCreating(true);
    try {
      const res = await api.createSubTeam(parentTeamId, {
        name: form.name.trim(),
        description: form.description || undefined,
        avatar_url: form.avatar_url || undefined,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["team", parentTeamId] }),
        qc.invalidateQueries({ queryKey: ["sub-teams", parentTeamId] }),
        qc.invalidateQueries({ queryKey: ["teams"] }),
      ]);
      setOpen(false);
      setForm(EMPTY_FORM);
      showMsg("success", t("teams.subTeamCreated"));
      navigate(`/teams/${res.team.id}`);
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("teams.failedCreateSubTeam"),
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => handleOpenChange(d.open)}>
      <DialogTrigger disableButtonEnhancement>
        <Button appearance="primary" icon={<AddRegular />} size="small">
          {t("teams.newSubTeam")}
        </Button>
      </DialogTrigger>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t("teams.createSubTeamTitle")}</DialogTitle>
          <DialogContent>
            <div className={styles.form}>
              <Field label={t("teams.teamName")} required>
                <Input
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canSubmit) {
                      e.preventDefault();
                      handleCreate();
                    }
                  }}
                  placeholder={t("teams.teamNamePlaceholder")}
                  autoFocus
                />
              </Field>
              <Field label={t("teams.description")}>
                <Textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                  rows={2}
                />
              </Field>
              <ImageUrlInput
                label={t("teams.avatarUrl")}
                value={form.avatar_url}
                onChange={(v) => setForm((f) => ({ ...f, avatar_url: v }))}
              />
            </div>
          </DialogContent>
          <DialogActions>
            <DialogTrigger>
              <Button disabled={creating}>{t("common.cancel")}</Button>
            </DialogTrigger>
            <Button
              appearance="primary"
              onClick={handleCreate}
              disabled={!canSubmit}
            >
              {creating ? <Spinner size="tiny" /> : t("common.create")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
