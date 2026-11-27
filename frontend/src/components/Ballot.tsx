"use client";

import { useI18n } from "@/contexts/PreferencesContext";
import { cn, serial } from "@/lib/format";
import type { Poll } from "@/types";
import { Alert, Button } from "./ui";

/** Square ballot box: an ink cross when chosen, or the rank number on a ranked ballot. */
function BallotBox({ checked, rank }: { checked: boolean; rank?: number }) {
  return (
    <span
      className={cn(
        "relative grid h-8 w-8 shrink-0 place-items-center border-[1.5px] transition-colors duration-150",
        checked ? "border-paper bg-paper text-ink" : "border-ink/70 bg-paper text-ink group-hover:border-ink",
      )}
      aria-hidden="true"
    >
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

const num = (i: number) => String(i + 1).padStart(2, "0");

/**
 * Shown instead of the ballot once the reader has voted: a stamped receipt
 * listing what they chose, rather than a greyed-out form.
 */
function VoteReceipt({ poll, chosen }: { poll: Poll; chosen: string[] }) {
  const { t } = useI18n();
  const ranked = poll.votingMethod === "RANKED";
  const picks = chosen.map((id) => ({ id, index: poll.options.findIndex((o) => o.id === id) })).filter((p) => p.index !== -1);
  return (
    <div className="border border-ink bg-paper">
      <div className="flex items-start gap-5 px-5 py-6 sm:px-7">
        <span
          className="caps animate-stamp grid shrink-0 place-items-center border-[3px] border-double border-accent px-3 py-1.5 font-serif text-lg font-black text-accent sm:text-xl"
          aria-hidden="true"
        >
          {t("ballot.stamp")}
        </span>
        <div className="min-w-0">
          <p className="kicker text-accent">{t("ballot.receiptKicker")}</p>
          <p className="mt-1 font-serif text-2xl font-bold leading-tight text-ink">{t("ballot.cast")}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-umber">{t("ballot.receiptText")}</p>
        </div>
      </div>
      <div className="border-t border-rule px-5 py-4 sm:px-7">
        <p className="kicker text-umber">{ranked ? t("ballot.yourRanking") : t("ballot.yourChoice", { count: picks.length })}</p>
        <ol className="mt-2">
          {picks.map((p, rank) => (
            <li key={p.id} className="flex items-baseline gap-3 border-b border-rule/70 py-2.5 last:border-b-0">
              <span className="font-mono text-xs text-umber" dir="ltr">{ranked ? `#${rank + 1}` : num(p.index)}</span>
              <bdi className="bidi-auto font-serif text-lg leading-snug text-ink">{poll.options[p.index].text}</bdi>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/**
 * The voting interface, presented as a printed ballot paper, for the three methods:
 *  - SINGLE: one box (native radios);
 *  - MULTIPLE: up to `maxChoices` boxes (native checkboxes);
 *  - RANKED: answers are clicked in order of preference; the box shows the rank;
 *    clicking a ranked answer removes it (the following ranks move up).
 * The whole row is the label, so it is one large target; the inputs stay
 * native/focusable, so the ballot works with a keyboard and a screen reader.
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

  if (voted) return <VoteReceipt poll={poll} chosen={chosen} />;

  const toggle = (id: string) => {
    if (method === "SINGLE") return onChange([id]);
    if (chosen.includes(id)) return onChange(chosen.filter((x) => x !== id));
    if (chosen.length < max) onChange([...chosen, id]);
  };

  const instructions =
    method === "MULTIPLE" ? t("ballot.instructionsMultiple", { count: max }) : method === "RANKED" ? t("ballot.instructionsRanked") : t("ballot.instructions");
  const notice = !poll.isOpen ? t("ballot.closed") : notAllowed;

  return (
    <div className="border border-ink bg-paper">
      {/* Head of the paper */}
      <div className="flex items-start justify-between gap-4 border-b border-ink px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="kicker text-ink">{t(`ballot.title${method}`)}</p>
          {open && <p className="mt-1.5 text-[15px] leading-snug text-umber">{instructions}</p>}
        </div>
        <span className="shrink-0 font-mono text-[11px] text-umber">{t("pollDetail.serial", { serial: serial(poll.id) })}</span>
      </div>

      {notice && (
        <p className="flex items-center gap-3 border-b border-rule bg-cream px-5 py-3 text-sm text-ink sm:px-6">
          <svg className="h-4 w-4 shrink-0 text-umber" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          {notice}
        </p>
      )}

      <fieldset disabled={!open}>
        <legend className="sr-only">{poll.question}</legend>
        {poll.options.map((o, i) => {
          const rankIndex = chosen.indexOf(o.id);
          const checked = rankIndex !== -1;
          const full = !checked && method !== "SINGLE" && chosen.length >= max;
          return (
            <label
              key={o.id}
              className={cn(
                "group relative flex min-h-[4.25rem] items-center gap-4 border-b border-rule px-5 py-3.5 transition-colors duration-150 last:border-b-0 sm:px-6",
                "has-[:focus-visible]:z-10 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-copper",
                checked ? "bg-ink text-paper" : "text-ink",
                open && !full && !checked && "cursor-pointer hover:bg-cream",
                open && checked && "cursor-pointer",
                full && "cursor-not-allowed opacity-50",
              )}
            >
              {checked && <span className="absolute inset-y-0 start-0 w-1 bg-copper" aria-hidden="true" />}
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
              <span
                className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center border font-mono text-[13px] transition-colors duration-150",
                  checked ? "border-paper/40 text-paper" : "border-rule text-umber group-hover:border-ink/60 group-hover:text-ink",
                )}
                aria-hidden="true"
              >
                {num(i)}
              </span>
              <span className={cn("bidi-auto flex-1 font-serif text-lg leading-snug", checked && "font-semibold")}>{o.text}</span>
              {open && <BallotBox checked={checked} rank={method === "RANKED" ? (checked ? rankIndex + 1 : 0) : undefined} />}
            </label>
          );
        })}
      </fieldset>

      {open && (
        <div className="space-y-3 border-t border-ink bg-cream/50 px-5 py-5 sm:px-6">
          {method !== "SINGLE" && (
            <div className="flex items-center justify-between gap-3 text-xs text-umber">
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
          {error && <Alert>{error}</Alert>}
          <Button size="lg" className="h-14 w-full text-sm" disabled={selected.length === 0} loading={voting} onClick={onSubmit}>
            {t("ballot.submit")}
            {!voting && (
              <svg className="h-4 w-4 rtl:-scale-x-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinejoin="round" d="M4 12h14M12 5l7 7-7 7" />
              </svg>
            )}
          </Button>
          <p className="text-center text-xs text-umber">{method === "RANKED" ? t("ballot.rankedHint") : t("ballot.oneBallot")}</p>
        </div>
      )}
      {!open && error && <div className="border-t border-rule p-5"><Alert>{error}</Alert></div>}
    </div>
  );
}
