// Zustand language-mode store, the counterpart of store/theme.
//
// The explicit choice lives in the prism_lang cookie so the server renders
// in it (src/worker/ssr.ts reads the cookie; the browser-side detector reads it
// too). "system" is the absence of the cookie: the server then follows
// Accept-Language and the client the browser's language list.

import { create } from "zustand";
import i18n from "i18next";
import { SUPPORTED_LNGS, type SupportedLng } from "../i18n/init";

export type LanguageMode = "system" | SupportedLng;

export const LANGUAGE_COOKIE = "prism_lang";
const isBrowser = typeof document !== "undefined";

function isSupported(value: string | null | undefined): value is SupportedLng {
  return (SUPPORTED_LNGS as readonly string[]).includes(value ?? "");
}

function readCookie(): string | null {
  if (!isBrowser) return null;
  const hit = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LANGUAGE_COOKIE}=`));
  return hit ? decodeURIComponent(hit.slice(LANGUAGE_COOKIE.length + 1)) : null;
}

/** The first of the browser's preferred languages we support. */
function browserLanguage(): SupportedLng {
  const prefs =
    typeof navigator === "undefined"
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language];
  for (const tag of prefs) {
    const base = tag.toLowerCase().split("-")[0];
    if (isSupported(base)) return base;
  }
  return "en";
}

function readInitialMode(): LanguageMode {
  const raw = readCookie();
  return isSupported(raw) ? raw : "system";
}

interface LanguageState {
  mode: LanguageMode;
  setMode: (mode: LanguageMode) => void;
}

export const useLanguageStore = create<LanguageState>((set) => ({
  mode: readInitialMode(),
  setMode: (mode) => {
    if (isBrowser) {
      document.cookie =
        mode === "system"
          ? `${LANGUAGE_COOKIE}=; path=/; max-age=0; samesite=lax`
          : `${LANGUAGE_COOKIE}=${mode}; path=/; max-age=31536000; samesite=lax`;
    }
    set({ mode });
    void i18n.changeLanguage(mode === "system" ? browserLanguage() : mode);
  },
}));
