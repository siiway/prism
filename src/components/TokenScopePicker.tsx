// Permission picker for personal access tokens. Instead of a wall of raw
// scope checkboxes, each resource gets one row with an access level (No
// access / Read / Read & write / Full); a level stands for a fixed set of
// scopes. The raw scopes stay visible underneath for people who need them.
//
// The levels and their scopes live in lib/tokenScopes.

import { Switch, Text, makeStyles, tokens } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import {
  RESOURCES,
  scopesFor,
  type LevelId,
  type Resource,
  type ScopeLevels,
} from "../lib/tokenScopes";
import { Segmented } from "./Segmented";
import { SettingsRow, SettingsSubhead } from "./Settings";

const useStyles = makeStyles({
  box: {
    "--card-pad": "16px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusLarge,
    overflow: "hidden",
    "& > :first-child": { borderTopStyle: "none" },
  },
  summary: {
    display: "block",
    marginTop: "8px",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  mono: {
    fontFamily: tokens.fontFamilyMonospace,
    overflowWrap: "anywhere",
  },
});

interface Props {
  value: ScopeLevels;
  onChange: (next: ScopeLevels) => void;
  /** Show the site-administration rows. */
  isAdmin: boolean;
}

export function TokenScopePicker({ value, onChange, isAdmin }: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  const scopes = scopesFor(value);

  const levelLabel = (id: LevelId) =>
    id === "none"
      ? t("tokens.levelNone")
      : id === "read"
        ? t("tokens.levelRead")
        : id === "write"
          ? t("tokens.levelWrite")
          : t("tokens.levelFull");

  const row = (r: Resource) => {
    const current = value[r.id] ?? "none";
    const set = (level: LevelId) => onChange({ ...value, [r.id]: level });
    const label = t(`tokens.perm.${r.id}`);
    return (
      <SettingsRow
        key={r.id}
        label={label}
        description={t(`tokens.perm.${r.id}Desc`)}
      >
        {r.levels.length === 2 && r.levels[1].id === "on" ? (
          <Switch
            aria-label={label}
            checked={current === "on"}
            onChange={(_, d) => set(d.checked ? "on" : "none")}
          />
        ) : (
          <Segmented
            label={label}
            value={current}
            options={r.levels.map((l) => ({
              value: l.id,
              label: levelLabel(l.id),
              brand: l.id !== "none",
            }))}
            onChange={set}
          />
        )}
      </SettingsRow>
    );
  };

  const groups = (["account", "resources", "admin"] as const).filter(
    (g) => g !== "admin" || isAdmin,
  );

  return (
    <div>
      <div className={styles.box}>
        {groups.map((g) => [
          <SettingsSubhead key={g}>{t(`tokens.group.${g}`)}</SettingsSubhead>,
          ...RESOURCES.filter((r) => r.group === g).map(row),
        ])}
      </div>
      <Text className={styles.summary}>
        {scopes.length === 0 ? (
          t("tokens.noScopesSelected")
        ) : (
          <>
            {t("tokens.scopesSummary", { count: scopes.length })}{" "}
            <span className={styles.mono}>{scopes.join(" ")}</span>
          </>
        )}
      </Text>
    </div>
  );
}
