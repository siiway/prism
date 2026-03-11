// Post-registration page — lets the user choose how to verify their email

import {
  Button,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { CopyRegular, MailRegular, SendRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../store/auth";
import { Captcha } from "../components/Captcha";
import type { CaptchaValue } from "../components/Captcha";

const useStyles = makeStyles({
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: tokens.colorNeutralBackground1,
    padding: "16px",
    boxSizing: "border-box",
  },
  card: {
    width: "100%",
    maxWidth: "480px",
    padding: "40px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  option: {
    padding: "16px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    background: tokens.colorNeutralBackground3,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  verifyAddress: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
});

export function VerifyChoose() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { token } = useAuthStore();

  const { data: site } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });

  const methods = site?.email_verify_methods ?? "both";
  const showLink = methods === "link" || methods === "both";
  const showSend = methods === "send" || methods === "both";

  const [captcha, setCaptcha] = useState<CaptchaValue>({});
  const [captchaError, setCaptchaError] = useState("");

  const [resendLoading, setResendLoading] = useState(false);
  const [codeLoading, setCodeLoading] = useState(false);
  const [verifyData, setVerifyData] = useState<{
    address: string;
    code: string;
    method: "imap" | "email";
  } | null>(null);
  const [msg, setMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const handleResend = async () => {
    setResendLoading(true);
    setMsg(null);
    try {
      await api.resendVerifyEmail(captcha);
      setMsg({ type: "success", text: t("verifyChoose.linkSent") });
    } catch (err) {
      setMsg({
        type: "error",
        text: err instanceof ApiError ? err.message : t("common.error"),
      });
    } finally {
      setResendLoading(false);
    }
  };

  const handleGetAddress = async () => {
    setCodeLoading(true);
    setMsg(null);
    try {
      const res = await api.emailVerifyCode(captcha);
      setVerifyData(res);
    } catch (err) {
      setMsg({
        type: "error",
        text: err instanceof ApiError ? err.message : t("common.error"),
      });
    } finally {
      setCodeLoading(false);
    }
  };

  // If not logged in, go to login
  if (!token) {
    navigate("/login", { replace: true });
    return null;
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <Title2>{t("verifyChoose.title")}</Title2>
        <Text style={{ color: tokens.colorNeutralForeground3 }}>
          {t("verifyChoose.desc")}
        </Text>

        {msg && (
          <MessageBar intent={msg.type === "success" ? "success" : "error"}>
            <MessageBarBody>{msg.text}</MessageBarBody>
          </MessageBar>
        )}

        {site && site.captcha_provider !== "none" && (
          <Captcha
            provider={site.captcha_provider}
            siteKey={site.captcha_site_key}
            onVerified={setCaptcha}
            onError={setCaptchaError}
          />
        )}
        {captchaError && (
          <Text style={{ color: tokens.colorPaletteRedForeground1 }}>
            {captchaError}
          </Text>
        )}

        {showLink && (
          <div className={styles.option}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <MailRegular fontSize={20} />
              <Text weight="semibold">{t("verifyChoose.linkTitle")}</Text>
            </div>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {t("verifyChoose.linkDesc")}
            </Text>
            <Button
              appearance="primary"
              size="small"
              icon={resendLoading ? <Spinner size="tiny" /> : undefined}
              disabled={resendLoading}
              onClick={handleResend}
            >
              {t("verifyChoose.sendLink")}
            </Button>
          </div>
        )}

        {showSend && (
          <div className={styles.option}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <SendRegular fontSize={20} />
              <Text weight="semibold">{t("verifyChoose.sendTitle")}</Text>
            </div>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {t("verifyChoose.sendDesc")}
            </Text>
            {verifyData ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {verifyData.method === "imap" ? (
                  <>
                    <Text size={200}>{t("verifyChoose.imapInstructions")}</Text>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <Text size={200} weight="semibold">
                        {t("verifyChoose.imapTo")}
                      </Text>
                      <div className={styles.verifyAddress}>
                        <code
                          style={{
                            flex: 1,
                            padding: "6px 10px",
                            background: tokens.colorNeutralBackground1,
                            border: `1px solid ${tokens.colorNeutralStroke1}`,
                            borderRadius: 4,
                            fontSize: 13,
                            wordBreak: "break-all",
                          }}
                        >
                          {verifyData.address}
                        </code>
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={<CopyRegular />}
                          onClick={() =>
                            navigator.clipboard.writeText(verifyData.address)
                          }
                        />
                      </div>
                      <Text size={200} weight="semibold">
                        {t("verifyChoose.imapSubject")}
                      </Text>
                      <div className={styles.verifyAddress}>
                        <code
                          style={{
                            flex: 1,
                            padding: "6px 10px",
                            background: tokens.colorNeutralBackground1,
                            border: `1px solid ${tokens.colorNeutralStroke1}`,
                            borderRadius: 4,
                            fontSize: 13,
                            wordBreak: "break-all",
                          }}
                        >
                          {verifyData.code}
                        </code>
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={<CopyRegular />}
                          onClick={() =>
                            navigator.clipboard.writeText(verifyData.code)
                          }
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className={styles.verifyAddress}>
                    <code
                      style={{
                        flex: 1,
                        padding: "6px 10px",
                        background: tokens.colorNeutralBackground1,
                        border: `1px solid ${tokens.colorNeutralStroke1}`,
                        borderRadius: 4,
                        fontSize: 13,
                        wordBreak: "break-all",
                      }}
                    >
                      {verifyData.address}
                    </code>
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<CopyRegular />}
                      onClick={() =>
                        navigator.clipboard.writeText(verifyData.address)
                      }
                    />
                  </div>
                )}
              </div>
            ) : (
              <Button
                appearance="outline"
                size="small"
                icon={codeLoading ? <Spinner size="tiny" /> : undefined}
                disabled={codeLoading}
                onClick={handleGetAddress}
              >
                {t("verifyChoose.getAddress")}
              </Button>
            )}
          </div>
        )}

        <Button
          appearance="subtle"
          onClick={() => navigate("/")}
          style={{ alignSelf: "center" }}
        >
          {t("verifyChoose.skipForNow")}
        </Button>
      </div>
    </div>
  );
}
