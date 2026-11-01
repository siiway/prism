// Field groups for the notice form, shared by the new-notice page and a
// notice's own page: what it says (with a preview through the reader's own
// component) and who sees it when.

import {
  Combobox,
  Field,
  Input,
  Option,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { NoticeAudience, NoticeLevel } from "../../../lib/api";
import { useApi } from "../../../lib/api-context";
import { useDebouncedSearch } from "../../../lib/useDebouncedSearch";
import { NoticeBar } from "../../../components/NoticeBoard";
import { Select } from "../../../components/Select";
import { AUDIENCES, LEVELS, type NoticeForm } from "./noticeForm";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: "16px" },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    alignItems: "start",
    gap: "16px",
    "@media (max-width: 600px)": { gridTemplateColumns: "1fr" },
  },
  body: { minHeight: "160px" },
  previewLabel: { color: tokens.colorNeutralForeground3 },
  preview: { display: "flex", flexDirection: "column", gap: "6px" },
  optionSub: { color: tokens.colorNeutralForeground3 },
});

type Errors = Partial<Record<keyof NoticeForm, string>>;

interface FieldsProps {
  form: NoticeForm;
  onChange: (patch: Partial<NoticeForm>) => void;
  /** Problems to show under the fields. */
  errors?: Errors;
  autoFocus?: boolean;
}

const fieldState = (error: string | undefined, hint?: string) =>
  error
    ? { validationState: "error" as const, validationMessage: error }
    : { hint };

/** Title, body and level, with the notice as readers will see it. */
export function ContentFields({
  form,
  onChange,
  errors = {},
  autoFocus,
}: FieldsProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <div className={styles.stack}>
      <div className={styles.grid}>
        <Field
          label={t("admin.noticeTitle")}
          required
          {...fieldState(errors.title)}
        >
          <Input
            autoFocus={autoFocus}
            autoComplete="off"
            maxLength={120}
            value={form.title}
            onChange={(_, d) => onChange({ title: d.value })}
          />
        </Field>
        <Field label={t("admin.noticeLevel")}>
          <Select
            value={form.level}
            onChange={(_, d) => onChange({ level: d.value as NoticeLevel })}
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {t(`admin.noticeLevel_${l}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field
        label={t("admin.noticeBody")}
        required
        {...fieldState(errors.body, t("admin.noticeBodyHint"))}
      >
        <Textarea
          className={styles.body}
          resize="vertical"
          value={form.body}
          onChange={(_, d) => onChange({ body: d.value })}
        />
      </Field>
      {(form.title.trim() || form.body.trim()) && (
        <div className={styles.preview}>
          <Text size={200} className={styles.previewLabel}>
            {t("admin.noticePreview")}
          </Text>
          <NoticeBar
            notice={{
              title: form.title,
              body: form.body,
              level: form.level,
              team_name:
                form.audience === "team" ? form.team_name || null : null,
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Audience (and the team, for a team notice) and the display window. */
export function AudienceFields({ form, onChange, errors = {} }: FieldsProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <div className={styles.stack}>
      <Field
        label={t("admin.noticeAudience")}
        hint={t(`admin.noticeAudienceHint_${form.audience}`)}
      >
        <Select
          value={form.audience}
          onChange={(_, d) => onChange({ audience: d.value as NoticeAudience })}
        >
          {AUDIENCES.map((a) => (
            <option key={a} value={a}>
              {t(`admin.noticeAudience_${a}`)}
            </option>
          ))}
        </Select>
      </Field>
      {form.audience === "team" && (
        <Field
          label={t("admin.noticeTeam")}
          required
          {...fieldState(errors.team_id)}
        >
          <TeamPicker
            teamId={form.team_id}
            teamName={form.team_name}
            onChange={(team_id, team_name) => onChange({ team_id, team_name })}
          />
        </Field>
      )}
      <div className={styles.grid}>
        <Field
          label={t("admin.noticeStarts")}
          {...fieldState(errors.starts, t("admin.noticeStartsHint"))}
        >
          <Input
            type="datetime-local"
            value={form.starts}
            onChange={(_, d) => onChange({ starts: d.value })}
          />
        </Field>
        <Field
          label={t("admin.noticeEnds")}
          {...fieldState(errors.ends, t("admin.noticeEndsHint"))}
        >
          <Input
            type="datetime-local"
            value={form.ends}
            onChange={(_, d) => onChange({ ends: d.value })}
          />
        </Field>
      </div>
    </div>
  );
}

/** Find a team by name instead of pasting its ID. */
function TeamPicker({
  teamId,
  teamName,
  onChange,
}: {
  teamId: string;
  teamName: string;
  onChange: (id: string, name: string) => void;
}) {
  const api = useApi();
  const styles = useStyles();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { query, setQuery, search } = useDebouncedSearch();

  // Show the chosen team's name, including after a discard elsewhere.
  useEffect(() => setQuery(teamName), [teamName, setQuery]);

  // Typing the chosen team's own name back isn't a search for it.
  const term = search === teamName ? "" : search;
  const { data, isFetching } = useQuery({
    queryKey: ["admin", "teams", "pick", term],
    queryFn: () => api.adminListTeams(1, term),
    enabled: open,
    staleTime: 30_000,
  });
  const teams = data?.teams ?? [];

  return (
    <Combobox
      value={query}
      selectedOptions={teamId ? [teamId] : []}
      placeholder={t("admin.noticeTeamSearch")}
      open={open}
      onOpenChange={(_, d) => {
        setOpen(d.open);
        // Leaving with a half-typed search goes back to the chosen team.
        if (!d.open) setQuery(teamName);
      }}
      onChange={(e) => {
        setQuery(e.target.value);
        setOpen(true);
      }}
      onOptionSelect={(_, d) => {
        if (!d.optionValue) return;
        onChange(d.optionValue, d.optionText ?? "");
        setQuery(d.optionText ?? "");
      }}
    >
      {teams.map((team) => (
        <Option key={team.id} value={team.id} text={team.name}>
          <span>
            {team.name}
            {team.owner_username && (
              <Text size={200} className={styles.optionSub}>
                {" "}
                @{team.owner_username}
              </Text>
            )}
          </span>
        </Option>
      ))}
      {teams.length === 0 && (
        <Option value="" text="" disabled>
          {isFetching ? t("common.loading") : t("admin.noticeTeamNone")}
        </Option>
      )}
    </Combobox>
  );
}
