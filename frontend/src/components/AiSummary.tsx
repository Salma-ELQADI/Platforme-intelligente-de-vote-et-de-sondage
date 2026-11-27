"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/contexts/PreferencesContext";
import { api, ApiError } from "@/lib/api";
import type { PollSummary } from "@/types";
import { Fleuron, PressLoader } from "./decor";

/**
 * "The desk's analysis": the AI summary of a closed poll, in the reader's
 * language. The server writes it once per language and caches it; when AI is
 * not configured on the server, the panel simply does not appear.
 */
export function AiSummary({ pollId }: { pollId: string }) {
  const { t, locale, errorText } = useI18n();
  const [state, setState] = useState<{ locale: string; summary?: PollSummary; error?: ApiError } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .pollSummary(pollId, locale)
      .then(({ summary }) => !cancelled && setState({ locale, summary }))
      .catch((error: ApiError) => !cancelled && setState({ locale, error }));
    return () => {
      cancelled = true;
    };
  }, [pollId, locale]);

  const current = state?.locale === locale ? state : null;
  // Nothing to say (no votes) or no AI on this server: no panel at all.
  if (current?.error && ["AI_NOT_CONFIGURED", "NO_VOTES", "POLL_NOT_CLOSED"].includes(current.error.code)) return null;

  return (
    <section className="border border-ink bg-paper p-1.5" aria-labelledby="ai-summary">
      <div className="border border-rule px-5 py-5 sm:px-7">
        <div className="flex items-center gap-3">
          <Fleuron size={12} className="text-accent" />
          <h2 id="ai-summary" className="kicker text-ink">{t("summary.title")}</h2>
          <span className="h-px flex-1 bg-rule" aria-hidden="true" />
        </div>
        {!current && <div className="py-6"><PressLoader label={t("summary.writing")} /></div>}
        {current?.summary && (
          <>
            <p dir="auto" className="mt-4 font-serif text-lg leading-relaxed text-ink">{current.summary.summary}</p>
            <p className="mt-3 font-mono text-[11px] text-umber">{t("summary.credit", { model: current.summary.model })}</p>
          </>
        )}
        {current?.error && <p className="mt-3 text-sm italic text-umber">{errorText(current.error)}</p>}
      </div>
    </section>
  );
}
