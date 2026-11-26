import Link from "next/link";
import type { ReactNode } from "react";
import { cn, formatShortDate, formatTime } from "@/lib/format";
import type { Poll } from "@/types";
import { Badge, StatusBadge } from "./ui";

const isClosed = (p: Poll) => p.status === "CLOSED" || (p.status === "ACTIVE" && !p.isOpen);

/** Category line: real attributes of the poll (status, how it was written, results mode). */
function Kicker({ poll }: { poll: Poll }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <StatusBadge status={poll.status} isOpen={poll.isOpen} />
      <Badge>{poll.creationMode === "AI" ? "Rédaction assistée par IA" : "Rédaction manuelle"}</Badge>
      {poll.access === "PRIVATE" && <Badge>Privé</Badge>}
      {poll.myVoteOptionId && <Badge className="text-ink">✓ Vous avez voté</Badge>}
    </div>
  );
}

/** Monospaced metadata line: participation and dates. */
export function PollMeta({ poll, className }: { poll: Poll; className?: string }) {
  const closed = isClosed(poll);
  const date = closed && poll.closedAt ? poll.closedAt : poll.endTime;
  return (
    <p className={cn("font-mono text-xs text-umber", className)}>
      <span className="text-ink">{poll.totalVotes}</span> vote{poll.totalVotes > 1 ? "s" : ""}
      <span className="mx-2 text-muted">/</span>
      {poll.options.length} réponses
      <span className="mx-2 text-muted">/</span>
      {closed ? "clos le" : "clôture le"} {formatShortDate(date)} à {formatTime(date)}
    </p>
  );
}

/** Standard editorial entry: kicker, headline, byline, metadata. Used in lists and grids. */
export function PollEntry({ poll, actions, size = "md" }: { poll: Poll; actions?: ReactNode; size?: "md" | "lg" }) {
  return (
    <article className="group relative flex h-full flex-col border-t border-ink pt-4">
      <Kicker poll={poll} />
      <h3 className={cn("mt-3 font-serif font-bold leading-tight text-ink", size === "lg" ? "text-3xl" : "text-[1.4rem]")}>
        <Link href={`/polls/${poll.id}`} className="decoration-1 underline-offset-4 after:absolute after:inset-0 group-hover:underline">
          {poll.question}
        </Link>
      </h3>
      {poll.description && <p className="mt-2 line-clamp-2 font-serif text-[15px] italic leading-snug text-umber">{poll.description}</p>}
      <p className="mt-2 text-sm text-umber">
        Par <span className="font-medium text-ink">{poll.creator.username}</span>
      </p>
      <PollMeta poll={poll} className="mt-auto pt-4" />
      {actions && <div className="relative z-10 mt-4 flex flex-wrap gap-2 border-t border-rule pt-3">{actions}</div>}
    </article>
  );
}

/** Ranked brief for a sidebar ("Les plus suivis"): the rank is a real ordering. */
export function PollBrief({ poll, rank }: { poll: Poll; rank: number }) {
  return (
    <li className="group relative flex gap-4 border-b border-rule py-4 last:border-b-0">
      <span className="font-serif text-3xl font-black leading-none text-muted">{rank}</span>
      <div className="min-w-0">
        <Link href={`/polls/${poll.id}`} className="font-serif text-[17px] font-semibold leading-snug text-ink after:absolute after:inset-0 group-hover:underline">
          {poll.question}
        </Link>
        <p className="mt-1 font-mono text-xs text-umber">
          <span className="text-ink">{poll.totalVotes}</span> vote{poll.totalVotes > 1 ? "s" : ""}
        </p>
      </div>
    </li>
  );
}

/** Backwards-compatible name used by list pages. */
export const PollCard = PollEntry;
