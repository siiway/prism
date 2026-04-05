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
  Select,
  Spinner,
} from "@fluentui/react-components";
import { AddRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../../lib/api";

interface AddMemberDialogProps {
  teamId: string;
  showMsg: (type: "success" | "error", text: string) => void;
}

export function AddMemberDialog({ teamId, showMsg }: AddMemberDialogProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ username: "", role: "member" });
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!form.username.trim()) return;
    setAdding(true);
    try {
      await api.addTeamMember(teamId, {
        username: form.username.trim(),
        role: form.role,
      });
      await qc.invalidateQueries({ queryKey: ["team", teamId] });
      setOpen(false);
      setForm({ username: "", role: "member" });
      showMsg("success", t("teams.memberAdded"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("teams.failedAddMember"),
      );
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => setOpen(d.open)}>
      <DialogTrigger disableButtonEnhancement>
        <Button appearance="primary" icon={<AddRegular />} size="small">
          {t("teams.addMemberButton")}
        </Button>
      </DialogTrigger>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t("teams.addTeamMemberTitle")}</DialogTitle>
          <DialogContent>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <Field label={t("teams.usernameField")} required>
                <Input
                  value={form.username}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, username: e.target.value }))
                  }
                  placeholder={t("teams.usernamePlaceholder")}
                />
              </Field>
              <Field label={t("teams.inviteRole")}>
                <Select
                  value={form.role}
                  onChange={(_, d) => setForm((f) => ({ ...f, role: d.value }))}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="co-owner">Co-owner</option>
                </Select>
              </Field>
            </div>
          </DialogContent>
          <DialogActions>
            <DialogTrigger>
              <Button>{t("common.cancel")}</Button>
            </DialogTrigger>
            <Button appearance="primary" onClick={handleAdd} disabled={adding}>
              {adding ? <Spinner size="tiny" /> : t("common.add")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
