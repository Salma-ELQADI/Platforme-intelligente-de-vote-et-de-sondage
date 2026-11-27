"use client";

import Link from "next/link";
import { useI18n } from "@/contexts/PreferencesContext";
import { cn } from "@/lib/format";
import type { Message, PendingMessage } from "@/types";
import { StatusBadge } from "../ui";

/** A POLL message: the group poll announced in the chat, set as a small boxed notice. */
function PollNotice({ message, mine }: { message: Message; mine: boolean }) {
  const { t, fmt } = useI18n();
  const poll = message.poll;
  return (
    <div className={cn("w-full max-w-md border border-ink bg-paper p-1", mine ? "ms-auto" : "me-auto")}>
      <div className="border border-rule px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="kicker text-accent">{t("pollCard.kicker")}</span>
          {poll && <StatusBadge status={poll.status} isOpen={poll.status === "ACTIVE" ? new Date(poll.endTime) > new Date() : undefined} />}
        </div>
        <p dir="auto" className="mt-2 font-serif text-xl font-bold leading-snug text-ink">{poll?.question ?? message.body}</p>
        {poll ? (
          <>
            <p className="mt-1 font-mono text-[11px] text-umber">
              {t("pollCard.answers", { count: poll.optionCount })} · {t("pollCard.closes", { date: fmt.shortDate(poll.endTime), time: fmt.time(poll.endTime) })}
            </p>
            <Link href={`/polls/${poll.id}`} className="caps mt-3 inline-flex h-8 items-center bg-ink px-3 text-[11px] font-semibold text-paper hover:bg-umber">
              {poll.status === "ACTIVE" && new Date(poll.endTime) > new Date() ? t("pollCard.vote") : t("pollCard.see")}
            </Link>
          </>
        ) : (
          <p className="mt-1 text-sm italic text-umber">{t("pollCard.unavailable")}</p>
        )}
      </div>
    </div>
  );
}

/**
 * One message. Sent messages are set in solid ink at the end of the line,
 * received ones on an elevated sheet at the start: the side follows the
 * reading direction, so in Arabic your messages sit on the left.
 */
export function MessageItem({
  message,
  mine,
  showSender,
  receipt,
}: {
  message: Message;
  mine: boolean;
  /** Group conversations: sender name above the first message of a run. */
  showSender: boolean;
  /** Read state shown under your latest message. */
  receipt?: string;
}) {
  const { t, fmt } = useI18n();
  if (message.kind === "POLL") {
    return (
      <li className="py-2">
        {showSender && <p className="kicker mb-1 text-umber"><bdi>{message.sender?.username ?? t("messages.deletedUser")}</bdi></p>}
        <PollNotice message={message} mine={mine} />
        <p className={cn("mt-1 font-mono text-[10px] text-umber", mine && "text-end")}>{fmt.time(message.createdAt)}</p>
      </li>
    );
  }
  return (
    <li className={cn("flex flex-col", mine ? "items-end" : "items-start", showSender ? "pt-3" : "pt-1")}>
      {showSender && !mine && (
        <span className="kicker mb-1 text-umber">
          <bdi>{message.sender?.username ?? t("messages.deletedUser")}</bdi>
        </span>
      )}
      <div
        className={cn(
          "max-w-[85%] px-3.5 py-2 text-[15px] leading-relaxed sm:max-w-[70%]",
          mine ? "bg-bubble text-on-bubble" : "border border-rule bg-elevated text-ink",
        )}
      >
        <p dir="auto" className="whitespace-pre-wrap break-words text-start">{message.body}</p>
      </div>
      <span className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-umber">
        <time dateTime={message.createdAt}>{fmt.time(message.createdAt)}</time>
        {receipt && <span className={cn(receipt === t("messages.sent") ? "" : "text-accent")}>· {receipt}</span>}
      </span>
    </li>
  );
}

/** Optimistic copy of a message being sent, or that failed to send. */
export function PendingItem({ p, onRetry, onDiscard }: { p: PendingMessage; onRetry: () => void; onDiscard: () => void }) {
  const { t } = useI18n();
  const failed = p.state === "failed";
  return (
    <li className="flex flex-col items-end pt-1">
      <div className={cn("max-w-[85%] px-3.5 py-2 text-[15px] leading-relaxed sm:max-w-[70%]", failed ? "border border-dashed border-ink bg-paper text-ink" : "bg-bubble text-on-bubble opacity-70")}>
        <p dir="auto" className="whitespace-pre-wrap break-words text-start">{p.body}</p>
      </div>
      <span className="mt-0.5 flex items-center gap-2 text-[11px] text-umber" role={failed ? "alert" : "status"}>
        {failed ? (
          <>
            <span className="font-semibold text-ink">{t("messages.failed")}</span>
            <button type="button" onClick={onRetry} className="underline underline-offset-2 hover:text-ink">{t("messages.retry")}</button>
            <button type="button" onClick={onDiscard} className="underline underline-offset-2 hover:text-ink">{t("messages.discard")}</button>
          </>
        ) : (
          <span className="font-mono text-[10px]">{t("messages.sending")}</span>
        )}
      </span>
    </li>
  );
}

export function TypingIndicator({ names }: { names: string[] }) {
  const { t } = useI18n();
  if (names.length === 0) return null;
  const label = names.length === 1 ? t("messages.typing", { name: names[0] }) : names.length === 2 ? t("messages.typingTwo", { a: names[0], b: names[1] }) : t("messages.typingMany");
  return (
    <div className="flex items-center gap-2 px-4 pb-2 text-sm italic text-umber" aria-live="polite">
      <span className="flex gap-0.5" aria-hidden="true">
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-umber" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-umber" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-umber" />
      </span>
      {label}
    </div>
  );
}
