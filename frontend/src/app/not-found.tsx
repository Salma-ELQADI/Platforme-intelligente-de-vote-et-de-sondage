"use client";

import { ButtonLink } from "@/components/ui";
import { DoubleRule } from "@/components/decor";
import { useI18n } from "@/contexts/PreferencesContext";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-2xl py-16 text-center">
      <DoubleRule />
      <p className="kicker mt-6 text-umber">{t("notFound.kicker")}</p>
      <p className="mt-3 font-mono text-7xl text-ink">404</p>
      <h1 className="mt-4 font-serif text-4xl font-black text-ink">{t("notFound.title")}</h1>
      <p className="mt-3 font-serif text-lg italic text-umber">{t("notFound.text")}</p>
      <ButtonLink href="/" className="mt-8">{t("notFound.back")}</ButtonLink>
    </div>
  );
}
