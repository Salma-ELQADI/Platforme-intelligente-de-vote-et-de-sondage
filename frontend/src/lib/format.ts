const dateFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

export const formatDate = (iso: string) => dateFormatter.format(new Date(iso));

/** "dans 2 h 15 min", "dans 40 s"... */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return "terminé";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} j ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s % 60} s`;
  return `${s} s`;
}

/** Converts an ISO date to the value expected by <input type="datetime-local"> (local time). */
export function toDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

const editionFormatter = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortFormatter = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** "lundi 23 novembre 2026" — used in the masthead dateline. */
export const formatEditionDate = (d: Date = new Date()) => editionFormatter.format(d);
/** "23/11/2026" — compact, set in monospace. */
export const formatShortDate = (iso: string) => shortFormatter.format(new Date(iso));
/** "23/11/2026 · 14:05" style split for mono metadata. */
export const formatTime = (iso: string) => timeFormatter.format(new Date(iso));
/** Short reference derived from an id, printed like a ballot serial number. */
export const serial = (id: string) => id.replace(/-/g, "").slice(0, 6).toUpperCase();
