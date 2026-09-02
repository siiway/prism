// Captcha widget supporting Turnstile, hCaptcha, reCAPTCHA v3, and PoW

import { useEffect, useRef, useState, useCallback } from "react";
import { Button, Spinner, Text, ProgressBar } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import { useApi } from "../lib/api-context";
import type { TurnstileEndpointDirective, TurnstileVariant } from "../lib/api";
import { solvePoW } from "../lib/pow";

export interface CaptchaValue {
  captcha_token?: string;
  /** Which Turnstile widget minted `captcha_token`. Sent back with it so the
   *  server verifies against that widget's secret — the global and China
   *  widgets are separate sitekey/secret pairs. Absent for the other
   *  providers, which have only one pair. */
  captcha_variant?: TurnstileVariant;
  pow_challenge?: string;
  pow_nonce?: number;
}

interface CaptchaProps {
  provider: string;
  /** Site key for the provider. For Turnstile this is the global
   *  (region:"world") widget. */
  siteKey: string;
  /** Server-resolved Turnstile host directive (see the site config's
   *  turnstile_endpoint_mode). Chooses the global vs. China widget host. Only
   *  used when provider === "turnstile"; defaults to the global host when
   *  absent.
   *
   *  A directive that can put the browser on the China host only ever arrives
   *  once the server has confirmed a China widget is configured and that the
   *  host will serve it — see worker/lib/turnstile.ts for why that check has
   *  to happen there and cannot be retried here. */
  turnstileEndpoint?: TurnstileEndpointDirective;
  /** Site key of the region:"china" Turnstile widget. Required to use the
   *  China host at all: a region:"world" key is rejected there. */
  turnstileChinaSiteKey?: string;
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

// Resolve the server directive into the host/sitekey pair to render. The
// client-side modes ("client_language", "client_region") are decided here in
// the browser; the rest arrive already resolved from the server.
//
// Host and sitekey move together and cannot be mixed: a Turnstile widget's
// `region` is fixed at creation, and the China host rejects a region:"world"
// sitekey (and vice versa). The pair is also final for the life of the page —
// the Turnstile bundle reads its challenge origin off its own <script> tag
// once, at load — which is why the server will not name the China host unless
// it has confirmed the China widget works.
function turnstileTarget(
  directive: TurnstileEndpointDirective | undefined,
  siteKey: string,
  chinaSiteKey: string | undefined,
): { src: string; sitekey: string; variant: TurnstileVariant } {
  let wantsChina: boolean;
  switch (directive) {
    case "china":
      wantsChina = true;
      break;
    case "client_language":
      wantsChina = browserIsChineseLanguage();
      break;
    case "client_region":
      wantsChina = browserInChinaTimezone();
      break;
    // "global", and an unknown directive from a newer server.
    default:
      wantsChina = false;
  }
  // No China widget configured means there is nothing to load there, whatever
  // the directive says. The server already enforces this; repeating it keeps a
  // stale or hand-edited payload from producing a guaranteed-broken widget.
  const useChina = wantsChina && !!chinaSiteKey;
  return useChina
    ? {
        src: `${TURNSTILE_HOST_CHINA}/turnstile/v0/api.js?render=explicit`,
        sitekey: chinaSiteKey,
        variant: "china",
      }
    : {
        src: `${TURNSTILE_HOST_GLOBAL}/turnstile/v0/api.js?render=explicit`,
        sitekey: siteKey,
        variant: "global",
      };
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
  turnstileChinaSiteKey,
  onVerified,
  onError,
}: CaptchaProps) {
  const api = useApi();
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [powState, setPowState] = useState<
    "idle" | "solving" | "done" | "error"
  >("idle");

  // ─── Turnstile ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (provider !== "turnstile") return;

    const target = turnstileTarget(
      turnstileEndpoint,
      siteKey,
      turnstileChinaSiteKey,
    );

    const removeScript = injectScript(target.src, () => {
      if (!containerRef.current) return;
      widgetIdRef.current = widgetApi("turnstile").render(
        containerRef.current,
        {
          sitekey: target.sitekey,
          callback: (token: string) =>
            onVerified({
              captcha_token: token,
              captcha_variant: target.variant,
            }),
          "error-callback": () => onError?.(t("captcha.turnstileFailed")),
        },
      );
    });
    return () => {
      removeWidget("turnstile", widgetIdRef.current);
      widgetIdRef.current = null;
      removeScript();
    };
  }, [
    provider,
    siteKey,
    turnstileEndpoint,
    turnstileChinaSiteKey,
    onVerified,
    onError,
    t,
  ]);

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
  }, [api, onVerified, onError, t]);

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
