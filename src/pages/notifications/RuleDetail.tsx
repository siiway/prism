// A ruleset rule's page: /notifications/rulesets/:id/rules/new and
// /notifications/rulesets/:id/rules/:ruleId. Laid out like a Cloudflare
// rule: a name and status, "When events match…" (builder or expression),
// "Then…" (send or mute), where it sits in the ruleset, and a live test
// against a sample event. Saving writes the whole ruleset.

import {
  Button,
  Field,
  Input,
  Spinner,
  Text,
  Title2,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowLeftRegular,
  CheckmarkCircleRegular,
  DismissCircleRegular,
  FilterRegular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ruleMatches } from "../../../shared/notificationRules";
import { type NotificationRulesetRule } from "../../lib/api";
import { apiErrorText } from "../../lib/apiError";
import { setDocumentPageTitle } from "../../lib/documentTitle";
import { useConfirm } from "../../lib/useConfirm";
import { useToastMessage } from "../../lib/useToastMessage";
import { EmptyState } from "../../components/EmptyState";
import { Segmented } from "../../components/Segmented";
import { Select } from "../../components/Select";
import {
  SettingsBody,
  SettingsCard,
  SettingsPage,
  SettingsToast,
} from "../../components/Settings";
import { SkeletonSettingsCard } from "../../components/Skeletons";
import { ActionCard } from "./ActionCard";
import { MatchCard } from "./MatchCard";
import {
  newRuleId,
  newRuleState,
  ruleToState,
  stateToRule,
  type RuleEditState,
} from "./ruleEdit";
import { newSample, sampleContext } from "./sample";
import { SampleEventFields } from "./SampleEvent";
import { useDestinations } from "./useDestinations";
import { useRuleset } from "./useRuleset";

const useStyles = makeStyles({
  back: {
    alignSelf: "flex-start",
    marginLeft: "-8px",
    color: tokens.colorNeutralForeground3,
  },
  title: { overflowWrap: "anywhere" },
  result: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontWeight: tokens.fontWeightSemibold,
    "& svg": { fontSize: "18px", flexShrink: 0 },
  },
  match: { color: tokens.colorStatusSuccessForeground1 },
  noMatch: { color: tokens.colorNeutralForeground3 },
  bad: { color: tokens.colorPaletteRedForeground1 },
  // Save stays in reach on a long page.
  bar: {
    position: "sticky",
    bottom: 0,
    zIndex: 2,
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    padding: "12px 0",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    // The page's own canvas, so the bar reads as part of the page rather
    // than a card of its own; the hairline separates it from content
    // scrolling underneath.
    background: "var(--prism-canvas)",
  },
  danger: { color: tokens.colorPaletteRedForeground1 },
});

type Placement = "first" | "last" | `after:${string}`;

export function RuleDetail() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { message, showMsg } = useToastMessage();
  const { confirm, confirmDialog } = useConfirm();
  const { id = "", ruleId } = useParams<{ id: string; ruleId?: string }>();
  const isNew = !ruleId;
  const { ruleset, isLoading, saveRules } = useRuleset(id);
  const { destinations } = useDestinations();
  const rulesetPath = `/notifications/rulesets/${id}`;

  const rules = ruleset?.rules ?? [];
  const index = isNew ? -1 : rules.findIndex((r) => r.id === ruleId);
  const existing = index >= 0 ? rules[index] : undefined;
  // By position, so a ruleset that already has duplicate ids can't lose the
  // rule's twin when this one is saved.
  const others = rules.filter((_, i) => i !== index);
  const defaultPlacement: Placement =
    index > 0 ? `after:${rules[index - 1].id}` : index === 0 ? "first" : "last";

  // Seed the form once the rule is known; later refetches don't reset it.
  const [state, setState] = useState<RuleEditState | null>(null);
  const [placement, setPlacement] = useState<Placement>("last");
  if (state === null && ruleset && (isNew || existing)) {
    setState(existing ? ruleToState(existing) : newRuleState());
    setPlacement(defaultPlacement);
  }
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sample, setSample] = useState(newSample);

  const ruleLabel = (r: NotificationRulesetRule, i: number) =>
    r.name || t("notifications.rule.untitled", { n: i + 1 });
  const title = isNew
    ? t("notifications.rule.newTitle")
    : existing
      ? ruleLabel(existing, index)
      : "";

  useEffect(() => {
    if (!title) return;
    setDocumentPageTitle(title);
    return () => setDocumentPageTitle(null);
  }, [title]);

  const back = (
    <Button
      appearance="subtle"
      size="small"
      icon={<ArrowLeftRegular />}
      className={styles.back}
      onClick={() => navigate(rulesetPath)}
    >
      {ruleset?.name ?? t("notifications.title")}
    </Button>
  );

  if (isLoading) {
    return (
      <SettingsPage>
        {back}
        <SkeletonSettingsCard rows={4} />
      </SettingsPage>
    );
  }

  if (!ruleset || (!isNew && !existing) || !state) {
    return (
      <SettingsPage>
        {back}
        <EmptyState
          icon={<FilterRegular />}
          title={
            ruleset
              ? t("notifications.rule.notFound")
              : t("notifications.rulesetNotFound")
          }
        />
      </SettingsPage>
    );
  }

  const fail = (err: unknown) =>
    showMsg("error", apiErrorText(err, t("notifications.rulesetsSaveFailed")));

  const save = async () => {
    if (saving) return;
    const ruleIdToSave = ruleId ?? newRuleId();
    const built = stateToRule(ruleIdToSave, state);
    if (built.error) {
      setShowErrors(true);
      showMsg("error", t("notifications.rule.fixErrors"));
      return;
    }
    const next = others.slice();
    const at =
      placement === "first"
        ? 0
        : placement === "last"
          ? next.length
          : next.findIndex((r) => `after:${r.id}` === placement) + 1;
    next.splice(at, 0, built.rule);
    setSaving(true);
    try {
      await saveRules(next);
      navigate(rulesetPath);
    } catch (err) {
      fail(err);
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await confirm({
      title: t("notifications.rule.deleteConfirm", {
        name: ruleLabel(existing, index),
      }),
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    try {
      await saveRules(others);
      navigate(rulesetPath, { replace: true });
    } catch (err) {
      fail(err);
    }
  };

  // Live test of this rule's condition against the sample event.
  const draft = stateToRule(ruleId ?? "draft", {
    ...state,
    action: { ...state.action, type: "drop", muteAll: true },
  });
  const testResult = draft.error
    ? "invalid"
    : ruleMatches(draft.rule, sampleContext(sample))
      ? "match"
      : "no_match";

  return (
    <SettingsPage>
      {back}
      <Title2 as="h1" className={styles.title}>
        {title}
      </Title2>
      <SettingsToast message={message} />

      <SettingsCard
        id="rule"
        title={t("notifications.rule.ruleTitle")}
        description={t("notifications.rule.ruleDesc")}
        action={
          <Segmented<"on" | "off">
            label={t("notifications.rule.status")}
            value={state.enabled ? "on" : "off"}
            options={[
              {
                value: "on",
                label: t("notifications.rule.enabled"),
                brand: true,
              },
              { value: "off", label: t("notifications.rule.disabled") },
            ]}
            onChange={(v) => setState({ ...state, enabled: v === "on" })}
          />
        }
      >
        <SettingsBody>
          <Field label={t("notifications.rule.name")}>
            <Input
              maxLength={64}
              value={state.name}
              placeholder={t("notifications.rule.namePlaceholder")}
              onChange={(_, d) => setState({ ...state, name: d.value })}
            />
          </Field>
        </SettingsBody>
      </SettingsCard>

      <MatchCard
        state={state.match}
        showErrors={showErrors}
        onChange={(match) => setState({ ...state, match })}
      />

      <ActionCard
        state={state.action}
        destinations={destinations}
        showErrors={showErrors}
        onChange={(action) => setState({ ...state, action })}
      />

      {others.length > 0 && (
        <SettingsCard
          id="placement"
          title={t("notifications.rule.placeTitle")}
          description={t("notifications.rule.placeDesc")}
        >
          <SettingsBody>
            <Field label={t("notifications.rule.placeAt")}>
              <Select
                value={placement}
                onChange={(_, d) => setPlacement(d.value as Placement)}
              >
                <option value="first">
                  {t("notifications.rule.placeFirst")}
                </option>
                {others.map((r) => (
                  <option key={r.id} value={`after:${r.id}`}>
                    {t("notifications.rule.placeAfter", {
                      name: ruleLabel(r, rules.indexOf(r)),
                    })}
                  </option>
                ))}
                <option value="last">
                  {t("notifications.rule.placeLast")}
                </option>
              </Select>
            </Field>
          </SettingsBody>
        </SettingsCard>
      )}

      <SettingsCard
        id="test"
        title={t("notifications.rule.testTitle")}
        description={t("notifications.rule.testDesc")}
      >
        <SettingsBody>
          <SampleEventFields sample={sample} onChange={setSample} />
          <Text
            className={mergeClasses(
              styles.result,
              testResult === "match"
                ? styles.match
                : testResult === "no_match"
                  ? styles.noMatch
                  : styles.bad,
            )}
            role="status"
          >
            {testResult === "match" ? (
              <CheckmarkCircleRegular />
            ) : (
              <DismissCircleRegular />
            )}
            {t(`notifications.rule.test_${testResult}`)}
          </Text>
        </SettingsBody>
      </SettingsCard>

      {existing && (
        <SettingsCard
          id="delete"
          title={t("notifications.rule.deleteTitle")}
          description={t("notifications.rule.deleteDesc")}
          action={
            <Button
              size="small"
              className={styles.danger}
              onClick={() => void remove()}
            >
              {t("common.delete")}
            </Button>
          }
        />
      )}

      <div className={styles.bar}>
        <Button onClick={() => navigate(rulesetPath)}>
          {t("common.cancel")}
        </Button>
        <Button
          appearance="primary"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? <Spinner size="tiny" /> : t("notifications.rule.save")}
        </Button>
      </div>
      {confirmDialog}
    </SettingsPage>
  );
}
