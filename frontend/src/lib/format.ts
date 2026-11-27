import type { Locale } from "@/types";
import { localeMeta } from "@/i18n/config";
import type { Vars } from "@/i18n/translate";

/** Converts an ISO date to the value expected by <input type="datetime-local"> (local time). */
export function toDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

/** Short reference derived from an id, printed like a ballot serial number. */
export const serial = (id: string) => id.replace(/-/g, "").slice(0, 6).toUpperCase();

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const DAY = 86_400_000;

/**
 * Date and number formatting for one locale, built once per language change.
 * Everything goes through Intl, so month names, weekday names and number
 * punctuation follow the reader's language (Western digits in Arabic).
 */
export function createFormatters(locale: Locale, t: (key: string, vars?: Vars) => string) {
  const intl = localeMeta[locale].intl;
  const dateTime = new Intl.DateTimeFormat(intl, { dateStyle: "medium", timeStyle: "short" });
  const edition = new Intl.DateTimeFormat(intl, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const short = new Intl.DateTimeFormat(intl, { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = new Intl.DateTimeFormat(intl, { hour: "2-digit", minute: "2-digit" });
  const weekday = new Intl.DateTimeFormat(intl, { weekday: "short" });
  const longDay = new Intl.DateTimeFormat(intl, { weekday: "long", day: "numeric", month: "long" });
  const percent = new Intl.NumberFormat(intl, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const number = new Intl.NumberFormat(intl);

  return {
    date: (iso: string) => dateTime.format(new Date(iso)),
    /** "lundi 23 novembre 2026" — masthead dateline. */
    editionDate: (d: Date = new Date()) => edition.format(d),
    /** "23/11/2026" — compact, set in monospace. */
    shortDate: (iso: string) => short.format(new Date(iso)),
    time: (iso: string) => time.format(new Date(iso)),
    /** "45,5 %" / "45.5%" — the percent sign placement comes from the dictionary. */
    percent: (n: number) => t("common.percent", { value: percent.format(n) }),
    number: (n: number) => number.format(n),
    /** "2 j 4 h", "12 min 5 s"… */
    remaining(ms: number) {
      if (ms <= 0) return t("time.over");
      const s = Math.floor(ms / 1000);
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      if (d > 0) return t("time.daysHours", { d, h });
      if (h > 0) return t("time.hoursMinutes", { h, m });
      if (m > 0) return t("time.minutesSeconds", { m, s: s % 60 });
      return t("time.seconds", { s });
    },
    /** Conversation list: "14:05" today, "Hier", "lun." this week, then a date. */
    listTime(iso: string) {
      const d = new Date(iso);
      const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / DAY);
      if (days <= 0) return time.format(d);
      if (days === 1) return t("time.yesterday");
      if (days < 7) return weekday.format(d);
      return short.format(d);
    },
    /** Day separators inside a conversation. */
    dayLabel(iso: string) {
      const d = new Date(iso);
      const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / DAY);
      if (days <= 0) return t("time.today");
      if (days === 1) return t("time.yesterday");
      return longDay.format(d);
    },
    sameDay: (a: string, b: string) => startOfDay(new Date(a)) === startOfDay(new Date(b)),
  };
}

export type Formatters = ReturnType<typeof createFormatters>;
