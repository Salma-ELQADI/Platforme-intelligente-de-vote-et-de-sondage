"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useI18n } from "@/contexts/PreferencesContext";
import { cn } from "@/lib/format";
import type { Poll } from "@/types";
import { Badge, StatusBadge } from "./ui";

const isClosed = (p: Poll) => p.status === "CLOSED" || (p.status === "ACTIVE" && !p.isOpen);

/** Category line: real attributes of the poll (status, how it was written, who can vote). */
function Kicker({ poll }: { poll: Poll }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <StatusBadge status={poll.status} isOpen={poll.isOpen} />
      <Badge>{poll.creationMode === "AI" ? t("poll.aiWritten") : t("poll.manualWritten")}</Badge>
      {poll.votingMethod !== "SINGLE" && <Badge className="text-ink">{t(`poll.method${poll.votingMethod}`)}</Badge>}
      {poll.access === "PRIVATE" && <Badge>{t("poll.private")}</Badge>}
      {poll.group && <Badge className="text-accent">{t("poll.groupBadge", { name: poll.group.name })}</Badge>}
      {poll.myVoteOptionId && <Badge className="text-ink">{t("poll.voted")}</Badge>}
    </div>
  );
}

/** Monospaced metadata line: participation and dates. */
export function PollMeta({ poll, className }: { poll: Poll; className?: string }) {
  const { t, fmt } = useI18n();
  const closed = isClosed(poll);
  const date = closed && poll.closedAt ? poll.closedAt : poll.endTime;
  const when = { date: fmt.shortDate(date), time: fmt.time(date) };
  return (
    <p className={cn("font-mono text-xs text-umber", className)}>
      <span className="text-ink">{t("poll.votes", { count: poll.totalVotes })}</span>
      <span className="mx-2 text-muted">/</span>
      {t("poll.answers", { count: poll.options.length })}
      <span className="mx-2 text-muted">/</span>
      {poll.status === "SCHEDULED" && poll.startsAt
        ? t("poll.opensOn", { date: fmt.shortDate(poll.startsAt), time: fmt.time(poll.startsAt) })
        : closed
          ? t("poll.closedOn", when)
          : t("poll.closesOn", when)}
    </p>
  );
}

/** Standard editorial entry: kicker, headline, byline, metadata. Used in lists and grids. */
export function PollEntry({ poll, actions, size = "md" }: { poll: Poll; actions?: ReactNode; size?: "md" | "lg" }) {
  const { rich } = useI18n();
  return (
    <article className="group relative flex h-full flex-col border-t border-ink pt-4">
      <Kicker poll={poll} />
      <h3 className={cn("bidi-auto mt-3 font-serif font-bold leading-tight text-ink", size === "lg" ? "text-3xl" : "text-[1.4rem]")}>
        <Link href={`/polls/${poll.id}`} className="decoration-1 underline-offset-4 after:absolute after:inset-0 group-hover:underline">
          {poll.question}
        </Link>
      </h3>
      {poll.description && <p className="bidi-auto mt-2 line-clamp-2 font-serif text-[15px] italic leading-snug text-umber">{poll.description}</p>}
      <p className="mt-2 text-sm text-umber">
        {rich("common.by", { author: <bdi className="font-medium text-ink">{poll.creator.username}</bdi> })}
      </p>
      <PollMeta poll={poll} className="mt-auto pt-4" />
      {actions && <div className="relative z-10 mt-4 flex flex-wrap gap-2 border-t border-rule pt-3">{actions}</div>}
    </article>
  );
}

/** Ranked brief for a sidebar ("Les plus suivis"): the rank is a real ordering. */
export function PollBrief({ poll, rank }: { poll: Poll; rank: number }) {
  const { t, fmt } = useI18n();
  return (
    <li className="group relative flex gap-4 border-b border-rule py-4 last:border-b-0">
      <span className="font-serif text-3xl font-black leading-none text-muted">{fmt.number(rank)}</span>
      <div className="min-w-0">
        <Link href={`/polls/${poll.id}`} className="bidi-auto font-serif text-[17px] font-semibold leading-snug text-ink after:absolute after:inset-0 group-hover:underline">
          {poll.question}
        </Link>
        <p className="mt-1 font-mono text-xs text-ink">{t("poll.votes", { count: poll.totalVotes })}</p>
      </div>
    </li>
  );
}

/** Backwards-compatible name used by list pages. */
export const PollCard = PollEntry;
