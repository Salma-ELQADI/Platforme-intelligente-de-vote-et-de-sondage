"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useMessaging } from "@/contexts/MessagingContext";
import { useI18n } from "@/contexts/PreferencesContext";
import { useSocket } from "@/contexts/SocketContext";
import { cn } from "@/lib/format";
import { DoubleRule, Fleuron } from "./decor";
import { PreferenceSwitchers } from "./PreferenceSwitchers";

const sections = [
  { href: "/", key: "front" },
  { href: "/polls", key: "polls" },
  { href: "/polls/new", key: "write" },
  { href: "/messages", key: "messages" },
  { href: "/my-polls", key: "myPolls" },
  { href: "/my-votes", key: "myVotes" },
];

/** Unread counter set in mono on solid ink, like a page number. */
function Count({ n }: { n: number }) {
  return n > 0 ? <span className="bg-accent px-1.5 py-0.5 font-mono text-[10px] leading-none text-on-accent">{n > 99 ? "99+" : n}</span> : null;
}

/**
 * Masthead. The front page ("/") gets the full nameplate; inner pages a compact one,
 * as in a printed newspaper. The section bar stays visible while scrolling.
 */
export function Navbar() {
  const { user, status, logout } = useAuth();
  const { unreadCount, connected } = useSocket();
  const { totalUnread } = useMessaging();
  const { t, fmt } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const front = pathname === "/";

  const links = (user ? (user.role === "admin" ? [...sections, { href: "/admin/users", key: "admin" }] : sections) : []).map((l) => ({
    ...l,
    label: t(`nav.${l.key}`),
  }));
  const isActive = (href: string) =>
    href === "/" ? front : href === "/polls" ? pathname === "/polls" || (pathname.startsWith("/polls/") && pathname !== "/polls/new") : pathname.startsWith(href);

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    router.push("/login");
  };

  return (
    <>
      {/* Dateline strip */}
      <div className="border-b border-rule">
        <div className="mx-auto flex h-10 max-w-6xl items-center justify-between gap-4 px-4 text-xs sm:px-6">
          <span className="kicker hidden text-umber lg:inline" suppressHydrationWarning>
            {fmt.editionDate()}
          </span>
          {!front && (
            <Link href="/" className="font-serif text-xl font-black text-ink sm:hidden">
              {t("common.brand")}
            </Link>
          )}
          <div className="ms-auto flex items-center gap-4">
            <PreferenceSwitchers />
            {user ? (
              <>
                <Link
                  href="/messages"
                  className="kicker relative flex items-center gap-1.5 text-ink hover:text-umber"
                  aria-label={t("nav.messagesLabel", { count: totalUnread })}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
                    <path strokeLinejoin="round" d="M4 5h16v11H9l-5 4V5Z" />
                  </svg>
                  <Count n={totalUnread} />
                </Link>
                <Link
                  href="/notifications"
                  className="kicker relative flex items-center gap-1.5 text-ink hover:text-umber"
                  aria-label={t("nav.noticesLabel", { count: unreadCount })}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0a3 3 0 11-6 0" />
                  </svg>
                  <span className="hidden sm:inline">{t("nav.notices")}</span>
                  <Count n={unreadCount} />
                </Link>
                <Link href="/profile" className="kicker hidden items-center gap-1.5 text-ink hover:text-umber sm:flex">
                  <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-accent" : "bg-muted")} aria-hidden="true" />
                  <span className="sr-only">{connected ? t("nav.realtimeOn") : t("nav.realtimeOff")},</span>
                  <bdi>{user.username}</bdi>
                </Link>
                <button onClick={handleLogout} className="kicker hidden text-umber hover:text-ink md:block">
                  {t("nav.logout")}
                </button>
                <button className="kicker text-ink md:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                  {open ? t("nav.closeMenu") : t("nav.menu")}
                </button>
              </>
            ) : (
              status === "anonymous" && (
                <>
                  <Link href="/login" className="kicker text-ink hover:text-umber">{t("nav.login")}</Link>
                  <Link href="/register" className="kicker hidden bg-ink px-3 py-1.5 text-paper hover:bg-umber sm:inline-block">{t("nav.register")}</Link>
                </>
              )
            )}
          </div>
        </div>
      </div>

      {/* Nameplate */}
      {front ? (
        <div className="mx-auto w-full max-w-6xl px-4 pt-8 text-center sm:px-6">
          <Link href="/" className="inline-block font-serif text-6xl font-black leading-none tracking-tight text-ink sm:text-8xl" dir="ltr">
            {t("common.brand")}
          </Link>
          <div className="mt-3 flex items-center justify-center gap-4 text-umber">
            <span className="font-serif text-base italic sm:text-lg">{t("common.tagline")}</span>
            <Fleuron size={10} />
            <span className="font-arabic text-lg sm:text-xl" lang="ar">{t("common.brandArabic")}</span>
          </div>
          <DoubleRule className="mt-6" />
        </div>
      ) : null}

      {/* Section bar */}
      {user && (
        <nav className="paper-grain sticky top-0 z-40 md:border-b md:border-ink" aria-label={t("nav.sections")}>
          <div className="mx-auto hidden h-12 max-w-6xl items-center gap-6 px-4 sm:px-6 md:flex">
            {!front && (
              <Link href="/" className="hidden shrink-0 font-serif text-2xl font-black text-ink sm:block">
                {t("common.brand")}
              </Link>
            )}
            <ul className={cn("hidden h-full items-stretch gap-5 md:flex lg:gap-6", front ? "mx-auto" : "ms-auto")}>
              {links.map((l) => (
                <li key={l.href} className="flex">
                  <Link
                    href={l.href}
                    aria-current={isActive(l.href) ? "page" : undefined}
                    className={cn("kicker flex items-center gap-1.5 border-b-2 transition-colors", isActive(l.href) ? "border-ink text-ink" : "border-transparent text-umber hover:text-ink")}
                  >
                    {l.label}
                    {l.href === "/messages" && <Count n={totalUnread} />}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          {open && (
            <ul className="border-b border-ink bg-paper px-4 py-2 md:hidden">
              {[...links, { href: "/notifications", label: t("nav.notices") }, { href: "/profile", label: t("nav.profile") }, { href: "/settings", label: t("nav.settings") }].map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className={cn("flex items-center justify-between border-b border-rule/70 py-3 font-serif text-lg", isActive(l.href) ? "text-ink" : "text-umber")}
                  >
                    <span className="flex items-center gap-2">
                      {l.label}
                      {l.href === "/messages" && <Count n={totalUnread} />}
                    </span>
                    {isActive(l.href) && <Fleuron size={10} />}
                  </Link>
                </li>
              ))}
              <li>
                <button onClick={handleLogout} className="kicker w-full py-3 text-start text-umber">{t("nav.logout")}</button>
              </li>
            </ul>
          )}
        </nav>
      )}
      {(!user || !open) && !front && <div className={cn("border-b border-ink", user && "md:hidden")} />}
    </>
  );
}
