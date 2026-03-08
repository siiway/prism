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
  Select,
  Spinner,
  Text,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type OAuthApp } from "../../../lib/api";

interface MigrateAppDialogProps {
  teamId: string;
  personalApps: OAuthApp[];
  showMsg: (type: "success" | "error", text: string) => void;
}

export function MigrateAppDialog({
  teamId,
  personalApps,
  showMsg,
}: MigrateAppDialogProps) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedAppId, setSelectedAppId] = useState("");
  const [migrating, setMigrating] = useState(false);

  const handleMigrate = async () => {
    if (!selectedAppId) return;
    setMigrating(true);
    try {
      await api.transferAppToTeam(teamId, selectedAppId);
      await qc.invalidateQueries({ queryKey: ["team-apps", teamId] });
      await qc.invalidateQueries({ queryKey: ["apps"] });
      setOpen(false);
      setSelectedAppId("");
      showMsg("success", "App moved to team");
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : "Failed to migrate app",
      );
    } finally {
      setMigrating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => setOpen(d.open)}>
      <DialogTrigger disableButtonEnhancement>
        <Button size="small">Migrate existing app</Button>
      </DialogTrigger>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Migrate App to Team</DialogTitle>
          <DialogContent>
            {personalApps.length === 0 ? (
              <Text style={{ color: tokens.colorNeutralForeground3 }}>
                You have no personal apps to migrate.
              </Text>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <Field label="Select app" required>
                  <Select
                    value={selectedAppId}
                    onChange={(_, d) => setSelectedAppId(d.value)}
                  >
                    <option value="">— choose an app —</option>
                    {personalApps.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Text
                  size={200}
                  style={{ color: tokens.colorNeutralForeground3 }}
                >
                  The app will be transferred to this team. All team admins and
                  owners will be able to manage it.
                </Text>
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <DialogTrigger>
              <Button>Cancel</Button>
            </DialogTrigger>
            {personalApps.length > 0 && (
              <Button
                appearance="primary"
                onClick={handleMigrate}
                disabled={migrating || !selectedAppId}
              >
                {migrating ? <Spinner size="tiny" /> : "Move to team"}
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
