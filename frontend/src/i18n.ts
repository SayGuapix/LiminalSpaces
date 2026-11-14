import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import world3dES from "./locales/es/world3d.json";
import world3dEN from "./locales/en/world3d.json";

export const SUPPORTED_LANGUAGES = ["es", "en"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

const resources = {
  es: { world3d: world3dES },
  en: { world3d: world3dEN },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: SUPPORTED_LANGUAGES,
    // "en-US" guardado o del navegador se trata como "en".
    load: "languageOnly",
    nonExplicitSupportedLngs: true,
    // Sin elección guardada, arranca en español.
    fallbackLng: "es",
    interpolation: { escapeValue: false }, // React ya escapa el HTML.
    detection: {
      order: ["localStorage"],
      caches: ["localStorage"],
    },
  });

const syncDocumentLanguage = (lng: string) => {
  document.documentElement.lang = lng.startsWith("en") ? "en" : "es";
};
syncDocumentLanguage(i18n.resolvedLanguage ?? "es");
i18n.on("languageChanged", syncDocumentLanguage);

export const changeLanguage = (lng: Language) => i18n.changeLanguage(lng);

export default i18n;
