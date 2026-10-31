// Client-only i18n init. Server-side rendering uses createServerI18n
// from ./init.ts (which omits the browser language detector).

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { RESOURCES, SUPPORTED_LNGS } from "./init";
import { LANGUAGE_COOKIE } from "../store/language";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: RESOURCES,
    fallbackLng: "en",
    supportedLngs: [...SUPPORTED_LNGS],
    interpolation: { escapeValue: false },
    detection: {
      order: ["cookie", "navigator"],
      lookupCookie: LANGUAGE_COOKIE,
      // The language store writes the cookie; the detector only reads.
      caches: [],
    },
  });

// Keep <html lang> in step for screen readers and translation tools.
i18n.on("languageChanged", (lng) => {
  if (typeof document !== "undefined") document.documentElement.lang = lng;
});

export default i18n;
