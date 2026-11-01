// Settings → Email & notifications: sending, receiving, and the chat bots that
// deliver notifications.

import {
  Button,
  Field,
  Input,
  Link,
  Spinner,
} from "@fluentui/react-components";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useApi } from "../../../lib/api-context";
import { PasswordInput } from "../../../components/PasswordInput";
import { Select } from "../../../components/Select";
import {
  SettingsBody,
  SettingsCard,
  SettingsFooter,
  SettingsRow,
} from "../../../components/Settings";
import { useSettingsStyles } from "./styles";
import { NumberInput } from "./fields";
import { useFail, type SectionProps } from "./shared";

export function EmailSection({ draft, showMsg }: SectionProps) {
  const api = useApi();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const styles = useSettingsStyles();
  const { get, set, num } = draft;
  const fail = useFail(showMsg);

  const { data: oauthSourcesData } = useQuery({
    queryKey: ["admin-oauth-sources"],
    queryFn: () => api.adminListOAuthSources(),
  });
  const telegramSources = (oauthSourcesData?.sources ?? []).filter(
    (s) => s.provider === "telegram" && s.enabled,
  );
  const discordSources = (oauthSourcesData?.sources ?? []).filter(
    (s) => s.provider === "discord" && s.enabled,
  );
  const emailProvider = get("email_provider") ?? "none";
  const receiveProvider = get("email_receive_provider") ?? "cloudflare";
  const [testingEmail, setTestingEmail] = useState(false);
  const [testingEmailReceiving, setTestingEmailReceiving] = useState(false);

  const handleTestEmail = async () => {
    setTestingEmail(true);
    try {
      await api.adminTestEmail();
      showMsg("success", t("admin.testEmailSentDone"));
    } catch (err) {
      fail(err, "common.error");
    } finally {
      setTestingEmail(false);
    }
  };

  const handleTestEmailReceiving = async () => {
    setTestingEmailReceiving(true);
    try {
      const result = await api.adminTestEmailReceiving();
      showMsg(
        "success",
        t("admin.testEmailSentToDone", { address: result.address }),
      );
    } catch (err) {
      fail(err, "common.error");
    } finally {
      setTestingEmailReceiving(false);
    }
  };

  /** Pick which sign-in source's bot sends a platform's notifications. */
  const notifySource = (
    key: "tg_notify_source_slug" | "discord_notify_source_slug",
    labelKey: string,
    descKey: string,
    noSourcesKey: string,
    sources: { slug: string; name: string }[],
  ) => (
    <SettingsRow
      label={t(labelKey)}
      description={
        sources.length === 0 ? (
          <>
            {t(noSourcesKey)}{" "}
            <Link onClick={() => navigate("/admin/connections")}>
              {t("admin.addOAuthSource")}
            </Link>
          </>
        ) : (
          t(descKey)
        )
      }
    >
      {sources.length > 0 && (
        <Select
          aria-label={t(labelKey)}
          className={styles.select}
          value={get(key) ?? ""}
          onChange={(_, d) => set(key, d.value)}
        >
          <option value="">{t("admin.notifyOff")}</option>
          {sources.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name}
            </option>
          ))}
        </Select>
      )}
    </SettingsRow>
  );

  return (
    <>
      <SettingsCard
        id="admin.cardEmailSending"
        title={t("admin.cardEmailSending")}
      >
        <SettingsBody>
          <Field label={t("admin.emailProvider")}>
            <Select
              value={emailProvider}
              onChange={(_, d) => set("email_provider", d.value)}
            >
              <option value="none">{t("admin.emailNone")}</option>
              <option value="resend">{t("admin.emailResend")}</option>
              <option value="mailchannels">
                {t("admin.emailMailchannels")}
              </option>
              <option value="smtp">{t("admin.emailSmtp")}</option>
            </Select>
          </Field>
          {(emailProvider === "resend" || emailProvider === "mailchannels") && (
            <Field label={t("admin.emailApiKey")}>
              <PasswordInput
                value={get("email_api_key") ?? ""}
                onChange={(e) => set("email_api_key", e.target.value)}
                placeholder={t("admin.unchanged")}
              />
            </Field>
          )}
          {emailProvider === "smtp" && (
            <>
              <div className={styles.grid}>
                <Field label={t("admin.smtpHost")}>
                  <Input
                    value={get("smtp_host") ?? ""}
                    onChange={(e) => set("smtp_host", e.target.value)}
                    placeholder={t("admin.smtpHostPlaceholder")}
                  />
                </Field>
                <Field label={t("admin.smtpEncryption")}>
                  <Select
                    value={get("smtp_secure") ? "ssl" : "starttls"}
                    onChange={(_, d) => set("smtp_secure", d.value === "ssl")}
                  >
                    <option value="starttls">{t("admin.smtpStarttls")}</option>
                    <option value="ssl">{t("admin.smtpSsl")}</option>
                  </Select>
                </Field>
              </div>
              <Field label={t("admin.smtpPort")}>
                <NumberInput
                  label={t("admin.smtpPort")}
                  value={num("smtp_port", 587)}
                  onChange={(n) => set("smtp_port", n)}
                  min={1}
                  max={65535}
                />
              </Field>
              <div className={styles.grid}>
                <Field label={t("admin.smtpUsername")}>
                  <Input
                    value={get("smtp_user") ?? ""}
                    onChange={(e) => set("smtp_user", e.target.value)}
                    placeholder="user@example.com"
                  />
                </Field>
                <Field label={t("admin.smtpPassword")}>
                  <PasswordInput
                    value={get("smtp_password") ?? ""}
                    onChange={(e) => set("smtp_password", e.target.value)}
                    placeholder={t("admin.unchanged")}
                  />
                </Field>
              </div>
            </>
          )}
          <Field label={t("admin.emailFrom")}>
            <Input
              value={get("email_from") ?? ""}
              onChange={(e) => set("email_from", e.target.value)}
              placeholder={t("admin.emailFromPlaceholder")}
            />
          </Field>
        </SettingsBody>
        {emailProvider !== "none" && (
          <SettingsFooter start={t("admin.testEmailDesc")}>
            <Button
              onClick={handleTestEmail}
              disabled={testingEmail}
              icon={testingEmail ? <Spinner size="tiny" /> : undefined}
            >
              {t("admin.sendTestEmail")}
            </Button>
          </SettingsFooter>
        )}
      </SettingsCard>

      <SettingsCard
        id="admin.cardEmailReceiving"
        title={t("admin.cardEmailReceiving")}
      >
        <SettingsBody>
          <div className={styles.grid}>
            <Field label={t("admin.emailVerifyMethods")}>
              <Select
                value={get("email_verify_methods") ?? "both"}
                onChange={(_, d) => set("email_verify_methods", d.value)}
              >
                <option value="both">{t("admin.verifyMethodBoth")}</option>
                <option value="link">{t("admin.verifyMethodLink")}</option>
                <option value="send">{t("admin.verifyMethodSend")}</option>
              </Select>
            </Field>
            <Field label={t("admin.emailReceiveProvider")}>
              <Select
                value={receiveProvider}
                onChange={(_, d) => set("email_receive_provider", d.value)}
              >
                <option value="cloudflare">
                  {t("admin.receiveCloudflare")}
                </option>
                <option value="imap">{t("admin.receiveImap")}</option>
                <option value="none">{t("admin.receiveNone")}</option>
              </Select>
            </Field>
          </div>
          <Field
            label={t("admin.emailReceiveHost")}
            hint={t("admin.emailReceiveHostHint")}
          >
            <Input
              value={get("email_receive_host") ?? ""}
              onChange={(e) => set("email_receive_host", e.target.value)}
              placeholder="mail.example.com"
            />
          </Field>
          {receiveProvider === "imap" && (
            <>
              <div className={styles.grid}>
                <Field label={t("admin.imapHost")}>
                  <Input
                    value={get("imap_host") ?? ""}
                    onChange={(e) => set("imap_host", e.target.value)}
                    placeholder="imap.example.com"
                  />
                </Field>
                <Field label={t("admin.imapEncryption")}>
                  <Select
                    value={get("imap_secure") ? "ssl" : "starttls"}
                    onChange={(_, d) => set("imap_secure", d.value === "ssl")}
                  >
                    <option value="ssl">{t("admin.imapSsl")}</option>
                    <option value="starttls">{t("admin.imapStarttls")}</option>
                  </Select>
                </Field>
              </div>
              <Field label={t("admin.imapPort")}>
                <NumberInput
                  label={t("admin.imapPort")}
                  value={num("imap_port", 993)}
                  onChange={(n) => set("imap_port", n)}
                  min={1}
                  max={65535}
                />
              </Field>
              <div className={styles.grid}>
                <Field label={t("admin.imapUsername")}>
                  <Input
                    value={get("imap_user") ?? ""}
                    onChange={(e) => set("imap_user", e.target.value)}
                    placeholder="user@example.com"
                  />
                </Field>
                <Field label={t("admin.imapPassword")}>
                  <PasswordInput
                    value={get("imap_password") ?? ""}
                    onChange={(e) => set("imap_password", e.target.value)}
                    placeholder={t("admin.unchanged")}
                  />
                </Field>
              </div>
            </>
          )}
        </SettingsBody>
        <SettingsFooter>
          <Button
            onClick={handleTestEmailReceiving}
            disabled={testingEmailReceiving}
            icon={testingEmailReceiving ? <Spinner size="tiny" /> : undefined}
          >
            {t("admin.testEmailReceiving")}
          </Button>
        </SettingsFooter>
      </SettingsCard>

      <SettingsCard
        id="admin.cardChatNotify"
        title={t("admin.cardChatNotify")}
        description={t("admin.thirdPartyDesc")}
      >
        {notifySource(
          "tg_notify_source_slug",
          "admin.tgNotifyBot",
          "admin.tgNotifyDesc",
          "admin.tgNotifyNoSources",
          telegramSources,
        )}
        {notifySource(
          "discord_notify_source_slug",
          "admin.discordNotifySource",
          "admin.discordNotifyDesc",
          "admin.discordNotifyNoSources",
          discordSources,
        )}
        {!!get("discord_notify_source_slug") && (
          <SettingsBody>
            <Field label={t("admin.discordBotToken")}>
              <PasswordInput
                value={get("discord_bot_token") ?? ""}
                onChange={(e) => set("discord_bot_token", e.target.value)}
                placeholder={t("admin.unchanged")}
              />
            </Field>
          </SettingsBody>
        )}
      </SettingsCard>
    </>
  );
}
