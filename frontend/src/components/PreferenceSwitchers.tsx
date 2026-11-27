"use client";

import { usePreferences } from "@/contexts/PreferencesContext";
import { LOCALES, localeMeta } from "@/i18n/config";
import { cn } from "@/lib/format";
import type { ThemePreference } from "@/types";

const THEMES: ThemePreference[] = ["system", "light", "dark"];

/** Short form of each language for the dateline: the Arabic one in its own script. */
const shortLabel = { fr: "FR", en: "EN", ar: "ع" } as const;

export function ThemeIcon({ theme, className }: { theme: ThemePreference; className?: string }) {
  return (
    <svg className={cn("h-4 w-4", className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      {theme === "light" && <><circle cx="12" cy="12" r="4" /><path strokeLinecap="round" d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" /></>}
      {theme === "dark" && <path strokeLinejoin="round" d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />}
      {theme === "system" && <><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" /></>}
    </svg>
  );
}

/** Compact controls for the dateline strip. The full versions live on /settings. */
export function PreferenceSwitchers() {
  const { locale, setLocale, theme, setTheme, t } = usePreferences();
  const nextTheme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];

  return (
    <div className="flex items-center gap-3">
      <div role="group" aria-label={t("language.label")} className="flex items-center">
        {LOCALES.map((l, i) => (
          <span key={l} className="flex items-center">
            {i > 0 && <span className="mx-1.5 h-3 w-px bg-rule" aria-hidden="true" />}
            <button
              type="button"
              lang={l}
              onClick={() => setLocale(l)}
              aria-pressed={locale === l}
              aria-label={localeMeta[l].label}
              title={localeMeta[l].label}
              className={cn(
                "px-0.5 font-mono text-[11px] transition-colors",
                l === "ar" && "font-arabic text-sm leading-none",
                locale === l ? "text-ink underline decoration-1 underline-offset-4" : "text-umber hover:text-ink",
              )}
            >
              {shortLabel[l]}
            </button>
          </span>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setTheme(nextTheme)}
        className="grid h-7 w-7 place-items-center text-ink hover:text-umber"
        aria-label={`${t("theme.label")} : ${t(`theme.${theme}`)}`}
        title={`${t("theme.label")} : ${t(`theme.${theme}`)}`}
      >
        <ThemeIcon theme={theme} />
      </button>
    </div>
  );
}
