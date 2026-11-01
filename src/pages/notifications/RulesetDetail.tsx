// One ruleset's page (/notifications/rulesets/:id): its status, its name,
// its rules in order (each opening its own page), a trace to try the rules
// on a made-up event, and deleting it. Status, rule changes from the list,
// and deleting apply at once; the name has its own Save.

import {
  Button,
  Field,
  Input,
  Spinner,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { ArrowLeftRegular, FilterRegular } from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiErrorText } from "../../lib/apiError";
import { useApi } from "../../lib/api-context";
import { setDocumentPageTitle } from "../../lib/documentTitle";
import { useConfirm } from "../../lib/useConfirm";
import { useToastMessage } from "../../lib/useToastMessage";
import { EmptyState } from "../../components/EmptyState";
import { Segmented } from "../../components/Segmented";
import {
  SettingsBody,
  SettingsCard,
  SettingsFooter,
  SettingsPage,
  SettingsToast,
} from "../../components/Settings";
import { SkeletonSettingsCard } from "../../components/Skeletons";
import { RulesCard } from "./RulesCard";
import { TraceCard } from "./TraceCard";
import { useDestinations } from "./useDestinations";
import { useRuleset } from "./useRuleset";

const LIST_PATH = "/notifications#rulesets";

const useStyles = makeStyles({
  back: {
    alignSelf: "flex-start",
    marginLeft: "-8px",
    color: tokens.colorNeutralForeground3,
  },
  title: {
    overflowWrap: "anywhere",
  },
  danger: { color: tokens.colorPaletteRedForeground1 },
});

type Status = "active" | "inactive";

export function RulesetDetail() {
  const api = useApi();
  const styles = useStyles();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { message, showMsg } = useToastMessage();
  const { confirm, confirmDialog } = useConfirm();
  const { id = "" } = useParams<{ id: string }>();
  const { ruleset, isLoading, saveRules } = useRuleset(id);
  const { destinations } = useDestinations();

  useEffect(() => {
    if (!ruleset?.name) return;
    setDocumentPageTitle(ruleset.name);
    return () => setDocumentPageTitle(null);
  }, [ruleset?.name]);

  // The name is a draft; it re-syncs when the saved name changes.
  const [name, setName] = useState("");
  const [syncedName, setSyncedName] = useState<string | null>(null);
  if (ruleset && ruleset.name !== syncedName) {
    setSyncedName(ruleset.name);
    setName(ruleset.name);
  }

  const fail = (err: unknown) =>
    showMsg("error", apiErrorText(err, t("notifications.rulesetsSaveFailed")));

  // One change at a time.
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };
  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["notification-rulesets"] });

  const setStatus = (status: Status) =>
    run("status", async () => {
      await api.updateNotificationRuleset(id, {
        is_active: status === "active",
      });
      await refresh();
      showMsg(
        "success",
        status === "active"
          ? t("notifications.rulesetActivated")
          : t("notifications.rulesetDeactivated"),
      );
    });

  const saveName = () =>
    run("name", async () => {
      await api.updateNotificationRuleset(id, { name: name.trim() });
      await refresh();
      showMsg("success", t("notifications.rulesetsUpdated"));
    });

  const remove = async () => {
    if (!ruleset || busy) return;
    const ok = await confirm({
      title: t("notifications.rulesetsDeleteConfirm", { name: ruleset.name }),
      body: t("notifications.rulesetDeleteDesc"),
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    await run("delete", async () => {
      await api.deleteNotificationRuleset(id);
      await refresh();
      navigate(LIST_PATH, { replace: true });
    });
  };

  const back = (
    <Button
      appearance="subtle"
      size="small"
      icon={<ArrowLeftRegular />}
      className={styles.back}
      onClick={() => navigate(LIST_PATH)}
    >
      {t("notifications.title")}
    </Button>
  );

  if (isLoading) {
    return (
      <SettingsPage>
        {back}
        <SkeletonSettingsCard rows={3} />
      </SettingsPage>
    );
  }

  if (!ruleset) {
    return (
      <SettingsPage>
        {back}
        <EmptyState
          icon={<FilterRegular />}
          title={t("notifications.rulesetNotFound")}
        />
      </SettingsPage>
    );
  }

  const nameChanged = name.trim() !== ruleset.name;

  return (
    <SettingsPage>
      {back}
      <Title2 as="h1" className={styles.title}>
        {ruleset.name}
      </Title2>

      <SettingsToast message={message} />

      <SettingsCard
        id="status"
        title={t("notifications.rulesetStatusTitle")}
        description={t("notifications.rulesetStatusDesc")}
        action={
          <Segmented<Status>
            label={t("notifications.rulesetStatusTitle")}
            value={ruleset.is_active ? "active" : "inactive"}
            disabled={busy !== null}
            options={[
              {
                value: "active",
                label: t("notifications.rulesetActive"),
                brand: true,
              },
              {
                value: "inactive",
                label: t("notifications.rulesetInactive"),
              },
            ]}
            onChange={(s) => void setStatus(s)}
          />
        }
      />

      <RulesCard
        rulesetId={id}
        rules={ruleset.rules}
        destinations={destinations}
        saveRules={saveRules}
        onError={fail}
        confirmDelete={(ruleName) =>
          confirm({
            title: t("notifications.rule.deleteConfirm", { name: ruleName }),
            confirmLabel: t("common.delete"),
          })
        }
      />

      <TraceCard rules={ruleset.rules} destinations={destinations} />

      <SettingsCard id="name" title={t("notifications.rulesetName")}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (nameChanged && name.trim()) void saveName();
          }}
        >
          <SettingsBody>
            <Field>
              <Input
                aria-label={t("notifications.rulesetName")}
                maxLength={64}
                value={name}
                onChange={(_, d) => setName(d.value)}
              />
            </Field>
          </SettingsBody>
          <SettingsFooter>
            <Button
              type="submit"
              appearance="primary"
              disabled={!nameChanged || !name.trim() || busy !== null}
            >
              {busy === "name" ? <Spinner size="tiny" /> : t("common.save")}
            </Button>
          </SettingsFooter>
        </form>
      </SettingsCard>

      <SettingsCard
        id="delete"
        title={t("notifications.rulesetDeleteTitle")}
        description={t("notifications.rulesetDeleteDesc")}
        action={
          <Button
            size="small"
            className={styles.danger}
            disabled={busy !== null}
            onClick={() => void remove()}
          >
            {busy === "delete" ? <Spinner size="tiny" /> : t("common.delete")}
          </Button>
        }
      />
      {confirmDialog}
    </SettingsPage>
  );
}
