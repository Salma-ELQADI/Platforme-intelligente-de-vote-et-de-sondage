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
export function ResultsBars({ results, myVoteOptionId, compact = false }: { results: PollResults; myVoteOptionId?: string | null; compact?: boolean }) {
  const final = results.status === "CLOSED";

  const total = (
    <div className="flex items-end gap-4">
      <span className={cn("font-mono leading-none text-ink tabular-nums", compact ? "text-4xl" : "text-6xl")} aria-live="polite">
        {results.totalVotes}
      </span>
      <span className="kicker pb-1 text-umber">{final ? "Bulletins au dépouillement final" : results.totalVotes > 1 ? "Bulletins déposés" : "Bulletin déposé"}</span>
    </div>
  );

  if (!results.visible) {
    return (
      <div className="space-y-5">
        {total}
        <div className="border-y border-ink py-4">
          <p className="kicker text-ink">Résultats sous embargo</p>
          <p className="mt-1 font-serif italic leading-snug text-umber">Le détail des votes sera publié à la clôture du scrutin, pour ne pas influencer les participants.</p>
        </div>
      </div>
    );
  }

  const max = Math.max(...results.options.map((o) => o.votes), 0);

  return (
    <div className="space-y-6">
      {total}

      {!compact && results.totalVotes > 0 && (
        <div>
          <div className="flex h-4 w-full overflow-hidden border border-ink" aria-hidden="true">
            {results.options.map((o, i) =>
              o.percentage > 0 ? (
                <div
                  key={o.optionId}
                  className={cn("h-full border-r border-paper transition-[width] duration-700 ease-out last:border-r-0", segmentStyle[i % segmentStyle.length])}
                  style={{ width: `${o.percentage}%` }}
                  title={`${o.text} : ${o.percentage} %`}
                />
              ) : null,
            )}
          </div>
          <p className="mt-2 font-mono text-[11px] text-umber">Répartition des suffrages exprimés</p>
        </div>
      )}

      <ol className="border-t border-ink">
        {results.options.map((o, i) => {
          const leading = max > 0 && o.votes === max;
          const mine = o.optionId === myVoteOptionId;
          return (
            <li key={o.optionId} className="relative border-b border-rule py-3">
              {/* Re-mounted when the count changes → replays the ink wash */}
              <span key={o.votes} className="animate-ink-flash pointer-events-none absolute inset-0" aria-hidden="true" />
              <div className="relative flex items-baseline gap-3">
                <span className="font-mono text-xs text-umber">{String(i + 1).padStart(2, "0")}</span>
                <span className={cn("min-w-0 flex-1 font-serif text-ink", compact ? "text-base" : "text-lg", leading && "font-bold")}>
                  {o.text}
                  {mine && <span className="kicker ml-2 align-middle text-umber">Votre choix</span>}
                  {final && leading && <span className="kicker ml-2 align-middle text-ink">En tête</span>}
                </span>
                <span className={cn("font-mono tabular-nums text-ink", compact ? "text-base" : "text-xl")}>{o.percentage.toFixed(1).replace(".", ",")}%</span>
              </div>
              <div className="relative mt-2 flex items-center gap-3 pl-7">
                <div
                  className="h-1.5 flex-1 bg-rule/70"
                  role="progressbar"
                  aria-valuenow={o.percentage}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${o.text} : ${o.percentage} %`}
                >
                  <div className={cn("h-full transition-[width] duration-700 ease-[cubic-bezier(.2,.8,.2,1)]", leading ? "bg-ink" : "bg-umber")} style={{ width: `${o.percentage}%` }} />
                </div>
                <span className="w-16 text-right font-mono text-[11px] text-umber">
                  {o.votes} voix
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      {final && !compact && (
        <p className="flex items-center gap-2 font-serif text-sm italic text-umber">
          <Fleuron size={10} /> Résultats définitifs, arrêtés à la clôture du scrutin.
        </p>
      )}
    </div>
  );
}
