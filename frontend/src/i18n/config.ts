import type { Locale, ThemePreference } from "@/types";

export const LOCALES: Locale[] = ["fr", "en", "ar"];
export const DEFAULT_LOCALE: Locale = "fr";

/** Cookies (not localStorage) so that the server renders the right language and theme: no flash. */
export const LOCALE_COOKIE = "votelive-locale";
export const THEME_COOKIE = "votelive-theme";

export const localeMeta: Record<Locale, { dir: "ltr" | "rtl"; intl: string; label: string }> = {
  fr: { dir: "ltr", intl: "fr-FR", label: "Français" },
  en: { dir: "ltr", intl: "en-GB", label: "English" },
  // Moroccan Arabic conventions, with Western digits (as in the Moroccan press): timestamps,
  // percentages and counters stay readable next to Latin text.
  ar: { dir: "rtl", intl: "ar-MA-u-nu-latn", label: "العربية" },
};

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as string[]).includes(v);
export const isTheme = (v: unknown): v is ThemePreference => v === "system" || v === "light" || v === "dark";

/** Picks the best supported language from an Accept-Language header. */
export function negotiateLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { lang: tag.toLowerCase().split("-")[0], q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  return ranked.find((r) => isLocale(r.lang))?.lang as Locale | undefined ?? DEFAULT_LOCALE;
}
