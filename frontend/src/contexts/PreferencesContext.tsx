"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { createFormatters, type Formatters } from "@/lib/format";
import { LOCALE_COOKIE, localeMeta, THEME_COOKIE } from "@/i18n/config";
import { hasKey, translate, translateRich, type Vars } from "@/i18n/translate";
import type { Locale, ThemePreference, User } from "@/types";

interface PreferencesValue {
  locale: Locale;
  dir: "ltr" | "rtl";
  theme: ThemePreference;
  messageNotifications: boolean;
  setLocale: (l: Locale) => void;
  setTheme: (t: ThemePreference) => void;
  setMessageNotifications: (v: boolean) => void;
  /** Applies the preferences stored on the account, right after authentication. */
  adoptAccountPreferences: (user: User | null) => void;
  t: (key: string, vars?: Vars) => string;
  rich: (key: string, vars: Record<string, ReactNode>, count?: number) => ReactNode;
  fmt: Formatters;
  /** Human message for any error, in the reader's language. */
  errorText: (err: unknown) => string;
  /** Message for one form field reported by the API, in the reader's language. */
  fieldError: (err: ApiError | null | undefined, field: string) => string | undefined;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

const ONE_YEAR = 60 * 60 * 24 * 365;
const writeCookie = (name: string, value: string) => {
  document.cookie = `${name}=${value}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax`;
};

/** Mirrors the server-rendered attributes: <html lang dir data-theme>. */
function applyToDocument(locale: Locale, theme: ThemePreference) {
  const root = document.documentElement;
  root.lang = locale;
  root.dir = localeMeta[locale].dir;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

/**
 * Language and theme. The initial values come from cookies read by the
 * server (layout.tsx), so the first paint is already in the right language,
 * direction and colours. Visitors keep their choice in those cookies; signed-in
 * users also save it on their account, which wins on the next login.
 */
export function PreferencesProvider({ initialLocale, initialTheme, children }: { initialLocale: Locale; initialTheme: ThemePreference; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [theme, setThemeState] = useState<ThemePreference>(initialTheme);
  const [messageNotifications, setNotifState] = useState(true);
  const signedIn = useRef(false);
  // Latest values for the callbacks below, without re-creating them.
  const current = useRef({ locale: initialLocale, theme: initialTheme });

  const save = useCallback((body: Parameters<typeof api.updatePreferences>[0]) => {
    if (signedIn.current) api.updatePreferences(body).catch(() => undefined);
  }, []);

  const setLocale = useCallback(
    (l: Locale) => {
      current.current.locale = l;
      setLocaleState(l);
      writeCookie(LOCALE_COOKIE, l);
      applyToDocument(l, current.current.theme);
      save({ locale: l });
    },
    [save],
  );

  const setTheme = useCallback(
    (th: ThemePreference) => {
      current.current.theme = th;
      setThemeState(th);
      writeCookie(THEME_COOKIE, th);
      // Colours cross-fade only during the switch itself (see .theme-switching in globals.css).
      const root = document.documentElement;
      root.classList.add("theme-switching");
      window.setTimeout(() => root.classList.remove("theme-switching"), 320);
      applyToDocument(current.current.locale, th);
      save({ theme: th });
    },
    [save],
  );

  const setMessageNotifications = useCallback(
    (v: boolean) => {
      setNotifState(v);
      save({ messageNotifications: v });
    },
    [save],
  );

  const adoptAccountPreferences = useCallback((user: User | null) => {
    signedIn.current = !!user;
    if (!user) return;
    const p = user.preferences;
    // No language saved on the account yet: keep the one the visitor already chose.
    const locale = p.locale ?? current.current.locale;
    current.current = { locale, theme: p.theme };
    setNotifState(p.messageNotifications);
    setLocaleState(locale);
    setThemeState(p.theme);
    writeCookie(LOCALE_COOKIE, locale);
    writeCookie(THEME_COOKIE, p.theme);
    applyToDocument(locale, p.theme);
  }, []);

  const value = useMemo<PreferencesValue>(() => {
    const t = (key: string, vars?: Vars) => translate(locale, key, vars);
    return {
      locale,
      dir: localeMeta[locale].dir,
      theme,
      messageNotifications,
      setLocale,
      setTheme,
      setMessageNotifications,
      adoptAccountPreferences,
      t,
      rich: (key, vars, count) => translateRich(locale, key, vars, count),
      fmt: createFormatters(locale, t),
      errorText(err) {
        if (!(err instanceof ApiError)) return t("errors.UNKNOWN");
        if (err.code === "CLIENT") return err.message; // already translated by the component
        // Backend messages are written in French and are the most precise wording.
        if (locale === "fr" && err.code !== "NETWORK_ERROR") return err.message;
        return hasKey(locale, `errors.${err.code}`) ? t(`errors.${err.code}`) : t("errors.UNKNOWN");
      },
      fieldError(err, field) {
        const detail = err?.fieldDetail(field);
        if (!detail) return undefined;
        if (err?.code === "CLIENT") return detail.message;
        // A precise code ("SELF_INVITE", "UNKNOWN_VOTERS"…) is worded exactly, in every language.
        if (detail.code && hasKey(locale, `fieldErrors.codes.${detail.code}`)) return t(`fieldErrors.codes.${detail.code}`, detail.params);
        if (locale === "fr") return detail.message;
        return hasKey(locale, `fieldErrors.${field}`) ? t(`fieldErrors.${field}`) : t("errors.VALIDATION_ERROR");
      },
    };
  }, [locale, theme, messageNotifications, setLocale, setTheme, setMessageNotifications, adoptAccountPreferences]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used inside <PreferencesProvider>");
  return ctx;
}

/** Shorthand for components that only translate and format. */
export const useI18n = usePreferences;
