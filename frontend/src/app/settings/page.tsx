"use client";

import { ThemeIcon } from "@/components/PreferenceSwitchers";
import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { usePreferences } from "@/contexts/PreferencesContext";
import { LOCALES, localeMeta } from "@/i18n/config";
import { cn } from "@/lib/format";
import type { ThemePreference } from "@/types";

const THEMES: ThemePreference[] = ["system", "light", "dark"];

/** Miniature of a theme: page, sheet, rule and the two message bubbles. */
function Swatch({ theme }: { theme: "light" | "dark" }) {
  const c = theme === "light" ? { bg: "#e9ddc8", sheet: "#f5f0e6", ink: "#38291f", rule: "#cbbba4", out: "#38291f" } : { bg: "#211b17", sheet: "#302720", ink: "#f5f0e6", rule: "#514338", out: "#c49a70" };
  return (
    <span className="block h-16 w-full border" style={{ background: c.bg, borderColor: c.rule }} aria-hidden="true">
      <span className="m-2 block h-2 w-1/2" style={{ background: c.ink }} />
      <span className="mx-2 block h-px" style={{ background: c.rule }} />
      <span className="mx-2 mt-2 flex justify-between gap-2">
        <span className="block h-3 w-1/3 border" style={{ background: c.sheet, borderColor: c.rule }} />
        <span className="block h-3 w-1/3" style={{ background: c.out }} />
      </span>
    </span>
  );
}

/** Language, theme and notification preferences. Visitors: saved in cookies; members: also on the account. */
export default function SettingsPage() {
  const { status } = useAuth();
  const { locale, setLocale, theme, setTheme, messageNotifications, setMessageNotifications, t } = usePreferences();

  return (
    <>
      <PageHeader kicker={t("settings.kicker")} title={t("settings.title")} subtitle={t("settings.subtitle")} />
      <div className="grid max-w-4xl gap-12">
        <section>
          <SectionTitle number="01">{t("language.label")}</SectionTitle>
          <p className="mb-4 text-sm text-umber">{t("language.hint")}</p>
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label={t("language.label")}>
            {LOCALES.map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={locale === l}
                onClick={() => setLocale(l)}
                lang={l}
                dir={localeMeta[l].dir}
                className={cn(
                  "border px-4 py-4 text-start transition-colors",
                  locale === l ? "border-ink bg-paper" : "border-rule hover:border-umber",
                )}
              >
                <span className={cn("block text-xl font-bold text-ink", l === "ar" ? "font-arabic" : "font-serif")}>{localeMeta[l].label}</span>
                <span className="mt-1 block font-mono text-[11px] uppercase text-umber">{l} · {localeMeta[l].dir}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle number="02">{t("theme.label")}</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label={t("theme.label")}>
            {THEMES.map((th) => (
              <button
                key={th}
                type="button"
                role="radio"
                aria-checked={theme === th}
                onClick={() => setTheme(th)}
                className={cn("border p-3 text-start transition-colors", theme === th ? "border-ink bg-paper" : "border-rule hover:border-umber")}
              >
                {th === "system" ? (
                  <span className="grid grid-cols-2 gap-1"><Swatch theme="light" /><Swatch theme="dark" /></span>
                ) : (
                  <Swatch theme={th} />
                )}
                <span className="mt-3 flex items-center gap-2 font-serif text-lg font-bold text-ink">
                  <ThemeIcon theme={th} />
                  {t(`theme.${th}`)}
                </span>
                <span className="mt-0.5 block text-xs text-umber">{t(`theme.${th}Hint`)}</span>
              </button>
            ))}
          </div>
        </section>

        {status === "authenticated" && (
          <section>
            <SectionTitle number="03">{t("settings.notifications")}</SectionTitle>
            <Card>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={messageNotifications}
                  onChange={(e) => setMessageNotifications(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-[var(--foreground)]"
                />
                <span>
                  <span className="block font-medium text-ink">{t("settings.messageNotifications")}</span>
                  <span className="mt-0.5 block text-sm text-umber">{t("settings.messageNotificationsHint")}</span>
                </span>
              </label>
            </Card>
          </section>
        )}

        <p className="border-t border-rule pt-4 font-serif text-sm italic text-umber">
          {status === "authenticated" ? t("settings.savedOnAccount") : t("settings.savedOnDevice")}
        </p>
      </div>
    </>
  );
}
