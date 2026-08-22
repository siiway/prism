// Captcha widget supporting Turnstile, hCaptcha, reCAPTCHA v3, and PoW

import { useEffect, useRef, useState, useCallback } from "react";
import { Button, Spinner, Text, ProgressBar } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import type { TurnstileEndpointDirective } from "../lib/api";
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
  turnstileEndpoint?: TurnstileEndpointDirective;
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
    return CHINA_TIMEZONES.has(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  } catch {
    return false;
  }
}

const TURNSTILE_HOST_GLOBAL = "https://challenges.cloudflare.com";
const TURNSTILE_HOST_CHINA = "https://challenges.cloudflare-cn.com";

// Resolve the server directive to the actual Turnstile challenge-script URL.
// The client-side modes ("client_language", "client_region") are decided here
// in the browser; the rest arrive already resolved from the server.
function turnstileScriptSrc(directive?: TurnstileEndpointDirective): string {
  let useChina: boolean;
  switch (directive) {
    case "china":
      useChina = true;
      break;
    case "client_language":
      useChina = browserIsChineseLanguage();
      break;
    case "client_region":
      useChina = browserInChinaTimezone();
      break;
    // "global", and an unknown directive from a newer server.
    default:
      useChina = false;
  }
  const host = useChina ? TURNSTILE_HOST_CHINA : TURNSTILE_HOST_GLOBAL;
  return `${host}/turnstile/v0/api.js?render=explicit`;
}

// Append a provider's script tag and hand back the effect teardown. `remove()`
// tolerates an already-detached node, unlike document.body.removeChild.
function injectScript(src: string, onLoad: () => void): () => void {
  const script = document.createElement("script");
  let torndown = false;
  script.src = src;
  script.async = true;
  // Detaching the tag does not abort a load already in flight, so the flag is
  // what keeps a late onLoad from rendering into a container the next effect
  // run already owns.
  script.onload = () => {
    if (!torndown) onLoad();
  };
  document.body.appendChild(script);
  return () => {
    torndown = true;
    script.remove();
  };
}

// Detach a rendered widget. The container element outlives the effect, and
// both providers refuse to render twice into the same element — so a re-run
// (language switch, changed endpoint directive) must clear the old widget or
// the new one never appears. Throws once the provider global is gone, which is
// exactly the case where there is nothing left to remove.
function removeWidget(name: "turnstile" | "hcaptcha", id: string | null): void {
  if (id === null) return;
  try {
    widgetApi(name).remove(id);
  } catch {
    // Already detached.
  }
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

    const removeScript = injectScript(
      turnstileScriptSrc(turnstileEndpoint),
      () => {
        if (!containerRef.current) return;
        widgetIdRef.current = widgetApi("turnstile").render(
          containerRef.current,
          {
            sitekey: siteKey,
            callback: (token: string) => onVerified({ captcha_token: token }),
            "error-callback": () => onError?.(t("captcha.turnstileFailed")),
          },
        );
      },
    );
    return () => {
      removeWidget("turnstile", widgetIdRef.current);
      widgetIdRef.current = null;
      removeScript();
    };
  }, [provider, siteKey, turnstileEndpoint, onVerified, onError, t]);

  // ─── hCaptcha ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (provider !== "hcaptcha") return;

    const removeScript = injectScript(
      "https://js.hcaptcha.com/1/api.js?render=explicit",
      () => {
        if (!containerRef.current) return;
        widgetIdRef.current = widgetApi("hcaptcha").render(
          containerRef.current,
          {
            sitekey: siteKey,
            callback: (token: string) => onVerified({ captcha_token: token }),
          },
        );
      },
    );
    return () => {
      removeWidget("hcaptcha", widgetIdRef.current);
      widgetIdRef.current = null;
      removeScript();
    };
  }, [provider, siteKey, onVerified, onError]);

  // ─── reCAPTCHA v3 ───────────────────────────────────────────────────────
  useEffect(() => {
    if (provider !== "recaptcha") return;

    // No widget to tear down — v3 runs invisibly and returns a token.
    return injectScript(
      `https://www.google.com/recaptcha/api.js?render=${siteKey}`,
      () => {
        const grecaptcha = (window as unknown as RecaptchaWindow).grecaptcha;
        grecaptcha.ready(async () => {
          try {
            const token = await grecaptcha.execute(siteKey, {
              action: "login",
            });
            onVerified({ captcha_token: token });
          } catch {
            onError?.(t("captcha.recaptchaFailed"));
          }
        });
      },
    );
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

// Type stubs for injected globals. Turnstile and hCaptcha share the same
// explicit-render surface, so one accessor covers both.
interface WidgetApi {
  render: (el: HTMLElement, opts: object) => string;
  remove: (id: string) => void;
}
interface RecaptchaWindow extends Window {
  grecaptcha: {
    ready: (fn: () => void) => void;
    execute: (key: string, opts: object) => Promise<string>;
  };
}

function widgetApi(name: "turnstile" | "hcaptcha"): WidgetApi {
  return (window as unknown as Record<string, WidgetApi>)[name];
}
