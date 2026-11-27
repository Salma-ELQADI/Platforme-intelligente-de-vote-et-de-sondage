"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useMessaging } from "@/contexts/MessagingContext";
import { useI18n } from "@/contexts/PreferencesContext";
import { useSocket } from "@/contexts/SocketContext";
import { cn } from "@/lib/format";
import { DoubleRule, Fleuron } from "./decor";
import { PreferenceSwitchers } from "./PreferenceSwitchers";

/** The reading sections. Messages, notices and the account live in their own groups. */
const sections = [
  { href: "/", key: "front" },
  { href: "/polls", key: "polls" },
  { href: "/polls/new", key: "write" },
  { href: "/my-polls", key: "myPolls" },
  { href: "/my-votes", key: "myVotes" },
];

/** Unread counter set in mono on copper, like a page number. Re-keyed so it pops when it changes. */
function Count({ n, className }: { n: number; className?: string }) {
  return n > 0 ? (
    <span key={n} className={cn("animate-count-pop inline-grid min-w-[1.15rem] place-items-center bg-accent px-1 py-0.5 font-mono text-[10px] leading-none text-on-accent", className)}>
      {n > 99 ? "99+" : n}
    </span>
  ) : null;
}

const MessagesIcon = () => (
  <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
    <path strokeLinejoin="round" d="M4 5h16v11H9l-5 4V5Z" />
  </svg>
);
const BellIcon = () => (
  <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0a3 3 0 11-6 0" />
  </svg>
);

/** Icon link with a counter in its corner (messages, notices). */
function IconLink({ href, label, active, count, children }: { href: string; label: string; active: boolean; count: number; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      aria-current={active ? "page" : undefined}
      className={cn("relative grid h-10 w-10 place-items-center transition-colors", active ? "text-ink" : "text-umber hover:text-ink")}
    >
      {children}
      <Count n={count} className="absolute -end-1 top-0.5" />
      {active && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-ink" aria-hidden="true" />}
    </Link>
  );
}

/** Account menu: profile, settings, sign-out. Closes on outside click and Escape. */
function AccountMenu({ username, connected, onLogout }: { username: string; connected: boolean; onLogout: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  // Remembers the page it was opened on, so navigating closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => setOpenOn((typeof v === "function" ? v(open) : v) ? pathname : null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpenOn(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenOn(null);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = [...username.trim()][0]?.toUpperCase() ?? "?";
  const item = "flex w-full items-center px-4 py-2.5 text-start text-sm text-ink transition-colors hover:bg-cream";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("nav.accountMenu")}
        className={cn("flex h-10 items-center gap-2 border px-1.5 transition-colors", open ? "border-ink" : "border-transparent hover:border-rule")}
      >
        <span className="relative grid h-7 w-7 place-items-center rounded-full border border-ink font-serif text-sm font-bold text-ink">
          {initial}
          <span className={cn("absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full border-2 border-cream", connected ? "bg-copper" : "bg-muted")} aria-hidden="true" />
        </span>
        <bdi className="hidden max-w-[9rem] truncate text-sm font-medium text-ink xl:block">{username}</bdi>
        <svg className={cn("h-3.5 w-3.5 text-umber transition-transform", open && "rotate-180")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="animate-menu-in absolute end-0 top-full z-50 mt-1 w-60 border border-ink bg-paper py-1 shadow-[4px_4px_0_var(--border)] rtl:shadow-[-4px_4px_0_var(--border)]">
          <div className="border-b border-rule px-4 pb-3 pt-2">
            <bdi className="block truncate font-serif text-lg font-bold text-ink">{username}</bdi>
            <span className="kicker mt-0.5 flex items-center gap-1.5 text-umber">
              <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-copper" : "bg-muted")} aria-hidden="true" />
              {connected ? t("nav.realtimeOn") : t("nav.realtimeOff")}
            </span>
          </div>
          <Link role="menuitem" href="/profile" className={item}>{t("nav.profile")}</Link>
          <Link role="menuitem" href="/settings" className={item}>{t("nav.settings")}</Link>
          <div className="my-1 h-px bg-rule" />
          <button role="menuitem" type="button" onClick={onLogout} className={cn(item, "text-umber hover:text-ink")}>{t("nav.logout")}</button>
        </div>
      )}
    </div>
  );
}

/**
 * Masthead. The front page ("/") gets the full nameplate; inner pages a compact one,
 * as in a printed newspaper. Desktop: one sticky bar grouped as sections | communication
 * | account. Below lg: a compact bar with the unread counters and a grouped drawer.
 */
export function Navbar() {
  const { user, status, logout } = useAuth();
  const { unreadCount, connected } = useSocket();
  const { totalUnread } = useMessaging();
  const { t, fmt } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => setOpenOn((typeof v === "function" ? v(open) : v) ? pathname : null);
  const front = pathname === "/";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenOn(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

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

  const brand = (
    <Link href="/" className="shrink-0 font-serif text-2xl font-black leading-none text-ink" dir="ltr">
      {t("common.brand")}
    </Link>
  );

  return (
    <>
      {/* Dateline strip (desktop): the edition's date and the reader's preferences */}
      <div className="hidden border-b border-rule lg:block">
        <div className="mx-auto flex h-9 max-w-6xl items-center justify-between gap-4 px-6">
          <span className="kicker text-umber" suppressHydrationWarning>{fmt.editionDate()}</span>
          <div className="flex items-center gap-5">
            <PreferenceSwitchers />
            {!user && status === "anonymous" && (
              <>
                <span className="h-4 w-px bg-rule" aria-hidden="true" />
                <Link href="/login" className="kicker text-ink hover:text-umber">{t("nav.login")}</Link>
                <Link href="/register" className="kicker bg-ink px-3 py-1.5 text-paper hover:bg-umber">{t("nav.register")}</Link>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Nameplate */}
      {front && (
        <div className="mx-auto w-full max-w-6xl px-4 pt-6 text-center sm:px-6 lg:pt-8">
          <Link href="/" className="inline-block font-serif text-5xl font-black leading-none tracking-tight text-ink sm:text-7xl lg:text-8xl" dir="ltr">
            {t("common.brand")}
          </Link>
          <div className="mt-3 flex items-center justify-center gap-4 text-umber">
            <span className="font-serif text-base italic sm:text-lg">{t("common.tagline")}</span>
            <Fleuron size={10} />
            <span className="font-arabic text-lg sm:text-xl" lang="ar">{t("common.brandArabic")}</span>
          </div>
          <DoubleRule className="mt-5 hidden lg:block" />
        </div>
      )}

      <nav className="paper-grain sticky top-0 z-40 border-b border-ink" aria-label={t("nav.sections")}>
        {/* ---------- Desktop bar ---------- */}
        {user && (
          <div className="mx-auto hidden h-14 max-w-6xl items-center gap-6 px-6 lg:flex">
            {!front && brand}
            <ul className={cn("flex h-full items-stretch gap-6", front ? "me-auto" : "ms-2 me-auto")}>
              {links.map((l) => (
                <li key={l.href} className="flex">
                  <Link
                    href={l.href}
                    aria-current={isActive(l.href) ? "page" : undefined}
                    className={cn("kicker flex items-center border-b-2 pt-0.5 transition-colors", isActive(l.href) ? "border-ink text-ink" : "border-transparent text-umber hover:text-ink")}
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>

            {/* Communication */}
            <Link
              href="/messages"
              aria-current={isActive("/messages") ? "page" : undefined}
              aria-label={t("nav.messagesLabel", { count: totalUnread })}
              className={cn(
                "kicker flex h-9 items-center gap-2 border px-3 transition-colors",
                isActive("/messages") ? "border-ink bg-ink text-paper" : "border-rule text-ink hover:border-ink",
              )}
            >
              <MessagesIcon />
              <span aria-hidden="true">{t("nav.messages")}</span>
              <Count n={totalUnread} />
            </Link>

            {/* Account */}
            <div className="flex items-center gap-1 border-s border-rule ps-4">
              <IconLink href="/notifications" label={t("nav.noticesLabel", { count: unreadCount })} active={isActive("/notifications")} count={unreadCount}>
                <BellIcon />
              </IconLink>
              <AccountMenu username={user.username} connected={connected} onLogout={handleLogout} />
            </div>
          </div>
        )}

        {/* ---------- Compact bar (mobile & tablet) ---------- */}
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:px-6 lg:hidden">
          {front ? <span className="kicker text-umber" suppressHydrationWarning>{fmt.editionDate()}</span> : brand}
          <div className="ms-auto flex items-center gap-1">
            {user ? (
              <>
                <IconLink href="/messages" label={t("nav.messagesLabel", { count: totalUnread })} active={isActive("/messages")} count={totalUnread}>
                  <MessagesIcon />
                </IconLink>
                <IconLink href="/notifications" label={t("nav.noticesLabel", { count: unreadCount })} active={isActive("/notifications")} count={unreadCount}>
                  <BellIcon />
                </IconLink>
                <button
                  type="button"
                  className={cn("grid h-10 w-10 place-items-center border transition-colors", open ? "border-ink bg-ink text-paper" : "border-transparent text-ink")}
                  onClick={() => setOpen((o) => !o)}
                  aria-expanded={open}
                  aria-controls="mobile-menu"
                  aria-label={open ? t("nav.closeMenu") : t("nav.menu")}
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
                    {open ? <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" /> : <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h10" />}
                  </svg>
                </button>
              </>
            ) : (
              status === "anonymous" && (
                <>
                  <PreferenceSwitchers />
                  <Link href="/login" className="kicker ms-2 text-ink hover:text-umber">{t("nav.login")}</Link>
                </>
              )
            )}
          </div>
        </div>

        {/* ---------- Drawer ---------- */}
        {user && open && (
          <div id="mobile-menu" className="animate-menu-in absolute inset-x-0 top-full max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-b border-ink bg-paper lg:hidden">
            <div className="mx-auto grid max-w-6xl gap-x-10 px-4 pb-6 pt-2 sm:grid-cols-2 sm:px-6">
              <MenuGroup title={t("nav.groupMain")}>
                {links.map((l) => (
                  <MenuLink key={l.href} href={l.href} active={isActive(l.href)}>{l.label}</MenuLink>
                ))}
              </MenuGroup>
              <div>
                <MenuGroup title={t("nav.groupCommunication")}>
                  <MenuLink href="/messages" active={isActive("/messages")} aside={<Count n={totalUnread} />}>{t("nav.messages")}</MenuLink>
                  <MenuLink href="/notifications" active={isActive("/notifications")} aside={<Count n={unreadCount} />}>{t("nav.notices")}</MenuLink>
                </MenuGroup>
                <MenuGroup title={t("nav.groupAccount")}>
                  <MenuLink href="/profile" active={isActive("/profile")} aside={<bdi className="font-mono text-xs text-umber">{user.username}</bdi>}>{t("nav.profile")}</MenuLink>
                  <MenuLink href="/settings" active={isActive("/settings")}>{t("nav.settings")}</MenuLink>
                  <li>
                    <button onClick={handleLogout} className="flex w-full items-center border-b border-rule/70 py-3 text-start font-serif text-lg text-umber hover:text-ink">
                      {t("nav.logout")}
                    </button>
                  </li>
                </MenuGroup>
                <div className="mt-5 flex items-center justify-between gap-4">
                  <span className="kicker text-umber">{t("nav.groupPreferences")}</span>
                  <PreferenceSwitchers />
                </div>
              </div>
            </div>
          </div>
        )}
      </nav>
    </>
  );
}

function MenuGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <p className="kicker border-b border-ink pb-2 text-umber">{title}</p>
      <ul>{children}</ul>
    </div>
  );
}

function MenuLink({ href, active, aside, children }: { href: string; active: boolean; aside?: ReactNode; children: ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn("flex items-center justify-between gap-3 border-b border-rule/70 py-3 font-serif text-lg transition-colors", active ? "font-semibold text-ink" : "text-umber hover:text-ink")}
      >
        <span className="flex items-center gap-2">
          {active && <Fleuron size={10} className="text-copper" />}
          {children}
        </span>
        {aside}
      </Link>
    </li>
  );
}
