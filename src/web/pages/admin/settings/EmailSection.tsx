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

// Static keys, so the translation check can see them.
const MAIL_SERVER = {
  smtp: {
    host: "admin.smtpHost",
    encryption: "admin.smtpEncryption",
    port: "admin.smtpPort",
    username: "admin.smtpUsername",
    password: "admin.smtpPassword",
    defaultPort: 587,
    // STARTTLS first: it's what submission (587) expects.
    options: [
      ["starttls", "admin.smtpStarttls"],
      ["ssl", "admin.smtpSsl"],
    ],
  },
  imap: {
    host: "admin.imapHost",
    encryption: "admin.imapEncryption",
    port: "admin.imapPort",
    username: "admin.imapUsername",
    password: "admin.imapPassword",
    defaultPort: 993,
    options: [
      ["ssl", "admin.imapSsl"],
      ["starttls", "admin.imapStarttls"],
    ],
  },
} as const;

/** Host, encryption, port and login for the outgoing (SMTP) or incoming
 *  (IMAP) mail server. Both store the same fields under their own prefix. */
function MailServerFields({
  kind,
  draft,
  hostPlaceholder,
}: {
  kind: "smtp" | "imap";
  draft: SectionProps["draft"];
  hostPlaceholder: string;
}) {
  const { t } = useTranslation();
  const styles = useSettingsStyles();
  const { get, set, num } = draft;
  const keys = MAIL_SERVER[kind];
  const host = `${kind}_host` as const;
  const secure = `${kind}_secure` as const;
  const port = `${kind}_port` as const;
  const user = `${kind}_user` as const;
  const password = `${kind}_password` as const;
  return (
    <>
      <div className={styles.grid}>
        <Field label={t(keys.host)}>
          <Input
            value={get(host) ?? ""}
            onChange={(e) => set(host, e.target.value)}
            placeholder={hostPlaceholder}
          />
        </Field>
        <Field label={t(keys.encryption)}>
          <Select
            value={get(secure) ? "ssl" : "starttls"}
            onChange={(_, d) => set(secure, d.value === "ssl")}
          >
            {keys.options.map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t(keys.port)}>
        <NumberInput
          label={t(keys.port)}
          value={num(port, keys.defaultPort)}
          onChange={(n) => set(port, n)}
          min={1}
          max={65535}
        />
      </Field>
      <div className={styles.grid}>
        <Field label={t(keys.username)}>
          <Input
            value={get(user) ?? ""}
            onChange={(e) => set(user, e.target.value)}
            placeholder="user@example.com"
          />
        </Field>
        <Field label={t(keys.password)}>
          <PasswordInput
            value={get(password) ?? ""}
            onChange={(e) => set(password, e.target.value)}
            placeholder={t("admin.unchanged")}
          />
        </Field>
      </div>
    </>
  );
}

export function EmailSection({ draft, showMsg }: SectionProps) {
  const api = useApi();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const styles = useSettingsStyles();
  const { get, set } = draft;
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
            <MailServerFields
              kind="smtp"
              draft={draft}
              hostPlaceholder={t("admin.smtpHostPlaceholder")}
            />
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
            <MailServerFields
              kind="imap"
              draft={draft}
              hostPlaceholder="imap.example.com"
            />
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
