// The Rulesets card: conditional rules ("if the event matches X, send to Y
// at level Z"). The server evaluates the active ruleset INSTEAD of the
// per-event settings. One ruleset opens for editing at a time as a local
// draft; saving PUTs its rule array. Activating one deactivates any other.

import {
  Badge,
  Button,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { AddRegular, MoreHorizontalRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  type NotificationRuleset,
  type NotificationRulesetRule,
} from "../../lib/api";
import { useApi } from "../../lib/api-context";
import { SettingsCard } from "../../components/Settings";
import { ALL_EVENT_KEYS } from "./catalog";
import type { Destination } from "./destinations";
import { RuleEditor } from "./RuleEditor";
import {
  RulesetDeleteDialog,
  RulesetNameDialog,
  type NameDialogState,
} from "./RulesetDialogs";
import { useNotificationStyles } from "./styles";

const useStyles = makeStyles({
  row: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "8px",
    minHeight: "52px",
    padding: "8px var(--card-pad)",
    boxSizing: "border-box",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  name: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flex: 1,
    minWidth: 0,
  },
  editor: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "16px var(--card-pad) 20px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground2,
  },
  editorLast: {
    borderBottomLeftRadius: tokens.borderRadiusXLarge,
    borderBottomRightRadius: tokens.borderRadiusXLarge,
  },
  editorFooter: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "8px",
  },
  unsaved: {
    marginLeft: "auto",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
});

export function RulesetsCard({
  destinations,
}: {
  destinations: Destination[];
}) {
  const api = useApi();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const styles = useStyles();
  const shared = useNotificationStyles();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftRules, setDraftRules] = useState<NotificationRulesetRule[]>([]);
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<NotificationRuleset | null>(
    null,
  );
  // Compound key: the draft re-syncs whenever the open ruleset changes OR
  // the server's copy of it is newer (e.g. immediately after Save).
  const [draftSourceKey, setDraftSourceKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    intent: "success" | "error";
    text: string;
  } | null>(null);
  const showMessage = (intent: "success" | "error", text: string) => {
    setMessage({ intent, text });
    setTimeout(() => setMessage(null), 3500);
  };

  const { data } = useQuery({
    queryKey: ["notification-rulesets"],
    queryFn: () => api.listNotificationRulesets(),
  });
  const rulesets: NotificationRuleset[] = data?.rulesets ?? [];
  const editing = rulesets.find((r) => r.id === editingId) ?? null;

  const targetKey = editing ? `${editing.id}@${editing.updated_at}` : null;
  if (editing && draftSourceKey !== targetKey) {
    setDraftSourceKey(targetKey);
    setDraftRules(editing.rules);
  }
  const draftDirty =
    !!editing && JSON.stringify(draftRules) !== JSON.stringify(editing.rules);

  const onError = (err: unknown) =>
    showMessage(
      "error",
      err instanceof ApiError
        ? err.message
        : t("notifications.rulesetsSaveFailed"),
    );

  const createMut = useMutation({
    mutationFn: (body: {
      name: string;
      rules: NotificationRulesetRule[];
      is_active?: boolean;
    }) => api.createNotificationRuleset(body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["notification-rulesets"] });
      setEditingId(res.ruleset.id);
      setDraftSourceKey(null);
      showMessage("success", t("notifications.rulesetsCreated"));
    },
    onError,
  });
  const updateMut = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: {
        name?: string;
        rules?: NotificationRulesetRule[];
        is_active?: boolean;
      };
    }) => api.updateNotificationRuleset(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-rulesets"] });
      setDraftSourceKey(null);
      showMessage("success", t("notifications.rulesetsUpdated"));
    },
    onError,
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteNotificationRuleset(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-rulesets"] });
      setEditingId(null);
      setDraftSourceKey(null);
      showMessage("success", t("notifications.rulesetsDeleted"));
    },
    onError,
  });

  function submitNameDialog() {
    if (!nameDialog) return;
    const name = nameDialog.value.trim();
    if (!name) return;
    if (nameDialog.mode === "new") {
      createMut.mutate({ name, rules: [], is_active: false });
    } else if (name !== nameDialog.ruleset.name) {
      updateMut.mutate({ id: nameDialog.ruleset.id, body: { name } });
    }
    setNameDialog(null);
  }

  function patchDraftRule(
    idx: number,
    patch: Partial<NotificationRulesetRule>,
  ) {
    setDraftRules((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
  }

  function moveDraftRule(idx: number, delta: number) {
    setDraftRules((prev) => {
      const next = prev.slice();
      const target = idx + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function addDraftRule() {
    setDraftRules((prev) => [
      ...prev,
      {
        id: `r_${Math.random().toString(36).slice(2, 10)}`,
        enabled: true,
        match: { event: "*" },
        action: { type: "send", channels: [] },
      },
    ]);
  }

  return (
    <SettingsCard
      id="rulesets"
      title={t("notifications.rulesetsTitle")}
      description={t("notifications.rulesetsDesc")}
      action={
        <Button
          size="small"
          icon={<AddRegular />}
          disabled={createMut.isPending}
          onClick={() => setNameDialog({ mode: "new", value: "" })}
        >
          {t("notifications.rulesetsNew")}
        </Button>
      }
    >
      {message && (
        <div className={shared.cardNotice}>
          <MessageBar intent={message.intent}>
            <MessageBarBody>{message.text}</MessageBarBody>
          </MessageBar>
        </div>
      )}

      {rulesets.length === 0 && (
        <div className={shared.cardEmpty}>
          {t("notifications.rulesetsEmpty")}
        </div>
      )}

      {rulesets.map((rs, i) => {
        const open = rs.id === editingId;
        return (
          <div key={rs.id}>
            <div className={styles.row}>
              <div className={styles.name}>
                <Text weight="semibold" truncate wrap={false}>
                  {rs.name}
                </Text>
                {rs.is_active && (
                  <Badge appearance="tint" color="success" size="small">
                    {t("notifications.rulesetsActiveBadge")}
                  </Badge>
                )}
                <Text size={200} className={shared.muted}>
                  {t("notifications.rulesetsRuleCount", {
                    count: rs.rules.length,
                  })}
                </Text>
              </div>
              <Button
                size="small"
                appearance="subtle"
                onClick={() => setEditingId(open ? null : rs.id)}
              >
                {open ? t("common.close") : t("common.edit")}
              </Button>
              <Button
                size="small"
                disabled={updateMut.isPending}
                onClick={() =>
                  updateMut.mutate({
                    id: rs.id,
                    body: { is_active: !rs.is_active },
                  })
                }
              >
                {rs.is_active
                  ? t("notifications.rulesetsDeactivate")
                  : t("notifications.rulesetsActivate")}
              </Button>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <Button
                    size="small"
                    appearance="subtle"
                    icon={<MoreHorizontalRegular />}
                    aria-label={rs.name}
                  />
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem
                      onClick={() =>
                        setNameDialog({
                          mode: "rename",
                          ruleset: rs,
                          value: rs.name,
                        })
                      }
                    >
                      {t("notifications.rulesetsRename")}
                    </MenuItem>
                    <MenuItem
                      disabled={deleteMut.isPending}
                      onClick={() => setDeleteDialog(rs)}
                    >
                      {t("notifications.rulesetsDelete")}
                    </MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
            </div>

            {open && editing && (
              <div
                className={mergeClasses(
                  styles.editor,
                  i === rulesets.length - 1 && styles.editorLast,
                )}
              >
                {draftRules.length === 0 && (
                  <Text size={200} className={shared.muted}>
                    {t("notifications.rulesetsRulesEmpty")}
                  </Text>
                )}
                {draftRules.map((rule, idx) => (
                  <RuleEditor
                    key={rule.id}
                    index={idx}
                    rule={rule}
                    destinations={destinations}
                    knownEvents={ALL_EVENT_KEYS}
                    isFirst={idx === 0}
                    isLast={idx === draftRules.length - 1}
                    onPatch={(p) => patchDraftRule(idx, p)}
                    onMove={(d) => moveDraftRule(idx, d)}
                    onDelete={() =>
                      setDraftRules((prev) => prev.filter((_, j) => j !== idx))
                    }
                  />
                ))}
                <div className={styles.editorFooter}>
                  <Button
                    size="small"
                    icon={<AddRegular />}
                    onClick={addDraftRule}
                  >
                    {t("notifications.rulesetsAddRule")}
                  </Button>
                  {draftDirty && (
                    <span className={styles.unsaved}>
                      {t("notifications.rulesetsUnsaved")}
                    </span>
                  )}
                  <Button
                    size="small"
                    style={draftDirty ? undefined : { marginLeft: "auto" }}
                    disabled={!draftDirty || updateMut.isPending}
                    onClick={() => setDraftRules(editing.rules)}
                  >
                    {t("common.discard")}
                  </Button>
                  <Button
                    size="small"
                    appearance="primary"
                    disabled={!draftDirty || updateMut.isPending}
                    onClick={() =>
                      updateMut.mutate({
                        id: editing.id,
                        body: { rules: draftRules },
                      })
                    }
                  >
                    {updateMut.isPending ? (
                      <Spinner size="tiny" />
                    ) : (
                      t("common.saveChanges")
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <RulesetNameDialog
        state={nameDialog}
        onChange={setNameDialog}
        onSubmit={submitNameDialog}
        onClose={() => setNameDialog(null)}
      />
      <RulesetDeleteDialog
        ruleset={deleteDialog}
        onConfirm={(rs) => deleteMut.mutate(rs.id)}
        onClose={() => setDeleteDialog(null)}
      />
    </SettingsCard>
  );
}
