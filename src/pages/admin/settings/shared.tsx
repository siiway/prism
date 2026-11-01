// What the admin settings sections share: the config draft that the save
// bar saves, the rows most settings are made of, and error handling.

import { Checkbox } from "@fluentui/react-components";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../../lib/api";
import { useToastMessage } from "../../../lib/useToastMessage";
import { type SiteConfig } from "../../../types";
import { Segmented } from "../../../components/Segmented";
import { SettingsRow } from "../../../components/Settings";
import { NumberInput } from "./fields";

/** A copy of `obj` without `key`. */
export function dropKey<T extends object>(obj: T, key: string): T {
  const next = { ...obj };
  delete next[key as keyof T];
  return next;
}

/** The unsaved edits to the site config, shared by every section that saves
 *  from the save bar, so switching sections keeps them. */
export function useConfigDraft(config: SiteConfig | undefined) {
  const [localConfig, setLocalConfig] = useState<Partial<SiteConfig>>({});

  const get = <K extends keyof SiteConfig>(key: K): SiteConfig[K] => {
    if (key in localConfig) return localConfig[key] as SiteConfig[K];
    return config?.[key] as SiteConfig[K];
  };

  const set = (key: keyof SiteConfig, value: unknown) =>
    setLocalConfig((c) => ({ ...c, [key]: value }));

  /** A boolean setting, with the default for a config row that predates it. */
  const flag = (key: keyof SiteConfig, fallback = false): boolean =>
    (get(key) as boolean | null | undefined) ?? fallback;

  /** A numeric setting, with the default for a config row that predates it. */
  const num = (key: keyof SiteConfig, fallback: number): number =>
    (get(key) as number | null | undefined) ?? fallback;

  return {
    get,
    set,
    flag,
    num,
    localConfig,
    dirty: Object.keys(localConfig).length > 0,
    reset: () => setLocalConfig({}),
  };
}

export type ConfigDraft = ReturnType<typeof useConfigDraft>;

export interface SectionProps {
  draft: ConfigDraft;
  showMsg: ReturnType<typeof useToastMessage>["showMsg"];
}

/** Show an API error's message, or a fallback for anything else. */
export function useFail(showMsg: SectionProps["showMsg"]) {
  const { t } = useTranslation();
  return (err: unknown, fallback: string) =>
    showMsg("error", err instanceof ApiError ? err.message : t(fallback));
}

/** Rows most sections are built from, bound to the draft. */
export function useSettingRows({ set, flag, num }: ConfigDraft) {
  const { t } = useTranslation();

  /** A row holding one number setting. */
  const numberRow = (
    key: keyof SiteConfig,
    fallback: number,
    labelKey: string,
    opts: {
      descKey?: string;
      unit?: string;
      min?: number;
      max?: number;
    } = {},
  ) => (
    <SettingsRow
      label={t(labelKey)}
      description={opts.descKey ? t(opts.descKey) : undefined}
    >
      <NumberInput
        label={t(labelKey)}
        value={num(key, fallback)}
        onChange={(n) => set(key, n)}
        unit={opts.unit}
        min={opts.min}
        max={opts.max}
      />
    </SettingsRow>
  );

  /** One checkbox bound to a boolean setting. */
  const check = (
    key: keyof SiteConfig,
    labelKey: string,
    fallback: boolean,
  ) => (
    <Checkbox
      key={key}
      label={t(labelKey)}
      checked={flag(key, fallback)}
      onChange={(_, d) => set(key, !!d.checked)}
    />
  );

  const unit = {
    days: t("admin.unitDays"),
    hours: t("admin.unitHours"),
    minutes: t("admin.unitMinutes"),
    seconds: t("admin.unitSeconds"),
    bytes: t("admin.unitBytes"),
  };

  const required = (
    key: keyof SiteConfig,
    labelKey: string,
    descKey: string,
  ) => (
    <SettingsRow label={t(labelKey)} description={t(descKey)}>
      <Segmented
        label={t(labelKey)}
        value={flag(key) ? "on" : "off"}
        options={[
          { value: "off", label: t("admin.choiceNotRequired") },
          { value: "on", label: t("admin.choiceRequired") },
        ]}
        onChange={(v) => set(key, v === "on")}
      />
    </SettingsRow>
  );

  return { numberRow, check, unit, required };
}
