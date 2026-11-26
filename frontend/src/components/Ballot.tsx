"use client";

import { cn, serial } from "@/lib/format";
import type { Poll } from "@/types";
import { Alert, Button } from "./ui";

/** Square ballot box; marked with an ink cross when chosen. */
function BallotBox({ checked }: { checked: boolean }) {
  return (
    <span className={cn("relative grid h-6 w-6 shrink-0 place-items-center border-[1.5px] transition-colors", checked ? "border-ink bg-paper" : "border-ink/70 bg-paper group-hover:border-ink")} aria-hidden="true">
      <svg viewBox="0 0 24 24" className={cn("h-5 w-5 transition-transform duration-150", checked ? "scale-100" : "scale-0")}>
        <path d="M5 5 L19 19 M19 5 L5 19" stroke="#38291f" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/**
 * The voting interface, presented as a printed ballot paper.
 * Native radio inputs (visually hidden) keep it keyboard- and screen-reader-accessible.
 */
export function Ballot({
  poll,
  selected,
  onSelect,
  onSubmit,
  voting,
  error,
  isOwner,
}: {
  poll: Poll;
  isOwner: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  onSubmit: () => void;
  voting: boolean;
  error: string | null;
}) {
  const voted = poll.myVoteOptionId;
  const open = poll.isOpen && !voted && poll.canVote;
  // Why this user may not vote at all (the backend enforces the same rules).
  const notAllowed = !voted && !poll.canVote
    ? isOwner
      ? "Vous êtes l’auteur de ce scrutin : vous ne pouvez pas y voter."
      : "Ce scrutin est privé : vous ne figurez pas sur la liste des votants."
    : null;
  const chosen = voted ?? selected;

  return (
    <div className="relative border border-ink bg-paper p-1.5">
      <div className="border border-rule px-5 py-6 sm:px-8 sm:py-8">
        <div className="text-center">
          <p className="kicker text-ink">Bulletin de vote</p>
          <p className="mt-1 font-mono text-[11px] text-umber">Scrutin n° {serial(poll.id)}</p>
          <p className="mt-4 font-serif text-[15px] italic text-umber">
            {open
              ? "Cochez une seule case, puis déposez votre bulletin."
              : voted
                ? "Votre bulletin a été déposé dans l’urne."
                : !poll.isOpen
                  ? "Ce scrutin est clos."
                  : notAllowed}
          </p>
        </div>

        <fieldset className="mt-6 border-t border-ink" disabled={!open}>
          <legend className="sr-only">{poll.question}</legend>
          {poll.options.map((o, i) => {
            const checked = chosen === o.id;
            return (
              <label
                key={o.id}
                className={cn(
                  "group flex items-center gap-4 border-b border-rule px-2 py-4 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink",
                  open ? "cursor-pointer hover:bg-cream/50" : "cursor-default",
                  !open && !checked && "opacity-55",
                )}
              >
                <input type="radio" name="ballot" value={o.id} checked={checked} onChange={() => onSelect(o.id)} className="sr-only" />
                <span className="w-6 font-mono text-xs text-umber">{String(i + 1).padStart(2, "0")}</span>
                <span className="flex-1 font-serif text-lg leading-snug text-ink">{o.text}</span>
                <BallotBox checked={checked} />
              </label>
            );
          })}
        </fieldset>

        {open && (
          <div className="mt-6 space-y-3">
            {error && <Alert>{error}</Alert>}
            <Button size="lg" className="w-full" disabled={!selected} loading={voting} onClick={onSubmit}>
              Déposer mon bulletin
            </Button>
            <p className="text-center text-xs text-umber">Un seul bulletin par participant. Il ne pourra pas être modifié.</p>
          </div>
        )}
        {!open && !voted && error && <div className="mt-6"><Alert>{error}</Alert></div>}
      </div>

      {/* The iconic stamp of French-language ballots once a vote is cast */}
      {voted && (
        <div className="animate-stamp pointer-events-none absolute right-6 top-6 border-[3px] border-double border-ink px-3 py-1 font-serif text-xl font-black uppercase tracking-wider text-ink opacity-80 sm:right-10 sm:top-10 sm:text-2xl" aria-hidden="true">
          A voté
        </div>
      )}
    </div>
  );
}
