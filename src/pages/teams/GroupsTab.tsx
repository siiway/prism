// Member groups tab for TeamDetail — group definitions and, for owners,
// the capability set that decides which of them admins may hand out.

import {
  Badge,
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
  MessageBar,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { AddRegular, DeleteRegular, EditRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError, type TeamGroup } from "../../lib/api";
import { EmptyState } from "../../components/EmptyState";
import { SkeletonTableRows } from "../../components/Skeletons";

const useStyles = makeStyles({
  tableScroll: { overflowX: "auto" },
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "16px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "8px",
  },
});

/** Derive a slug suggestion from the display name so the common case needs
 *  no thought — the field stays editable because the slug is permanent. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

interface GroupsTabProps {
  teamId: string;
  /** Team-level switch. Definitions stay listed while off so an owner can
   *  see what re-enabling restores. */
  enabled: boolean;
  isOwner: boolean;
  showMsg: (type: "success" | "error", text: string) => void;
}

export function GroupsTab({
  teamId,
  enabled,
  isOwner,
  showMsg,
}: GroupsTabProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["team-groups", teamId],
    queryFn: () => api.listTeamGroups(teamId),
  });

  const groups = data?.groups ?? [];
  const canManage = !!data?.can_manage && enabled;

  const [editing, setEditing] = useState<TeamGroup | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TeamGroup | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["team-groups", teamId] }),
      // Member rows carry their chips, so they go stale too.
      qc.invalidateQueries({ queryKey: ["team", teamId] }),
    ]);
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.deleteTeamGroup(teamId, deleting.id);
      await refresh();
      setDeleting(null);
      showMsg("success", t("teams.groupDeleted"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("teams.groupDeleteFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Text style={{ color: tokens.colorNeutralForeground3 }}>
        {t("teams.groupsDesc")}
      </Text>

      {!enabled && (
        <MessageBar intent="info">{t("teams.groupsDisabledNotice")}</MessageBar>
      )}

      {canManage && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button
            appearance="primary"
            icon={<AddRegular />}
            size="small"
            onClick={() => setCreating(true)}
          >
            {t("teams.newGroup")}
          </Button>
        </div>
      )}

      {isLoading ? (
        <Table>
          <TableBody>
            <SkeletonTableRows rows={3} cols={4} />
          </TableBody>
        </Table>
      ) : groups.length === 0 ? (
        <EmptyState
          title={t("teams.noGroupsTitle")}
          description={t("teams.noGroupsDesc")}
        />
      ) : (
        <div className={styles.tableScroll}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>{t("teams.groupHeader")}</TableHeaderCell>
                <TableHeaderCell>{t("teams.groupSlugHeader")}</TableHeaderCell>
                <TableHeaderCell>
                  {t("teams.groupAssignableHeader")}
                </TableHeaderCell>
                {canManage && <TableHeaderCell />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <TableRow key={g.id}>
                  <TableCell>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <Badge
                        appearance="filled"
                        size="small"
                        style={
                          g.color
                            ? { backgroundColor: g.color, color: "#fff" }
                            : undefined
                        }
                        color={g.color ? undefined : "informative"}
                      >
                        {g.name}
                      </Badge>
                      {g.description && (
                        <Text
                          size={200}
                          style={{ color: tokens.colorNeutralForeground3 }}
                        >
                          {g.description}
                        </Text>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Text
                      font="monospace"
                      size={200}
                      style={{ color: tokens.colorNeutralForeground3 }}
                    >
                      {g.slug}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Text size={200}>
                      {g.admin_assignable === null
                        ? t("teams.groupAssignableDefault")
                        : g.admin_assignable
                          ? t("teams.groupAssignableAdmins")
                          : t("teams.groupAssignableOwners")}
                    </Text>
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <div style={{ display: "flex", gap: 4 }}>
                        <Button
                          appearance="subtle"
                          size="small"
                          icon={<EditRegular />}
                          onClick={() => setEditing(g)}
                        />
                        <Button
                          appearance="subtle"
                          size="small"
                          icon={<DeleteRegular />}
                          style={{ color: tokens.colorPaletteRedForeground1 }}
                          onClick={() => setDeleting(g)}
                        />
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {isOwner && <AdminCapabilitiesPanel teamId={teamId} showMsg={showMsg} />}

      {(creating || editing) && (
        <GroupFormDialog
          teamId={teamId}
          group={editing}
          isOwner={isOwner}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={refresh}
          showMsg={showMsg}
        />
      )}

      <Dialog
        open={!!deleting}
        onOpenChange={(_, d) => !d.open && setDeleting(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("teams.deleteGroupTitle")}</DialogTitle>
            <DialogContent>
              <Text>
                {t("teams.deleteGroupConfirm", { name: deleting?.name ?? "" })}
              </Text>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDeleting(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                appearance="primary"
                onClick={handleDelete}
                disabled={busy}
              >
                {busy ? <Spinner size="tiny" /> : t("common.delete")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}

// ─── Owner-only capability panel ─────────────────────────────────────────────

/** Whether admins may manage definitions / hand out labels. Owner-only,
 *  because a capability set the constrained role could edit would be no
 *  constraint at all. */
function AdminCapabilitiesPanel({
  teamId,
  showMsg,
}: {
  teamId: string;
  showMsg: (type: "success" | "error", text: string) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);

  const { data: groupsData } = useQuery({
    queryKey: ["team-groups", teamId],
    queryFn: () => api.listTeamGroups(teamId),
  });
  const { data: teamData } = useQuery({
    queryKey: ["team", teamId],
    queryFn: () => api.getTeam(teamId),
  });

  const effective = groupsData?.capabilities;
  const defaults = groupsData?.default_capabilities;
  const overrides = teamData?.team.role_permissions?.admin ?? {};

  // `null` clears the override so the capability falls back through the
  // chain again. Dropping the key entirely is what signals that — an
  // explicit `false` would pin it instead.
  const setCapability = async (
    key: "groups:manage" | "groups:assign",
    value: boolean | null,
  ) => {
    setSaving(key);
    try {
      const nextAdmin = { ...overrides };
      if (value === null) delete nextAdmin[key];
      else nextAdmin[key] = value;
      await api.updateTeam(teamId, {
        role_permissions: { admin: nextAdmin },
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["team", teamId] }),
        qc.invalidateQueries({ queryKey: ["team-groups", teamId] }),
      ]);
      showMsg("success", t("teams.capabilitiesSaved"));
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("teams.capabilitiesFailed"),
      );
    } finally {
      setSaving(null);
    }
  };

  if (!effective || !defaults) return null;

  const capabilityField = (
    key: "groups:manage" | "groups:assign",
    label: string,
  ) => {
    const override = overrides[key];
    return (
      <Field key={key} label={label}>
        <Select
          value={override === undefined ? "" : override ? "yes" : "no"}
          disabled={saving === key}
          onChange={(_, d) =>
            setCapability(key, d.value === "" ? null : d.value === "yes")
          }
        >
          <option value="">
            {t("teams.capabilityFollowDefault", {
              state: defaults[key]
                ? t("teams.capabilityAllow")
                : t("teams.capabilityDeny"),
            })}
          </option>
          <option value="yes">{t("teams.capabilityAllow")}</option>
          <option value="no">{t("teams.capabilityDeny")}</option>
        </Select>
      </Field>
    );
  };

  return (
    <div className={styles.panel}>
      <div>
        <Text weight="semibold" size={400} block>
          {t("teams.adminCapabilitiesTitle")}
        </Text>
        <Text
          size={200}
          block
          style={{ color: tokens.colorNeutralForeground3, marginTop: 4 }}
        >
          {t("teams.adminCapabilitiesDesc")}
        </Text>
      </div>
      {capabilityField("groups:manage", t("teams.capabilityGroupsManage"))}
      {capabilityField("groups:assign", t("teams.capabilityGroupsAssign"))}
    </div>
  );
}

// ─── Create / edit dialog ────────────────────────────────────────────────────

function GroupFormDialog({
  teamId,
  group,
  isOwner,
  onClose,
  onSaved,
  showMsg,
}: {
  teamId: string;
  group: TeamGroup | null;
  isOwner: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  showMsg: (type: "success" | "error", text: string) => void;
}) {
  const { t } = useTranslation();
  const isEdit = !!group;
  const [form, setForm] = useState({
    name: group?.name ?? "",
    slug: group?.slug ?? "",
    description: group?.description ?? "",
    color: group?.color ?? "",
    // "" = follow the team default, "yes"/"no" = per-group exception.
    assignable:
      group?.admin_assignable === null || group?.admin_assignable === undefined
        ? ""
        : group.admin_assignable
          ? "yes"
          : "no",
  });
  // A slug the user hasn't touched keeps tracking the name; once edited it
  // stops, so a deliberate identifier is never overwritten.
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  const assignablePayload =
    form.assignable === "" ? null : form.assignable === "yes";

  const handleSave = async () => {
    setSaving(true);
    try {
      if (isEdit) {
        await api.updateTeamGroup(teamId, group.id, {
          name: form.name.trim(),
          description: form.description.trim(),
          color: form.color || null,
          ...(isOwner ? { admin_assignable: assignablePayload } : {}),
        });
      } else {
        await api.createTeamGroup(teamId, {
          slug: (slugTouched ? form.slug : slugify(form.name)).trim(),
          name: form.name.trim(),
          description: form.description.trim(),
          color: form.color || null,
          ...(isOwner ? { admin_assignable: assignablePayload } : {}),
        });
      }
      await onSaved();
      onClose();
      showMsg(
        "success",
        isEdit ? t("teams.groupUpdated") : t("teams.groupCreated"),
      );
    } catch (err) {
      showMsg(
        "error",
        err instanceof ApiError ? err.message : t("teams.groupSaveFailed"),
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
            {isEdit ? t("teams.editGroupTitle") : t("teams.newGroupTitle")}
          </DialogTitle>
          <DialogContent>
            <div
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              <Field label={t("teams.groupNameField")} required>
                <Input
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                />
              </Field>
              <Field
                label={t("teams.groupSlugField")}
                hint={
                  isEdit
                    ? t("teams.groupSlugImmutableHint")
                    : t("teams.groupSlugHint")
                }
                required
              >
                <Input
                  value={slugTouched ? form.slug : slugify(form.name)}
                  disabled={isEdit}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setForm((f) => ({ ...f, slug: e.target.value }));
                  }}
                />
              </Field>
              <Field label={t("teams.groupDescriptionField")}>
                <Textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                  rows={2}
                />
              </Field>
              <Field
                label={t("teams.groupColorField")}
                hint={t("teams.groupColorHint")}
              >
                <Input
                  value={form.color}
                  placeholder="#5865f2"
                  onChange={(e) =>
                    setForm((f) => ({ ...f, color: e.target.value }))
                  }
                />
              </Field>
              {isOwner && (
                <Field
                  label={t("teams.groupAssignableField")}
                  hint={t("teams.groupAssignableHint")}
                >
                  <Select
                    value={form.assignable}
                    onChange={(_, d) =>
                      setForm((f) => ({ ...f, assignable: d.value }))
                    }
                  >
                    <option value="">
                      {t("teams.groupAssignableDefault")}
                    </option>
                    <option value="yes">
                      {t("teams.groupAssignableAdmins")}
                    </option>
                    <option value="no">
                      {t("teams.groupAssignableOwners")}
                    </option>
                  </Select>
                </Field>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <DialogTrigger>
              <Button onClick={onClose}>{t("common.cancel")}</Button>
            </DialogTrigger>
            <Button
              appearance="primary"
              onClick={handleSave}
              disabled={saving || !form.name.trim()}
            >
              {saving ? <Spinner size="tiny" /> : t("common.save")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
