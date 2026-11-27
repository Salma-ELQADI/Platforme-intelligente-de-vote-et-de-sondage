"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/contexts/PreferencesContext";
import { Fleuron } from "./decor";

/**
 * Login / registration layout: an editorial column with a pull quote on the left,
 * the form on a sheet of paper on the right (stacked on small screens).
 */
export function AuthShell({ kicker, title, subtitle, quote, children, footer }: { kicker: string; title: string; subtitle: string; quote: string; children: ReactNode; footer: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-12 lg:grid-cols-12">
      <div className="lg:col-span-5">
        <p className="kicker text-umber">{kicker}</p>
        <h1 className="mt-3 font-serif text-5xl font-black leading-[1.02] text-ink">{title}</h1>
        <p className="mt-4 font-serif text-lg italic leading-snug text-umber">{subtitle}</p>
        <figure className="mt-10 hidden border-y border-ink py-6 lg:block">
          <Fleuron size={14} className="text-umber" />
          <blockquote className="mt-4 font-serif text-3xl italic leading-tight text-ink">{t("auth.quote", { text: quote })}</blockquote>
        </figure>
      </div>
      <div className="lg:col-span-6 lg:col-start-7">
        <div className="border border-ink bg-paper p-1.5">
          <div className="border border-rule px-6 py-8 sm:px-10 sm:py-10">
            {children}
            <div className="mt-8 border-t border-rule pt-5 text-sm text-umber">{footer}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
