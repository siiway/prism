// Captcha widget supporting Turnstile, hCaptcha, reCAPTCHA v3, and PoW

import { useEffect, useRef, useState, useCallback } from "react";
import { Button, Spinner, Text, ProgressBar } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { solvePoW } from "../lib/pow";

export interface CaptchaValue {
  captcha_token?: string;
  pow_challenge?: string;
  pow_nonce?: number;
}

interface CaptchaProps {
  provider: string;
  siteKey: string;
  /** Server-resolved Turnstile host directive (see the site config's
   *  turnstile_endpoint_mode). Chooses the global vs. China-mirror widget
   *  host. Only used when provider === "turnstile"; defaults to the global
   *  host when absent. */
  turnstileEndpoint?: string;
  onVerified: (value: CaptchaValue) => void;
  onError?: (err: string) => void;
}

// IANA timezones served by the Mainland-China Turnstile mirror. Hong Kong and
// Macau are intentionally excluded — the cloudflare-cn.com endpoint targets
// Mainland China.
const CHINA_TIMEZONES = new Set([
  "Asia/Shanghai",
  "Asia/Urumqi",
  "Asia/Chongqing",
  "Asia/Harbin",
  "Asia/Kashgar",
]);

function browserIsChineseLanguage(): boolean {
  if (typeof navigator === "undefined") return false;
  const langs =
    navigator.languages && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];
  return langs.some((l) => l?.toLowerCase().startsWith("zh"));
}

function browserInChinaTimezone(): boolean {
  if (typeof Intl === "undefined") return false;
  try {
    return CHINA_TIMEZONES.has(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return false;
  }
}

// Resolve the server directive to the actual Turnstile challenge-script URL.
// The client-side modes ("client_language", "client_region") are decided here
// in the browser; the rest arrive already resolved from the server.
function turnstileScriptSrc(directive?: string): string {
  let useChina = false;
  if (directive === "china") useChina = true;
  else if (directive === "client_language")
    useChina = browserIsChineseLanguage();
  else if (directive === "client_region") useChina = browserInChinaTimezone();
  const host = useChina
    ? "https://challenges.cloudflare-cn.com"
    : "https://challenges.cloudflare.com";
  return `${host}/turnstile/v0/api.js?render=explicit`;
}

export function Captcha({
  provider,
  siteKey,
  turnstileEndpoint,
  onVerified,
  onError,
}: CaptchaProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [powState, setPowState] = useState<
    "idle" | "solving" | "done" | "error"
  >("idle");

  // ─── Turnstile ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (provider !== "turnstile") return;

    const script = document.createElement("script");
    script.src = turnstileScriptSrc(turnstileEndpoint);
    script.async = true;
    script.onload = () => {
      if (!containerRef.current) return;
      widgetIdRef.current = (
        window as unknown as TurnstileWindow
      ).turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token: string) => onVerified({ captcha_token: token }),
        "error-callback": () => onError?.(t("captcha.turnstileFailed")),
      });
    };
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, [provider, siteKey, turnstileEndpoint, onVerified, onError, t]);

  // ─── hCaptcha ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (provider !== "hcaptcha") return;

    const script = document.createElement("script");
    script.src = "https://js.hcaptcha.com/1/api.js?render=explicit";
    script.async = true;
    script.onload = () => {
      if (!containerRef.current) return;
      widgetIdRef.current = (
        window as unknown as HCaptchaWindow
      ).hcaptcha.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token: string) => onVerified({ captcha_token: token }),
      });
    };
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, [provider, siteKey, onVerified, onError]);

  // ─── reCAPTCHA v3 ───────────────────────────────────────────────────────
  useEffect(() => {
    if (provider !== "recaptcha") return;

    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/api.js?render=${siteKey}`;
    script.async = true;
    script.onload = () => {
      (window as unknown as RecaptchaWindow).grecaptcha.ready(async () => {
        try {
          const token = await (
            window as unknown as RecaptchaWindow
          ).grecaptcha.execute(siteKey, { action: "login" });
          onVerified({ captcha_token: token });
        } catch {
          onError?.(t("captcha.recaptchaFailed"));
        }
      });
    };
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, [provider, siteKey, onVerified, onError, t]);

  // ─── Proof of Work ──────────────────────────────────────────────────────
  const solveChallenge = useCallback(async () => {
    setPowState("solving");
    try {
      const { challenge, difficulty } = await api.powChallenge();
      const nonce = await solvePoW(challenge, difficulty);
      onVerified({ pow_challenge: challenge, pow_nonce: nonce });
      setPowState("done");
    } catch {
      setPowState("error");
      onError?.(t("captcha.powFailed"));
    }
  }, [onVerified, onError, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- triggering an async task on provider change; setState happens inside the async flow, not synchronously
    if (provider === "pow") solveChallenge();
  }, [provider, solveChallenge]);

  if (provider === "none") return null;

  if (provider === "pow") {
    return (
      <div
        style={{
          padding: "12px",
          border: "1px solid var(--colorNeutralStroke1)",
          borderRadius: "4px",
        }}
      >
        {powState === "idle" && <Text>{t("captcha.powPreparing")}</Text>}
        {powState === "solving" && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Spinner size="tiny" />
            <Text>{t("captcha.powSolving")}</Text>
          </div>
        )}
        {powState === "done" && (
          <Text style={{ color: "var(--colorPaletteLightGreenForeground1)" }}>
            ✓ {t("captcha.powSolved")}
          </Text>
        )}
        {powState === "error" && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Text style={{ color: "var(--colorPaletteRedForeground1)" }}>
              {t("captcha.powFailedShort")}
            </Text>
            <Button size="small" onClick={solveChallenge}>
              {t("captcha.retry")}
            </Button>
          </div>
        )}
        <ProgressBar
          value={
            powState === "done" ? 1 : powState === "solving" ? undefined : 0
          }
        />
      </div>
    );
  }

  // For reCAPTCHA v3 there's no visible widget
  if (provider === "recaptcha") return null;

  return <div ref={containerRef} />;
}

// Type stubs for injected globals
interface TurnstileWindow extends Window {
  turnstile: { render: (el: HTMLElement, opts: object) => string };
}
interface HCaptchaWindow extends Window {
  hcaptcha: { render: (el: HTMLElement, opts: object) => string };
}
interface RecaptchaWindow extends Window {
  grecaptcha: {
    ready: (fn: () => void) => void;
    execute: (key: string, opts: object) => Promise<string>;
  };
}
