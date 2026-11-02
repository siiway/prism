// A made-up event to run rules against: the rule page's Test and the
// ruleset page's Trace. The fields mirror what a real event carries (see
// buildRuleContext); time is UTC, like at dispatch.

import { Field, Input, makeStyles } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import { Select } from "../../components/Select";
import { ALL_EVENT_KEYS, EVENT_GROUPS } from "./catalog";
import { FIELD_LABEL_KEYS, valueChoices } from "./ruleFields";
import type { Sample } from "./sample";
import { NARROW } from "./styles";

const useStyles = makeStyles({
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "12px 16px",
    [NARROW]: { gridTemplateColumns: "minmax(0, 1fr)" },
  },
});

const EVENT_LABELS = new Map(
  EVENT_GROUPS.flatMap((g) => g.events.map((e) => [e.value, e.labelKey])),
);

export function SampleEventFields({
  sample,
  onChange,
}: {
  sample: Sample;
  onChange: (next: Sample) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const set = (patch: Partial<Sample>) => onChange({ ...sample, ...patch });
  const text = (
    key: keyof Sample,
    field: keyof typeof FIELD_LABEL_KEYS,
    placeholder?: string,
  ) => (
    <Field label={t(FIELD_LABEL_KEYS[field])}>
      <Input
        value={sample[key]}
        placeholder={placeholder}
        onChange={(_, d) => set({ [key]: d.value })}
      />
    </Field>
  );
  return (
    <div className={styles.grid}>
      <Field label={t(FIELD_LABEL_KEYS.event)}>
        <Select
          value={sample.event}
          onChange={(_, d) => set({ event: d.value })}
        >
          {ALL_EVENT_KEYS.map((ev) => (
            <option key={ev} value={ev}>
              {`${t(EVENT_LABELS.get(ev) ?? ev)} (${ev})`}
            </option>
          ))}
        </Select>
      </Field>
      {text("resource", "resource.name")}
      {text("ip", "ip.src", "203.0.113.7")}
      {text("country", "ip.src.country", "US")}
      {text("userAgent", "http.user_agent")}
      {text("scopes", "oauth.scopes", "openid, profile")}
      {text("changed", "profile.changed_fields", "email")}
      {text("hour", "time.hour", "0–23")}
      <Field label={t(FIELD_LABEL_KEYS["time.weekday"])}>
        <Select
          value={sample.weekday}
          onChange={(_, d) => set({ weekday: d.value })}
        >
          {valueChoices("time.weekday", "eq")!.map((c) => (
            <option key={c.value} value={c.value}>
              {t(c.labelKey!)}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
