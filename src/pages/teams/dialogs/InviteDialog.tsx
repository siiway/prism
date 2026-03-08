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
import { api, ApiError } from "../../../lib/api";

interface InviteDialogProps {
  teamId: string;
  showMsg: (type: "success" | "error", text: string) => void;
}

export function InviteDialog({ teamId, showMsg }: InviteDialogProps) {
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
        showMsg("success", "Invite link copied to clipboard!");
      } else {
        showMsg("success", "Invite email sent");
      }
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Failed to create invite",
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => setOpen(d.open)}>
      <DialogTrigger disableButtonEnhancement>
        <Button icon={<LinkRegular />} size="small">
          Invite
        </Button>
      </DialogTrigger>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Invite to Team</DialogTitle>
          <DialogContent>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <Field label="Role">
                <Select
                  value={form.role}
                  onChange={(_, d) => setForm((f) => ({ ...f, role: d.value }))}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </Select>
              </Field>
              <Field
                label="Email (optional)"
                hint="Leave blank to create a shareable link"
              >
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, email: e.target.value }))
                  }
                  placeholder="user@example.com"
                  contentBefore={<MailRegular />}
                />
              </Field>
              <Field label="Max uses" hint="0 = unlimited">
                <Input
                  type="number"
                  value={form.max_uses}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, max_uses: e.target.value }))
                  }
                  placeholder="0"
                />
              </Field>
              <Field label="Expires after (hours)">
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
              <Button>Cancel</Button>
            </DialogTrigger>
            <Button
              appearance="primary"
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? (
                <Spinner size="tiny" />
              ) : form.email ? (
                "Send invite"
              ) : (
                "Copy invite link"
              )}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
