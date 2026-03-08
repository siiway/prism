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
import { LinkRegular, MailRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../../lib/api";

interface InviteDialogProps {
  teamId: string;
  showMsg: (type: "success" | "error", text: string) => void;
}

export function InviteDialog({ teamId, showMsg }: InviteDialogProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    role: "member",
    email: "",
    max_uses: "",
    ttl_hours: "72",
  });
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await api.createTeamInvite(teamId, {
        role: form.role,
        email: form.email.trim() || undefined,
        max_uses: form.max_uses ? parseInt(form.max_uses) : undefined,
        ttl_hours: form.ttl_hours ? parseInt(form.ttl_hours) : undefined,
      });
      await qc.invalidateQueries({ queryKey: ["team-invites", teamId] });
      setOpen(false);
      setForm({ role: "member", email: "", max_uses: "", ttl_hours: "72" });

      if (!res.invite.email) {
        const link = `${window.location.origin}/teams/join/${res.invite.token}`;
        await navigator.clipboard.writeText(link);
        showMsg("success", t("teams.inviteLinkCopied"));
      } else {
        showMsg("success", t("teams.inviteEmailSent"));
      }
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("teams.failedCreateInvite"),
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => setOpen(d.open)}>
      <DialogTrigger disableButtonEnhancement>
        <Button icon={<LinkRegular />} size="small">
          {t("teams.inviteButton")}
        </Button>
      </DialogTrigger>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t("teams.inviteToTeam")}</DialogTitle>
          <DialogContent>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <Field label={t("teams.inviteRole")}>
                <Select
                  value={form.role}
                  onChange={(_, d) => setForm((f) => ({ ...f, role: d.value }))}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </Select>
              </Field>
              <Field
                label={t("teams.inviteEmailOptional")}
                hint={t("teams.inviteEmailHint")}
              >
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, email: e.target.value }))
                  }
                  placeholder={t("teams.inviteEmailPlaceholder")}
                  contentBefore={<MailRegular />}
                />
              </Field>
              <Field label={t("teams.maxUses")} hint={t("teams.maxUsesHint")}>
                <Input
                  type="number"
                  value={form.max_uses}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, max_uses: e.target.value }))
                  }
                  placeholder="0"
                />
              </Field>
              <Field label={t("teams.expiresAfter")}>
                <Input
                  type="number"
                  value={form.ttl_hours}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, ttl_hours: e.target.value }))
                  }
                  placeholder="72"
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
              {creating ? (
                <Spinner size="tiny" />
              ) : form.email ? (
                t("teams.sendInvite")
              ) : (
                t("teams.copyInviteLink")
              )}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
