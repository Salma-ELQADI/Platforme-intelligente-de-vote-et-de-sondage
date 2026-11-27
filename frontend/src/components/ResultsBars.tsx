"use client";

import { useI18n } from "@/contexts/PreferencesContext";
import { cn } from "@/lib/format";
import type { PollResults } from "@/types";
import { Fleuron } from "./decor";

// Two inks only: segments are told apart by tone and engraving-style hatching.
const segmentStyle = ["bg-ink", "bg-umber", "hatch bg-paper", "bg-muted", "bg-rule", "hatch bg-rule"];

/**
 * Editorial results: a large count, a stacked distribution strip and a table of options
 * with thin bars. Widths animate when Socket.IO pushes new figures, and the row whose
 * count changed gets a brief ink wash.
 */
/**
 * The instant-runoff count as a table: one row per answer, one column per
 * round; "—" once an answer is eliminated. Set like a printed tally sheet.
 */
function RunoffTable({ results }: { results: PollResults }) {
  const { t, fmt } = useI18n();
  const rounds = results.rounds ?? [];
  if (rounds.length < 2) return null;
  return (
    <div>
      <p className="kicker text-ink">{t("results.runoff")}</p>
      <p className="mt-1 font-serif text-sm italic text-umber">{t("results.runoffText")}</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="border-b border-ink">
              <th className="py-2 pe-3 text-start font-normal"><span className="sr-only">{t("results.answer")}</span></th>
              {rounds.map((r) => (
                <th key={r.round} className="kicker px-2 py-2 text-end text-umber">{t("results.round", { n: fmt.number(r.round) })}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.options.map((o) => {
              const eliminatedAt = rounds.findIndex((r) => r.eliminated.includes(o.optionId));
              const won = results.winners?.includes(o.optionId);
              return (
                <tr key={o.optionId} className="border-b border-rule">
                  <td className={cn("py-2 pe-3 font-serif", won ? "font-bold text-ink" : eliminatedAt !== -1 ? "text-umber line-through decoration-1" : "text-ink")}>
                    <bdi>{o.text}</bdi>
                  </td>
                  {rounds.map((r, i) => {
                    const tally = r.tallies.find((x) => x.optionId === o.optionId);
                    return (
                      <td key={r.round} className={cn("px-2 py-2 text-end font-mono tabular-nums", tally ? "text-ink" : "text-muted", eliminatedAt === i && "text-umber")}>
                        {tally ? fmt.number(tally.votes) : "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rounds.some((r) => r.exhaustedBallots > 0) && (
        <p className="mt-2 font-mono text-[11px] text-umber">{t("results.exhausted", { count: rounds.at(-1)!.exhaustedBallots })}</p>
      )}
    </div>
  );
}

export function ResultsBars({
  results,
  myVoteOptionId,
  myChoices,
  compact = false,
}: {
  results: PollResults;
  myVoteOptionId?: string | null;
  /** Every answer of my ballot (multiple choice / ranked). */
  myChoices?: string[];
  compact?: boolean;
}) {
  const { t, fmt } = useI18n();
  const final = results.status === "CLOSED";
  const method = results.method ?? "SINGLE";

  const total = (
    <div className="flex items-end gap-4">
      <span className={cn("font-mono leading-none text-ink tabular-nums", compact ? "text-4xl" : "text-6xl")} aria-live="polite">
        {fmt.number(results.totalVotes)}
      </span>
      <span className="kicker pb-1 text-umber">{final ? t("results.finalCount") : t("results.cast", { count: results.totalVotes })}</span>
    </div>
  );

  if (!results.visible) {
    return (
      <div className="space-y-5">
        {total}
        <div className="border-y border-ink py-4">
          <p className="kicker text-ink">{t("results.embargo")}</p>
          <p className="mt-1 font-serif italic leading-snug text-umber">{t("results.embargoText")}</p>
        </div>
      </div>
    );
  }

  const max = Math.max(...results.options.map((o) => o.votes), 0);
  // Ranked polls are decided by the runoff, not by first preferences.
  const isLeading = (id: string, votes: number) => (method === "RANKED" ? !!results.winners?.includes(id) : max > 0 && votes === max);
  const winnerTexts = (results.winners ?? []).map((id) => results.options.find((o) => o.optionId === id)?.text).filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      {total}

      {method === "RANKED" && winnerTexts.length > 0 && (
        <div className="border-y border-ink py-3">
          <p className="kicker text-accent">{final ? t("results.winner", { count: winnerTexts.length }) : t("results.leadingRunoff")}</p>
          <p className="mt-1 font-serif text-2xl font-bold leading-tight text-ink"><bdi>{winnerTexts.join(" · ")}</bdi></p>
        </div>
      )}

      {/* The stacked strip only makes sense when shares add up to 100 %. */}
      {!compact && results.totalVotes > 0 && method !== "MULTIPLE" && (
        <div>
          <div className="flex h-4 w-full overflow-hidden border border-ink" aria-hidden="true">
            {results.options.map((o, i) =>
              o.percentage > 0 ? (
                <div
                  key={o.optionId}
                  className={cn("h-full border-e border-paper transition-[width] duration-700 ease-out last:border-e-0", segmentStyle[i % segmentStyle.length])}
                  style={{ width: `${o.percentage}%` }}
                  title={`${o.text} : ${fmt.percent(o.percentage)}`}
                />
              ) : null,
            )}
          </div>
          <p className="mt-2 font-mono text-[11px] text-umber">{method === "RANKED" ? t("results.firstPreferences") : t("results.distribution")}</p>
        </div>
      )}
      {method === "MULTIPLE" && results.totalVotes > 0 && <p className="font-mono text-[11px] text-umber">{t("results.shareOfVoters")}</p>}

      <ol className="border-t border-ink">
        {results.options.map((o, i) => {
          const leading = isLeading(o.optionId, o.votes) && results.totalVotes > 0;
          const mine = myChoices?.length ? myChoices.includes(o.optionId) : o.optionId === myVoteOptionId;
          return (
            <li key={o.optionId} className={cn("relative border-b border-rule", compact ? "py-3" : "py-4")}>
              {/* Re-mounted when the count changes → replays the ink wash */}
              <span key={o.votes} className="animate-ink-flash pointer-events-none absolute inset-0" aria-hidden="true" />
              <div className="relative flex items-end gap-3">
                <span className="pb-1 font-mono text-xs text-umber">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0 flex-1">
                  {(leading || mine) && (
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      {leading && (
                        <span className="kicker inline-flex h-5 items-center bg-ink px-1.5 text-[10px] text-paper">
                          {final && method !== "RANKED" ? t("results.winnerTag") : t("results.leading")}
                        </span>
                      )}
                      {mine && (
                        <span className="kicker inline-flex items-center gap-1 text-[10px] text-accent">
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                          {t("results.yourChoice")}
                        </span>
                      )}
                    </div>
                  )}
                  <span className={cn("bidi-auto block font-serif leading-snug text-ink", compact ? "text-base" : "text-lg", leading && "font-bold")}>
                    <bdi>{o.text}</bdi>
                  </span>
                </div>
                <span
                  className={cn("font-mono leading-none tabular-nums", compact ? "text-lg" : "text-3xl", leading ? "text-ink" : "text-umber")}
                  dir="ltr"
                >
                  {fmt.percent(o.percentage)}
                </span>
              </div>
              <div className="relative mt-2.5 flex items-center gap-3 ps-7">
                <div
                  className={cn("flex-1 bg-rule/60", compact ? "h-1.5" : "h-2.5")}
                  role="progressbar"
                  aria-valuenow={o.percentage}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${o.text} : ${fmt.percent(o.percentage)}`}
                >
                  <div className={cn("h-full transition-[width] duration-700 ease-[cubic-bezier(.2,.8,.2,1)]", leading ? "bg-ink" : "bg-copper")} style={{ width: `${o.percentage}%` }} />
                </div>
                <span className="min-w-16 text-end font-mono text-[11px] text-umber">{t("results.ballots", { count: o.votes })}</span>
              </div>
            </li>
          );
        })}
      </ol>
      {method === "RANKED" && !compact && <RunoffTable results={results} />}
      {final && !compact && (
        <p className="flex items-center gap-2 font-serif text-sm italic text-umber">
          <Fleuron size={10} /> {t("results.final")}
        </p>
      )}
    </div>
  );
}
