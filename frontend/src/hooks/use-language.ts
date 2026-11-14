import { useTranslation } from "react-i18next";
import { changeLanguage, type Language } from "@/i18n";

/** Idioma activo ("es" | "en") y función para cambiarlo. Re-renderiza al cambiar de idioma. */
export function useLanguage() {
  const { i18n } = useTranslation();
  const language: Language = (i18n.resolvedLanguage ?? i18n.language ?? "es").startsWith("en") ? "en" : "es";
  return { language, setLanguage: changeLanguage };
}
