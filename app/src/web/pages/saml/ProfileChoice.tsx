// Which SAML profile an app gets at the first sign-in to it: a new per-app
// ID, or one of the user's shared profiles. The privacy choice (new or
// shared) is two radios; the shared profile itself is a searchable combobox,
// so the page stays the same height however many the user has.

import {
  Combobox,
  Link,
  Option,
  Radio,
  RadioGroup,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SamlProfileSummary } from "../../lib/api";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "4px" },
  choice: { display: "flex", flexDirection: "column" },
  muted: { color: tokens.colorNeutralForeground3 },
  // Lined up with the radio labels above.
  picker: { paddingLeft: "32px", paddingBottom: "8px" },
  combobox: { width: "100%", minWidth: 0, boxSizing: "border-box" },
  // Fluent's autoSize sets an inline max-height of all the room there is;
  // a few rows at a time keeps the page around it in view.
  listbox: { maxHeight: "320px !important" },
  profileId: {
    color: tokens.colorNeutralForeground3,
    fontFamily: tokens.fontFamilyMonospace,
    overflowWrap: "anywhere",
  },
});

/** "new", or the ID of the shared profile chosen. */
export function ProfileChoice({
  appName,
  profiles,
  value,
  onChange,
}: {
  appName: string;
  profiles: SamlProfileSummary[];
  value: string;
  onChange: (value: string) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  // The shared profile picked in the combobox, kept while "new" is selected.
  const [sharedId, setSharedId] = useState(profiles[0]?.id ?? "");
  const sharedName = profiles.find((p) => p.id === sharedId)?.name ?? "";
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const q = query.trim().toLowerCase();
  // Closed, the combobox shows the chosen name; open, what's typed, which
  // filters the list once it differs from that name.
  const shown =
    query === sharedName
      ? profiles
      : profiles.filter(
          (p) => p.name?.toLowerCase().includes(q) || p.name_id.includes(q),
        );
  const title = t("saml.profileTitle", { appName });

  return (
    <div className={styles.root}>
      <Text weight="semibold" block>
        {title}
      </Text>
      <RadioGroup
        value={value === "new" ? "new" : "shared"}
        onChange={(_, d) => onChange(d.value === "new" ? "new" : sharedId)}
        aria-label={title}
      >
        <Radio
          value="new"
          label={
            <span className={styles.choice}>
              {t("saml.profileNew", { appName })}
              <Text size={200} className={styles.muted}>
                {t("saml.profileNewHint", { appName })}
              </Text>
            </span>
          }
        />
        <Radio
          value="shared"
          label={
            <span className={styles.choice}>
              {t("saml.profileShared")}
              <Text size={200} className={styles.muted}>
                {t("saml.profileSharedHint")}
              </Text>
            </span>
          }
        />
      </RadioGroup>
      <div className={styles.picker}>
        <Combobox
          className={styles.combobox}
          listbox={{ className: styles.listbox }}
          value={open ? query : sharedName}
          selectedOptions={sharedId ? [sharedId] : []}
          placeholder={t("saml.profileSearch")}
          aria-label={t("saml.profileSearch")}
          open={open}
          onOpenChange={(_, d) => {
            setOpen(d.open);
            // Each opening starts from the chosen name, not an old search.
            if (d.open) setQuery(sharedName);
          }}
          onFocus={() => onChange(sharedId)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onOptionSelect={(_, d) => {
            if (!d.optionValue) return;
            setSharedId(d.optionValue);
            onChange(d.optionValue);
          }}
        >
          {shown.map((p) => (
            <Option key={p.id} value={p.id} text={p.name ?? p.name_id}>
              <span className={styles.choice}>
                {p.name}
                <Text size={200} className={styles.profileId}>
                  {p.name_id}
                </Text>
              </span>
            </Option>
          ))}
          {shown.length === 0 && (
            <Option disabled value="" text="">
              {t("saml.profileNoMatch")}
            </Option>
          )}
        </Combobox>
      </div>
      <Text size={200} className={styles.muted} block>
        {t("saml.profileKept", { appName })}{" "}
        <Link href="/saml-profiles" target="_blank" rel="noreferrer">
          {t("saml.manageProfiles")}
        </Link>
      </Text>
    </div>
  );
}
