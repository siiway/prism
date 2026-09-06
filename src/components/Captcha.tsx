// Captcha widget supporting an *enabled set* of providers the visitor can
// switch between — Turnstile, hCaptcha, reCAPTCHA v3, PoW, GeeTest v4 and Cap.
//
// The site exposes an ordered `captcha_providers` list (see PublicCaptchaConfig):
// element 0 is the default rendered first; the rest are alternates. When more
// than one is enabled a "try a different method" control lets the visitor swap
// the active provider — surfaced immediately on a failure and after a
// configurable timeout, and their choice is remembered in localStorage so it
// survives failed attempts and re-renders on the same page.

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import {
  Button,
  Spinner,
  Text,
  ProgressBar,
  Link,
} from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import { useApi } from "../lib/api-context";
import type {
  CaptchaProvider,
  GeetestOutput,
  PublicCaptchaConfig,
  TurnstileEndpointDirective,
  TurnstileVariant,
} from "../lib/api";
import { solvePoW } from "../lib/pow";

export interface CaptchaValue {
  /** Which provider produced this proof. The server verifies against this and
   *  rejects a provider that isn't in the enabled set. */
  provider?: CaptchaProvider;
  captcha_token?: string;
  captcha_variant?: TurnstileVariant;
  pow_challenge?: string;
  pow_nonce?: number;
  /** GeeTest v4 validate output. */
  geetest?: GeetestOutput;
  /** Cap redeem token. */
  cap_token?: string;
}

interface CaptchaProps {
  /** The site's public captcha descriptor. When `captcha_providers` is empty
   *  the component renders nothing. */
  captcha: PublicCaptchaConfig;
  onVerified: (value: CaptchaValue) => void;
  onError?: (err: string) => void;
}

// Remembers the visitor's chosen alternate so it persists across failed
// attempts and re-renders within the page/session (Q12). Keyed globally — the
// same person hitting login then 2FA keeps their preference.
const SWITCH_STORAGE_KEY = "prism.captcha.provider";

function loadStoredProvider(): CaptchaProvider | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return (localStorage.getItem(SWITCH_STORAGE_KEY) as CaptchaProvider) || null;
  } catch {
    return null;
  }
}

function storeProvider(p: CaptchaProvider): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SWITCH_STORAGE_KEY, p);
  } catch {
    // Private mode / storage disabled — the choice just won't persist.
  }
}

// ─── Turnstile China host selection (unchanged from the single-provider era) ──

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
    default:
      wantsChina = false;
  }
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

function injectScript(src: string, onLoad: () => void): () => void {
  const script = document.createElement("script");
  let torndown = false;
  script.src = src;
  script.async = true;
  script.onload = () => {
    if (!torndown) onLoad();
  };
  document.body.appendChild(script);
  return () => {
    torndown = true;
    script.remove();
  };
}

function removeWidget(name: "turnstile" | "hcaptcha", id: string | null): void {
  if (id === null) return;
  try {
    widgetApi(name).remove(id);
  } catch {
    // Already detached.
  }
}

// ─── Single-provider widget ───────────────────────────────────────────────────
//
// Renders exactly one provider. Mounted with a React key that includes the
// provider, so switching providers unmounts the old widget and mounts the new
// one cleanly — each provider's SDK refuses to render twice into one element.

function ProviderWidget({
  provider,
  captcha,
  onVerified,
  onError,
}: {
  provider: CaptchaProvider;
  captcha: PublicCaptchaConfig;
  onVerified: (value: CaptchaValue) => void;
  onError?: (err: string) => void;
}) {
  const api = useApi();
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [powState, setPowState] = useState<
    "idle" | "solving" | "done" | "error"
  >("idle");
  const [geetestReady, setGeetestReady] = useState(false);
  const geetestObjRef = useRef<GeetestCaptchaObj | null>(null);

  // Read callbacks and `t` through refs so the widget effects don't list them
  // as dependencies. `onVerified`/`onError`/`t` can change identity on any
  // parent re-render (e.g. a keystroke in the login form); if the effects
  // depended on them, every such render would tear down and re-create the
  // widget — re-fetching challenges, re-initialising the GeeTest widget, and
  // tripping "too many requests". The effects below depend only on `provider`
  // and the primitive config values they actually read.
  const onVerifiedRef = useRef(onVerified);
  const onErrorRef = useRef(onError);
  const tRef = useRef(t);
  useEffect(() => {
    onVerifiedRef.current = onVerified;
    onErrorRef.current = onError;
    tRef.current = t;
  });

  // ─── Turnstile ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (provider !== "turnstile") return;
    const target = turnstileTarget(
      captcha.turnstile_endpoint,
      captcha.turnstile_site_key,
      captcha.turnstile_china_site_key,
    );
    const removeScript = injectScript(target.src, () => {
      if (!containerRef.current) return;
      widgetIdRef.current = widgetApi("turnstile").render(containerRef.current, {
        sitekey: target.sitekey,
        callback: (token: string) =>
          onVerifiedRef.current({
            provider: "turnstile",
            captcha_token: token,
            captcha_variant: target.variant,
          }),
        "error-callback": () =>
          onErrorRef.current?.(tRef.current("captcha.turnstileFailed")),
      });
    });
    return () => {
      removeWidget("turnstile", widgetIdRef.current);
      widgetIdRef.current = null;
      removeScript();
    };
  }, [
    provider,
    captcha.turnstile_endpoint,
    captcha.turnstile_site_key,
    captcha.turnstile_china_site_key,
  ]);

  // ─── hCaptcha ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (provider !== "hcaptcha") return;
    const removeScript = injectScript(
      "https://js.hcaptcha.com/1/api.js?render=explicit",
      () => {
        if (!containerRef.current) return;
        widgetIdRef.current = widgetApi("hcaptcha").render(containerRef.current, {
          sitekey: captcha.hcaptcha_site_key,
          callback: (token: string) =>
            onVerifiedRef.current({ provider: "hcaptcha", captcha_token: token }),
        });
      },
    );
    return () => {
      removeWidget("hcaptcha", widgetIdRef.current);
      widgetIdRef.current = null;
      removeScript();
    };
  }, [provider, captcha.hcaptcha_site_key]);

  // ─── reCAPTCHA v3 ───────────────────────────────────────────────────────
  useEffect(() => {
    if (provider !== "recaptcha") return;
    const siteKey = captcha.recaptcha_site_key;
    return injectScript(
      `https://www.google.com/recaptcha/api.js?render=${siteKey}`,
      () => {
        const grecaptcha = (window as unknown as RecaptchaWindow).grecaptcha;
        grecaptcha.ready(async () => {
          try {
            const token = await grecaptcha.execute(siteKey, { action: "login" });
            onVerifiedRef.current({ provider: "recaptcha", captcha_token: token });
          } catch {
            onErrorRef.current?.(tRef.current("captcha.recaptchaFailed"));
          }
        });
      },
    );
  }, [provider, captcha.recaptcha_site_key]);

  // ─── Proof of Work ──────────────────────────────────────────────────────
  const solveChallenge = useCallback(async () => {
    setPowState("solving");
    try {
      const { challenge, difficulty } = await api.powChallenge();
      const nonce = await solvePoW(challenge, difficulty);
      onVerifiedRef.current({
        provider: "pow",
        pow_challenge: challenge,
        pow_nonce: nonce,
      });
      setPowState("done");
    } catch {
      setPowState("error");
      onErrorRef.current?.(tRef.current("captcha.powFailed"));
    }
  }, [api]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async task on provider change; setState happens inside the async flow
    if (provider === "pow") solveChallenge();
  }, [provider, solveChallenge]);

  // ─── GeeTest v4 ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (provider !== "geetest") return;
    const removeScript = injectScript(
      "https://static.geetest.com/v4/gt4.js",
      () => {
        const initGeetest4 = (window as unknown as GeetestWindow).initGeetest4;
        if (!initGeetest4) {
          onErrorRef.current?.(tRef.current("captcha.geetestFailed"));
          return;
        }
        initGeetest4(
          { captchaId: captcha.geetest_captcha_id, product: "popup" },
          (captchaObj) => {
            geetestObjRef.current = captchaObj;
            // "popup" renders its own trigger button into the container; it must
            // be mounted with appendTo or the widget never appears and onReady
            // never fires.
            if (containerRef.current) {
              captchaObj.appendTo(containerRef.current);
            }
            captchaObj.onReady(() => setGeetestReady(true));
            captchaObj.onSuccess(() => {
              const result = captchaObj.getValidate();
              if (result) {
                onVerifiedRef.current({ provider: "geetest", geetest: result });
              }
            });
            captchaObj.onError(() =>
              onErrorRef.current?.(tRef.current("captcha.geetestFailed")),
            );
          },
        );
      },
    );
    return () => {
      try {
        geetestObjRef.current?.destroy?.();
      } catch {
        // Already gone.
      }
      geetestObjRef.current = null;
      removeScript();
    };
  }, [provider, captcha.geetest_captcha_id]);

  // ─── Cap ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (provider !== "cap") return;
    const container = containerRef.current;
    if (!container) return;
    let el: HTMLElement | null = null;
    let cancelled = false;

    // The endpoint the widget POSTs {endpoint}challenge / {endpoint}redeem to.
    // Embedded mode is served by this Worker; external mode targets a
    // self-hosted Cap Standalone server keyed by the site key.
    const endpoint =
      captcha.cap_mode === "external"
        ? `${captcha.cap_api_endpoint.replace(/\/+$/, "")}/${captcha.cap_site_key}/`
        : "/api/auth/cap/";

    // @cap.js/widget registers the <cap-widget> custom element as a side effect;
    // import it client-side only (this file is SSR'd).
    void import("@cap.js/widget").then(() => {
      if (cancelled || !containerRef.current) return;
      el = document.createElement("cap-widget");
      el.setAttribute("data-cap-api-endpoint", endpoint);
      el.addEventListener("solve", (e: Event) => {
        const detail = (e as CustomEvent<{ token: string }>).detail;
        if (detail?.token) {
          onVerifiedRef.current({ provider: "cap", cap_token: detail.token });
        }
      });
      el.addEventListener("error", () =>
        onErrorRef.current?.(tRef.current("captcha.capFailed")),
      );
      containerRef.current.appendChild(el);
    });

    return () => {
      cancelled = true;
      el?.remove();
    };
  }, [
    provider,
    captcha.cap_mode,
    captcha.cap_api_endpoint,
    captcha.cap_site_key,
  ]);

  // ─── Render per provider ──────────────────────────────────────────────────

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
          value={powState === "done" ? 1 : powState === "solving" ? undefined : 0}
        />
      </div>
    );
  }

  // reCAPTCHA v3 is invisible.
  if (provider === "recaptcha") return null;

  if (provider === "geetest") {
    // The "popup" widget renders its own trigger button into the container once
    // ready; show a loading hint until then.
    return (
      <div>
        <div ref={containerRef} />
        {!geetestReady && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Spinner size="tiny" />
            <Text>{t("captcha.loading")}</Text>
          </div>
        )}
      </div>
    );
  }

  // Turnstile, hCaptcha, Cap all render into the container element.
  return <div ref={containerRef} />;
}

// ─── Public component: enabled set + switching ────────────────────────────────

export function Captcha({ captcha, onVerified, onError }: CaptchaProps) {
  const { t } = useTranslation();

  // Enabled providers with "none" filtered out.
  const providers = useMemo<CaptchaProvider[]>(
    () => captcha.captcha_providers.filter((p) => p !== "none"),
    [captcha.captcha_providers],
  );

  // Initial active provider: the stored preference if it's still enabled,
  // otherwise the default (element 0).
  const [active, setActive] = useState<CaptchaProvider | null>(null);
  useEffect(() => {
    // Syncing the active provider to the enabled set + the stored preference is
    // exactly the "read from an external system on change" case; the stored
    // preference also has to be read after mount to avoid an SSR/CSR mismatch.
    const next =
      providers.length === 0
        ? null
        : (() => {
            const stored = loadStoredProvider();
            return stored && providers.includes(stored) ? stored : providers[0];
          })();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing active provider to enabled set / localStorage preference
    setActive(next);
  }, [providers]);

  const [showSwitch, setShowSwitch] = useState(false);

  // Timeout nudge: reveal the switcher after the configured delay if the
  // visitor hasn't finished yet. 0 disables it. Only relevant with alternates.
  // setState happens inside the timer callback, not synchronously in the effect.
  useEffect(() => {
    const secs = captcha.captcha_switch_timeout_seconds;
    if (providers.length < 2 || !secs || secs <= 0) return;
    const id = setTimeout(() => setShowSwitch(true), secs * 1000);
    return () => clearTimeout(id);
  }, [active, providers, captcha.captcha_switch_timeout_seconds]);

  const handleError = useCallback(
    (err: string) => {
      // A failure is exactly when the alternates become useful.
      setShowSwitch(true);
      onError?.(err);
    },
    [onError],
  );

  const switchTo = useCallback((p: CaptchaProvider) => {
    setActive(p);
    storeProvider(p);
  }, []);

  if (active === null || providers.length === 0) return null;

  const alternates = providers.filter((p) => p !== active);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {/* key on active provider so switching remounts the widget cleanly */}
      <ProviderWidget
        key={active}
        provider={active}
        captcha={captcha}
        onVerified={onVerified}
        onError={handleError}
      />

      {alternates.length > 0 && showSwitch && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <Text size={200}>{t("captcha.switchPrompt")}</Text>
          {alternates.map((p) => (
            <Link key={p} as="button" onClick={() => switchTo(p)}>
              {t(`captcha.provider_${p}`)}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Injected-global type stubs ───────────────────────────────────────────────

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

interface GeetestValidate {
  lot_number: string;
  captcha_output: string;
  pass_token: string;
  gen_time: string;
}
interface GeetestCaptchaObj {
  appendTo: (selector: string | HTMLElement) => void;
  onReady: (fn: () => void) => void;
  onSuccess: (fn: () => void) => void;
  onError: (fn: () => void) => void;
  getValidate: () => GeetestValidate | undefined;
  showCaptcha?: () => void;
  destroy?: () => void;
}
interface GeetestWindow extends Window {
  initGeetest4?: (
    config: { captchaId: string; product?: string },
    callback: (obj: GeetestCaptchaObj) => void,
  ) => void;
}

function widgetApi(name: "turnstile" | "hcaptcha"): WidgetApi {
  return (window as unknown as Record<string, WidgetApi>)[name];
}
