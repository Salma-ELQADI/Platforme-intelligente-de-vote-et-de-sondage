"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSocket } from "@/contexts/SocketContext";
import { cn, formatEditionDate } from "@/lib/format";
import { DoubleRule, Fleuron } from "./decor";

const sections = [
  { href: "/", label: "À la une" },
  { href: "/polls", label: "Sondages" },
  { href: "/polls/new", label: "Rédiger" },
  { href: "/my-polls", label: "Mes sondages" },
  { href: "/my-votes", label: "Mes votes" },
];

/**
 * Masthead. The front page ("/") gets the full nameplate; inner pages a compact one,
 * as in a printed newspaper. The section bar stays visible while scrolling.
 */
export function Navbar() {
  const { user, status, logout } = useAuth();
  const { unreadCount, connected } = useSocket();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const front = pathname === "/";

  const links = user ? (user.role === "admin" ? [...sections, { href: "/admin/users", label: "Administration" }] : sections) : [];
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
          <span className="kicker hidden text-umber sm:inline" suppressHydrationWarning>
            {formatEditionDate()}
          </span>
          {!front && (
            <Link href="/" className="font-serif text-xl font-black text-ink sm:hidden">
              VoteLive
            </Link>
          )}
          <div className="ml-auto flex items-center gap-4">
            {user ? (
              <>
                <Link href="/notifications" className="kicker relative flex items-center gap-1.5 text-ink hover:text-umber" aria-label={`Notifications, ${unreadCount} non lue(s)`}>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0a3 3 0 11-6 0" />
                  </svg>
                  <span className="hidden sm:inline">Avis</span>
                  {unreadCount > 0 && <span className="bg-ink px-1.5 py-0.5 font-mono text-[10px] text-paper">{unreadCount}</span>}
                </Link>
                <Link href="/profile" className="kicker hidden items-center gap-1.5 text-ink hover:text-umber sm:flex">
                  <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-ink" : "bg-muted")} aria-hidden="true" />
                  <span className="sr-only">{connected ? "Temps réel connecté," : "Temps réel déconnecté,"}</span>
                  {user.username}
                </Link>
                <button onClick={handleLogout} className="kicker hidden text-umber hover:text-ink sm:block">
                  Déconnexion
                </button>
                <button className="kicker text-ink md:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                  {open ? "Fermer" : "Menu"}
                </button>
              </>
            ) : (
              status === "anonymous" && (
                <>
                  <Link href="/login" className="kicker text-ink hover:text-umber">Connexion</Link>
                  <Link href="/register" className="kicker bg-ink px-3 py-1.5 text-paper hover:bg-umber">Créer un compte</Link>
                </>
              )
            )}
          </div>
        </div>
      </div>

      {/* Nameplate */}
      {front ? (
        <div className="mx-auto w-full max-w-6xl px-4 pt-8 text-center sm:px-6">
          <Link href="/" className="inline-block font-serif text-6xl font-black leading-none tracking-tight text-ink sm:text-8xl">
            VoteLive
          </Link>
          <div className="mt-3 flex items-center justify-center gap-4 text-umber">
            <span className="font-serif text-base italic sm:text-lg">Le journal des opinions, en temps réel</span>
            <Fleuron size={10} />
            <span className="font-arabic text-lg sm:text-xl" lang="ar">صوت الرأي</span>
          </div>
          <DoubleRule className="mt-6" />
        </div>
      ) : null}

      {/* Section bar */}
      {user && (
        <nav className="paper-grain sticky top-0 z-40 md:border-b md:border-ink" aria-label="Rubriques">
          <div className="mx-auto hidden h-12 max-w-6xl items-center gap-6 px-4 sm:px-6 md:flex">
            {!front && (
              <Link href="/" className="hidden shrink-0 font-serif text-2xl font-black text-ink sm:block">
                VoteLive
              </Link>
            )}
            <ul className={cn("hidden h-full items-stretch gap-6 md:flex", front ? "mx-auto" : "ml-auto")}>
              {links.map((l) => (
                <li key={l.href} className="flex">
                  <Link
                    href={l.href}
                    aria-current={isActive(l.href) ? "page" : undefined}
                    className={cn("kicker flex items-center border-b-2 transition-colors", isActive(l.href) ? "border-ink text-ink" : "border-transparent text-umber hover:text-ink")}
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          {open && (
            <ul className="border-b border-ink bg-paper px-4 py-2 md:hidden">
              {[...links, { href: "/profile", label: "Mon profil" }, { href: "/notifications", label: "Avis" }].map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className={cn("flex items-center justify-between border-b border-rule/70 py-3 font-serif text-lg", isActive(l.href) ? "text-ink" : "text-umber")}
                  >
                    {l.label}
                    {isActive(l.href) && <Fleuron size={10} />}
                  </Link>
                </li>
              ))}
              <li>
                <button onClick={handleLogout} className="kicker w-full py-3 text-left text-umber">Déconnexion</button>
              </li>
            </ul>
          )}
        </nav>
      )}
      {(!user || !open) && !front && <div className={cn("border-b border-ink", user && "md:hidden")} />}
    </>
  );
}
