"use client";

import { useI18n } from "@/contexts/PreferencesContext";
import { cn, serial } from "@/lib/format";
import type { Poll } from "@/types";
import { Alert, Button } from "./ui";

/** Square ballot box: an ink cross when chosen, or the rank number on a ranked ballot. */
function BallotBox({ checked, rank }: { checked: boolean; rank?: number }) {
  return (
    <span className={cn("relative grid h-7 w-7 shrink-0 place-items-center border-[1.5px] bg-paper text-ink transition-colors", checked ? "border-ink" : "border-ink/70 group-hover:border-ink")} aria-hidden="true">
      {rank !== undefined ? (
        <span className={cn("font-mono text-sm font-medium transition-transform duration-150", checked ? "scale-100" : "scale-0")}>{rank || ""}</span>
      ) : (
        <svg viewBox="0 0 24 24" className={cn("h-5 w-5 transition-transform duration-150", checked ? "scale-100" : "scale-0")}>
          <path d="M5 5 L19 19 M19 5 L5 19" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}

/**
 * The voting interface, presented as a printed ballot paper, for the three methods:
 *  - SINGLE: one box (native radios);
 *  - MULTIPLE: up to `maxChoices` boxes (native checkboxes);
 *  - RANKED: answers are clicked in order of preference; the box shows the rank;
 *    clicking a ranked answer removes it (the following ranks move up).
 * The inputs stay native/focusable, so the ballot works with a keyboard and a screen reader.
 */
export function Ballot({
  poll,
  selected,
  onChange,
  onSubmit,
  voting,
  error,
  isOwner,
}: {
  poll: Poll;
  isOwner: boolean;
  selected: string[];
  onChange: (ids: string[]) => void;
  onSubmit: () => void;
  voting: boolean;
  error: string | null;
}) {
  const { t, fmt } = useI18n();
  const voted = poll.myChoices.length > 0 || !!poll.myVoteOptionId;
  const open = poll.isOpen && !voted && poll.canVote;
  const method = poll.votingMethod;
  const max = method === "SINGLE" ? 1 : method === "MULTIPLE" ? (poll.maxChoices ?? 1) : poll.options.length;
  // Why this user may not vote at all (the backend enforces the same rules).
  const notAllowed = !voted && !poll.canVote
    ? poll.access === "GROUP"
      ? t("ballot.notMember")
      : isOwner
        ? t("ballot.owner")
        : t("ballot.notInvited")
    : null;
  const chosen = voted ? (poll.myChoices.length ? poll.myChoices : [poll.myVoteOptionId!]) : selected;

  const toggle = (id: string) => {
    if (method === "SINGLE") return onChange([id]);
    if (chosen.includes(id)) return onChange(chosen.filter((x) => x !== id));
    if (chosen.length < max) onChange([...chosen, id]);
  };

  const instructions =
    method === "MULTIPLE" ? t("ballot.instructionsMultiple", { count: max }) : method === "RANKED" ? t("ballot.instructionsRanked") : t("ballot.instructions");

  return (
    <div className="relative border border-ink bg-paper p-1.5">
      <div className="border border-rule px-5 py-6 sm:px-8 sm:py-8">
        <div className="text-center">
          <p className="kicker text-ink">{t(`ballot.title${method}`)}</p>
          <p className="mt-1 font-mono text-[11px] text-umber">{t("pollDetail.serial", { serial: serial(poll.id) })}</p>
          <p className="mt-4 font-serif text-[15px] italic text-umber">
            {open ? instructions : voted ? t("ballot.cast") : !poll.isOpen ? t("ballot.closed") : notAllowed}
          </p>
        </div>

        <fieldset className="mt-6 border-t border-ink" disabled={!open}>
          <legend className="sr-only">{poll.question}</legend>
          {poll.options.map((o, i) => {
            const rankIndex = chosen.indexOf(o.id);
            const checked = rankIndex !== -1;
            const full = !checked && method !== "SINGLE" && chosen.length >= max;
            return (
              <label
                key={o.id}
                className={cn(
                  "group flex items-center gap-4 border-b border-rule px-2 py-4 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink",
                  open && !full ? "cursor-pointer hover:bg-cream/50" : "cursor-default",
                  ((!open && !checked) || full) && "opacity-55",
                )}
              >
                <input
                  type={method === "SINGLE" ? "radio" : "checkbox"}
                  name="ballot"
                  value={o.id}
                  checked={checked}
                  disabled={full}
                  onChange={() => toggle(o.id)}
                  className="sr-only"
                  aria-label={method === "RANKED" && checked ? `${o.text} — ${t("ballot.rank", { n: rankIndex + 1 })}` : undefined}
                />
                <span className="w-6 font-mono text-xs text-umber">{String(i + 1).padStart(2, "0")}</span>
                <span className="bidi-auto flex-1 font-serif text-lg leading-snug text-ink">{o.text}</span>
                <BallotBox checked={checked} rank={method === "RANKED" ? (checked ? rankIndex + 1 : 0) : undefined} />
              </label>
            );
          })}
        </fieldset>

        {open && method !== "SINGLE" && (
          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-umber">
            <span className="font-mono" aria-live="polite">
              {method === "MULTIPLE" ? t("ballot.selectedOf", { n: fmt.number(chosen.length), max: fmt.number(max) }) : t("ballot.ranked", { count: chosen.length })}
            </span>
            {chosen.length > 0 && (
              <button type="button" onClick={() => onChange([])} className="underline underline-offset-2 hover:text-ink">
                {t("ballot.reset")}
              </button>
            )}
          </div>
        )}

        {open && (
          <div className="mt-6 space-y-3">
            {error && <Alert>{error}</Alert>}
            <Button size="lg" className="w-full" disabled={selected.length === 0} loading={voting} onClick={onSubmit}>
              {t("ballot.submit")}
            </Button>
            <p className="text-center text-xs text-umber">{method === "RANKED" ? t("ballot.rankedHint") : t("ballot.oneBallot")}</p>
          </div>
        )}
        {!open && !voted && error && <div className="mt-6"><Alert>{error}</Alert></div>}
      </div>

      {/* The iconic stamp of French-language ballots once a vote is cast */}
      {voted && (
        <div className="caps animate-stamp pointer-events-none absolute end-6 top-6 border-[3px] border-double border-ink px-3 py-1 font-serif text-xl font-black text-ink opacity-80 sm:end-10 sm:top-10 sm:text-2xl" aria-hidden="true">
          {t("ballot.stamp")}
        </div>
      )}
    </div>
  );
}
