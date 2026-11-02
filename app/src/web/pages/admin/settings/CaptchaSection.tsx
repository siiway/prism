// Settings → Captcha: the default provider, its alternates, and each
// provider's own settings.

import {
  Button,
  Checkbox,
  Field,
  Input,
  Text,
} from "@fluentui/react-components";
import { ArrowDownRegular, ArrowUpRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import { type SiteConfig, type CaptchaProvider } from "../../../types";
import { PasswordInput } from "../../../components/PasswordInput";
import { Segmented } from "../../../components/Segmented";
import { Select } from "../../../components/Select";
import {
  SettingsBody,
  SettingsCard,
  SettingsRow,
} from "../../../components/Settings";
import { useSettingsStyles } from "./styles";
import { NumberInput } from "./fields";
import { useSettingRows, type SectionProps } from "./shared";

// Turnstile challenge-endpoint modes, in the order they are offered. Each one
// labels itself from `admin.turnstileEndpoint_<mode>`, so the list stays the
// single place a mode is named.
const TURNSTILE_ENDPOINT_MODES: SiteConfig["turnstile_endpoint_mode"][] = [
  "global",
  "china",
  "client_language",
  "server_region",
  "client_region",
];

// Selectable captcha providers (excludes "none", which is handled separately as
// "captcha off"). Each is labelled from `admin.captcha_<provider>`.
const CAPTCHA_PROVIDERS: CaptchaProvider[] = [
  "turnstile",
  "hcaptcha",
  "recaptcha",
  "geetest",
  "cap",
];

export function CaptchaSection({ draft }: SectionProps) {
  const { t } = useTranslation();
  const styles = useSettingsStyles();
  const { get, set, flag, num } = draft;
  const { numberRow, unit } = useSettingRows(draft);

  // Read once — both the dropdown label and its selection need it, and a
  // config row written before the setting existed has no value at all.
  const turnstileMode = get("turnstile_endpoint_mode") ?? "global";
  const capMode = get("cap_mode") ?? "embedded";

  // ─── Captcha provider set ──────────────────────────────────────────────────
  // The enabled set is an ordered list: element 0 is the default rendered
  // first, the rest are switchable alternates. "none" is never stored in the
  // list — an empty list means captcha is off.
  const providerList: CaptchaProvider[] = (
    (get("captcha_providers") ?? []) as CaptchaProvider[]
  ).filter((p) => p !== "none");
  const defaultProvider: CaptchaProvider = providerList[0] ?? "none";
  const alternateProviders: CaptchaProvider[] = providerList.slice(1);
  // Display order for the alternates editor: enabled alternates first, in their
  // actual configured order (so the ↑/↓ controls visibly move a row), then the
  // not-yet-enabled providers pinned at the bottom in the canonical order.
  const alternateOptions: CaptchaProvider[] = [
    ...alternateProviders,
    ...CAPTCHA_PROVIDERS.filter(
      (p) => p !== defaultProvider && !alternateProviders.includes(p),
    ),
  ];
  const setProviderList = (list: CaptchaProvider[]) =>
    set("captcha_providers", list);
  // Change the default (element 0). "none" clears the whole set. Otherwise the
  // new default moves to the front and the previous ordering is preserved.
  const setDefaultProvider = (p: CaptchaProvider) => {
    if (p === "none") {
      setProviderList([]);
      return;
    }
    setProviderList([p, ...providerList.filter((x) => x !== p)]);
  };
  const toggleAlternate = (p: CaptchaProvider, on: boolean) => {
    if (on) setProviderList([...providerList, p]);
    else setProviderList(providerList.filter((x) => x !== p));
  };
  // Reorder an alternate. Index 0 (the default) is fixed, so alternates only
  // move within positions 1..n.
  const moveAlternate = (p: CaptchaProvider, dir: -1 | 1) => {
    const idx = providerList.indexOf(p);
    const target = idx + dir;
    if (idx < 1 || target < 1 || target >= providerList.length) return;
    const copy = [...providerList];
    [copy[idx], copy[target]] = [copy[target], copy[idx]];
    setProviderList(copy);
  };

  return (
    <>
      <SettingsCard id="admin.cardCaptcha" title={t("admin.cardCaptcha")}>
        {/* Default provider — element 0 of the enabled set. "none" turns
                captcha off entirely. */}
        <SettingsRow
          label={t("admin.captchaDefaultProvider")}
          description={t("admin.captchaDefaultProviderHint")}
        >
          <Select
            aria-label={t("admin.captchaDefaultProvider")}
            className={styles.select}
            value={defaultProvider}
            onChange={(_, d) => setDefaultProvider(d.value as CaptchaProvider)}
          >
            <option value="none">{t("admin.captcha_none")}</option>
            {CAPTCHA_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {t(`admin.captcha_${p}`)}
              </option>
            ))}
          </Select>
        </SettingsRow>
        {/* Switch-reveal timeout applies once ≥2 providers are enabled. */}
        {providerList.length >= 2 &&
          numberRow(
            "captcha_switch_timeout_seconds",
            15,
            "admin.captchaSwitchTimeout",
            {
              descKey: "admin.captchaSwitchTimeoutHint",
              unit: unit.seconds,
              min: 0,
            },
          )}
        {/* Alternates — the switchable set, in the order visitors are
                offered them. */}
        {defaultProvider !== "none" && (
          <SettingsBody>
            <Text size={200} className={styles.muted}>
              {t("admin.captchaAlternatesHint")}
            </Text>
            <div
              role="group"
              aria-label={t("admin.captchaAlternatesHint")}
              className={styles.alternates}
            >
              {alternateOptions.map((p) => {
                const enabled = alternateProviders.includes(p);
                const pos = alternateProviders.indexOf(p);
                return (
                  <div key={p} className={styles.alternate}>
                    <Checkbox
                      label={t(`admin.captcha_${p}`)}
                      checked={enabled}
                      onChange={(_, d) => toggleAlternate(p, !!d.checked)}
                    />
                    {enabled && (
                      <span className={styles.unit}>
                        {t("admin.captchaAlternatePosition", {
                          n: pos + 1,
                        })}
                      </span>
                    )}
                    {enabled && alternateProviders.length > 1 && (
                      <span className={styles.order}>
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={<ArrowUpRegular />}
                          disabled={pos <= 0}
                          onClick={() => moveAlternate(p, -1)}
                          aria-label={t("admin.captchaMoveUp")}
                        />
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={<ArrowDownRegular />}
                          disabled={pos >= alternateProviders.length - 1}
                          onClick={() => moveAlternate(p, 1)}
                          aria-label={t("admin.captchaMoveDown")}
                        />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </SettingsBody>
        )}
      </SettingsCard>

      {/* Credentials for every enabled provider, one card each. */}
      {providerList.map((p) => (
        <SettingsCard key={p} title={t(`admin.captcha_${p}`)}>
          <SettingsBody>
            {p === "turnstile" && (
              <>
                <div className={styles.grid}>
                  <Field label={t("admin.captchaSiteKey")}>
                    <Input
                      value={get("turnstile_site_key") ?? ""}
                      onChange={(e) =>
                        set("turnstile_site_key", e.target.value)
                      }
                    />
                  </Field>
                  <Field label={t("admin.captchaSecretKey")}>
                    <PasswordInput
                      value={get("turnstile_secret_key") ?? ""}
                      onChange={(e) =>
                        set("turnstile_secret_key", e.target.value)
                      }
                    />
                  </Field>
                </div>
                <Field
                  label={t("admin.turnstileEndpoint")}
                  hint={t("admin.turnstileEndpointHint")}
                >
                  <Select
                    value={turnstileMode}
                    onChange={(_, d) => set("turnstile_endpoint_mode", d.value)}
                  >
                    {TURNSTILE_ENDPOINT_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {t(`admin.turnstileEndpoint_${mode}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                {/* The China host needs its own region:"china" widget. */}
                {turnstileMode !== "global" && (
                  <div className={styles.grid}>
                    <Field
                      label={t("admin.turnstileChinaSiteKey")}
                      hint={t("admin.turnstileChinaSiteKeyHint")}
                    >
                      <Input
                        value={get("turnstile_china_site_key") ?? ""}
                        onChange={(e) =>
                          set("turnstile_china_site_key", e.target.value)
                        }
                      />
                    </Field>
                    <Field label={t("admin.turnstileChinaSecretKey")}>
                      <PasswordInput
                        value={get("turnstile_china_secret_key") ?? ""}
                        onChange={(e) =>
                          set("turnstile_china_secret_key", e.target.value)
                        }
                      />
                    </Field>
                  </div>
                )}
              </>
            )}

            {(p === "hcaptcha" || p === "recaptcha") && (
              <div className={styles.grid}>
                <Field label={t("admin.captchaSiteKey")}>
                  <Input
                    value={get(`${p}_site_key` as const) ?? ""}
                    onChange={(e) => set(`${p}_site_key`, e.target.value)}
                  />
                </Field>
                <Field label={t("admin.captchaSecretKey")}>
                  <PasswordInput
                    value={get(`${p}_secret_key` as const) ?? ""}
                    onChange={(e) => set(`${p}_secret_key`, e.target.value)}
                  />
                </Field>
              </div>
            )}

            {p === "geetest" && (
              <>
                <div className={styles.grid}>
                  <Field label={t("admin.geetestCaptchaId")}>
                    <Input
                      value={get("geetest_captcha_id") ?? ""}
                      onChange={(e) =>
                        set("geetest_captcha_id", e.target.value)
                      }
                    />
                  </Field>
                  <Field label={t("admin.geetestCaptchaKey")}>
                    <PasswordInput
                      value={get("geetest_captcha_key") ?? ""}
                      onChange={(e) =>
                        set("geetest_captcha_key", e.target.value)
                      }
                    />
                  </Field>
                </div>
                <Checkbox
                  label={t("admin.geetestFailOpen")}
                  checked={flag("geetest_fail_open")}
                  onChange={(_, d) => set("geetest_fail_open", !!d.checked)}
                />
              </>
            )}

            {p === "cap" && (
              <>
                <Field label={t("admin.capMode")} hint={t("admin.capModeHint")}>
                  <Segmented
                    label={t("admin.capMode")}
                    value={capMode}
                    options={[
                      {
                        value: "embedded",
                        label: t("admin.capMode_embedded"),
                      },
                      {
                        value: "external",
                        label: t("admin.capMode_external"),
                      },
                    ]}
                    onChange={(v) => set("cap_mode", v)}
                  />
                </Field>
                {capMode === "external" ? (
                  <>
                    <Field label={t("admin.capApiEndpoint")}>
                      <Input
                        value={get("cap_api_endpoint") ?? ""}
                        onChange={(e) =>
                          set("cap_api_endpoint", e.target.value)
                        }
                      />
                    </Field>
                    <div className={styles.grid}>
                      <Field label={t("admin.captchaSiteKey")}>
                        <Input
                          value={get("cap_site_key") ?? ""}
                          onChange={(e) => set("cap_site_key", e.target.value)}
                        />
                      </Field>
                      <Field label={t("admin.captchaSecretKey")}>
                        <PasswordInput
                          value={get("cap_secret_key") ?? ""}
                          onChange={(e) =>
                            set("cap_secret_key", e.target.value)
                          }
                        />
                      </Field>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={styles.grid}>
                      <Field label={t("admin.capChallengeCount")}>
                        <NumberInput
                          label={t("admin.capChallengeCount")}
                          value={num("cap_challenge_count", 50)}
                          onChange={(n) => set("cap_challenge_count", n)}
                          min={1}
                        />
                      </Field>
                      <Field label={t("admin.capChallengeDifficulty")}>
                        <NumberInput
                          label={t("admin.capChallengeDifficulty")}
                          value={num("cap_challenge_difficulty", 4)}
                          onChange={(n) => set("cap_challenge_difficulty", n)}
                          min={1}
                        />
                      </Field>
                    </div>
                    <Checkbox
                      label={t("admin.capInstrumentation")}
                      checked={flag("cap_instrumentation", true)}
                      onChange={(_, d) =>
                        set("cap_instrumentation", !!d.checked)
                      }
                    />
                  </>
                )}
              </>
            )}
          </SettingsBody>
        </SettingsCard>
      ))}
    </>
  );
}
