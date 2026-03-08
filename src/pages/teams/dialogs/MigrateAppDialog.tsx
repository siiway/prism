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
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      showMsg("success", t("teams.appMovedToTeam"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("teams.failedMigrateApp"),
      );
    } finally {
      setMigrating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => setOpen(d.open)}>
      <DialogTrigger disableButtonEnhancement>
        <Button size="small">{t("teams.migrateExistingApp")}</Button>
      </DialogTrigger>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t("teams.migrateAppTitle")}</DialogTitle>
          <DialogContent>
            {personalApps.length === 0 ? (
              <Text style={{ color: tokens.colorNeutralForeground3 }}>
                {t("teams.noPersonalApps")}
              </Text>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <Field label={t("teams.selectApp")} required>
                  <Select
                    value={selectedAppId}
                    onChange={(_, d) => setSelectedAppId(d.value)}
                  >
                    <option value="">{t("teams.chooseApp")}</option>
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
                  {t("teams.migrateAppDesc")}
                </Text>
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <DialogTrigger>
              <Button>{t("common.cancel")}</Button>
            </DialogTrigger>
            {personalApps.length > 0 && (
              <Button
                appearance="primary"
                onClick={handleMigrate}
                disabled={migrating || !selectedAppId}
              >
                {migrating ? <Spinner size="tiny" /> : t("teams.moveToTeam")}
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
