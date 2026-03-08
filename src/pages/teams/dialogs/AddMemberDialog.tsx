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
import { api, ApiError } from "../../../lib/api";

interface AddMemberDialogProps {
  teamId: string;
  showMsg: (type: "success" | "error", text: string) => void;
}

export function AddMemberDialog({ teamId, showMsg }: AddMemberDialogProps) {
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
      showMsg("success", "Member added");
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Failed to add member",
      );
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => setOpen(d.open)}>
      <DialogTrigger disableButtonEnhancement>
        <Button appearance="primary" icon={<AddRegular />} size="small">
          Add member
        </Button>
      </DialogTrigger>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Add Team Member</DialogTitle>
          <DialogContent>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <Field label="Username" required>
                <Input
                  value={form.username}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, username: e.target.value }))
                  }
                  placeholder="username"
                />
              </Field>
              <Field label="Role">
                <Select
                  value={form.role}
                  onChange={(_, d) => setForm((f) => ({ ...f, role: d.value }))}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </Select>
              </Field>
            </div>
          </DialogContent>
          <DialogActions>
            <DialogTrigger>
              <Button>Cancel</Button>
            </DialogTrigger>
            <Button appearance="primary" onClick={handleAdd} disabled={adding}>
              {adding ? <Spinner size="tiny" /> : "Add"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
