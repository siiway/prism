// Shared i18n setup — used by both client and server entries.
//
// Splitting this out keeps the server bundle free of
// i18next-browser-languagedetector (which touches localStorage at module
// scope and would crash in a Cloudflare Worker).

import i18n, { type i18n as I18n } from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import zh from "./zh.json";

const RESOURCES = {
  en: { translation: en },
  zh: { translation: zh },
} as const;

export const SUPPORTED_LNGS = ["en", "zh"] as const;
export type SupportedLng = (typeof SUPPORTED_LNGS)[number];

/** Returns a fresh i18next instance bound to a specific language. */
export function createServerI18n(lng: string): I18n {
  const normalized: SupportedLng =
    SUPPORTED_LNGS.find((l) => lng.startsWith(l)) ?? "en";
  const instance = i18n.createInstance();
  void instance.use(initReactI18next).init({
    resources: RESOURCES,
    lng: normalized,
    fallbackLng: "en",
    supportedLngs: [...SUPPORTED_LNGS],
    interpolation: { escapeValue: false },
    initImmediate: false,
  });
  return instance;
}

/** Module-level singleton for the client. Shared across the whole app. */
export { i18n as clientI18n };
export { RESOURCES };
