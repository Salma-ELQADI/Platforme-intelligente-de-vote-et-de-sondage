"use client";

import Link from "next/link";
import { useI18n } from "@/contexts/PreferencesContext";
import { DoubleRule } from "./decor";

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="mx-auto mt-20 w-full max-w-6xl px-4 pb-10 sm:px-6">
      <DoubleRule />
      <div className="mt-8 grid gap-8 text-sm sm:grid-cols-3">
        <div>
          <p className="font-serif text-2xl font-black text-ink">{t("common.brand")}</p>
          <p className="mt-1 font-arabic text-lg text-umber" lang="ar">{t("common.brandArabic")}</p>
        </div>
        <nav aria-label={t("footer.sections")}>
          <p className="kicker text-umber">{t("footer.sections")}</p>
          <ul className="mt-3 space-y-1.5">
            <li><Link href="/polls" className="hover:underline">{t("footer.polls")}</Link></li>
            <li><Link href="/polls/new" className="hover:underline">{t("footer.write")}</Link></li>
            <li><Link href="/messages" className="hover:underline">{t("footer.messages")}</Link></li>
            <li><Link href="/my-votes" className="hover:underline">{t("footer.myVotes")}</Link></li>
            <li><Link href="/settings" className="hover:underline">{t("nav.settings")}</Link></li>
          </ul>
        </nav>
        <div>
          <p className="kicker text-umber">{t("footer.colophon")}</p>
          <p className="mt-3 leading-relaxed text-umber">{t("footer.colophonText")}</p>
        </div>
      </div>
    </footer>
  );
}
