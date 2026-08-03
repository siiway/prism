// Assign member groups. Sends the full desired set — the server reconciles
// it against what the member already holds and permission-checks only the
// groups that actually change.

import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  MessageBar,
  Spinner,
  Text,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError, type TeamMember } from "../../../lib/api";

interface AssignGroupsDialogProps {
  teamId: string;
  member: TeamMember;
  onClose: () => void;
  showMsg: (type: "success" | "error", text: string) => void;
}

export function AssignGroupsDialog({
  teamId,
  member,
  onClose,
  showMsg,
}: AssignGroupsDialogProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["team-groups", teamId],
    queryFn: () => api.listTeamGroups(teamId),
  });
  const definitions = data?.groups ?? [];

  // Only direct assignments are editable here; inherited labels belong to
  // the ancestor team they came from.
  const directSlugs = new Set(
    (member.groups ?? [])
      .filter((g) => g.inherited_from === null)
      .map((g) => g.slug),
  );
  const inherited = (member.groups ?? []).filter(
    (g) => g.inherited_from !== null,
  );

  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);

  // Seed from the server once the definitions land, then let the user drive.
  const current =
    selected ??
    new Set(
      definitions.filter((g) => directSlugs.has(g.slug)).map((g) => g.id),
    );

  const toggle = (groupId: string, checked: boolean) => {
    const next = new Set(current);
    if (checked) next.add(groupId);
    else next.delete(groupId);
    setSelected(next);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.setTeamMemberGroups(teamId, member.user_id, [...current]);
      await qc.invalidateQueries({ queryKey: ["team", teamId] });
      onClose();
      showMsg("success", t("teams.groupsAssigned"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("teams.groupsAssignFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>
            {t("teams.assignGroupsTitle", { name: member.display_name })}
          </DialogTitle>
          <DialogContent>
            {isLoading ? (
              <Spinner size="tiny" />
            ) : definitions.length === 0 ? (
              <MessageBar intent="info">{t("teams.noGroupsDesc")}</MessageBar>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                }}
              >
                {definitions.map((g) => (
                  <Checkbox
                    key={g.id}
                    checked={current.has(g.id)}
                    // Groups the viewer may not hand out stay visible but
                    // locked, so it's clear the label exists and why it
                    // can't be changed here.
                    disabled={!g.can_assign}
                    onChange={(_, d) => toggle(g.id, !!d.checked)}
                    label={
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span>{g.name}</span>
                        <Text
                          size={200}
                          font="monospace"
                          style={{ color: tokens.colorNeutralForeground3 }}
                        >
                          {g.slug}
                        </Text>
                      </span>
                    }
                  />
                ))}
              </div>
            )}

            {inherited.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <Text
                  size={200}
                  block
                  style={{ color: tokens.colorNeutralForeground3 }}
                >
                  {t("teams.inheritedGroupsNote")}
                </Text>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 4,
                    marginTop: 6,
                  }}
                >
                  {inherited.map((g) => (
                    <Badge
                      key={g.slug}
                      appearance="outline"
                      size="small"
                      color="informative"
                    >
                      {g.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{t("common.cancel")}</Button>
            <Button
              appearance="primary"
              onClick={handleSave}
              disabled={saving || isLoading}
            >
              {saving ? <Spinner size="tiny" /> : t("common.save")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
