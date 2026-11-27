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
/**
 * Bubble corners: a modest 8px radius, tightened to 3px on the sender's side
 * where bubbles of the same run touch. Logical corners, so it mirrors in Arabic.
 */
function bubbleShape(mine: boolean, first: boolean, last: boolean) {
  return mine
    ? cn("rounded-lg", !first && "rounded-se-[3px]", !last && "rounded-ee-[3px]")
    : cn("rounded-lg", !first && "rounded-ss-[3px]", !last && "rounded-es-[3px]");
}

const bubbleBase = "max-w-[85%] px-3.5 py-2 text-[15px] leading-relaxed sm:max-w-[68%]";

/** Read receipt: one tick when sent, two copper ticks once read. */
function Receipt({ label, read }: { label: string; read: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1", read && "text-accent")}>
      <svg className="h-3 w-4" viewBox="0 0 20 12" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
        <path d="m1 6.5 3.5 3.5L11 3" />
        {read && <path d="m8 9.5.5.5L15 3" />}
      </svg>
      {label}
    </span>
  );
}

export function MessageItem({
  message,
  mine,
  showSender,
  firstOfRun = true,
  lastOfRun = true,
  fresh,
  receipt,
}: {
  message: Message;
  mine: boolean;
  /** Group conversations: sender name above the first message of a run. */
  showSender: boolean;
  firstOfRun?: boolean;
  /** The time is printed once, under the last message of a run (on hover for the others). */
  lastOfRun?: boolean;
  /** Arrived live, after the thread was opened: slides in. */
  fresh?: boolean;
  /** Read state shown under your latest message. */
  receipt?: string;
}) {
  const { t, fmt } = useI18n();
  const time = fmt.time(message.createdAt);
  if (message.kind === "POLL") {
    return (
      <li className={cn("py-2", fresh && "animate-message-in")}>
        {showSender && !mine && <p className="mb-1 ms-1 text-xs font-semibold text-accent"><bdi>{message.sender?.username ?? t("messages.deletedUser")}</bdi></p>}
        <PollNotice message={message} mine={mine} />
        <p className={cn("mt-1 font-mono text-[10px] text-umber", mine && "text-end")}>{time}</p>
      </li>
    );
  }
  const showReceipt = !!receipt;
  return (
    <li className={cn("group flex flex-col", mine ? "items-end" : "items-start", firstOfRun ? "pt-3" : "pt-[3px]", fresh && "animate-message-in")}>
      {showSender && !mine && (
        <span className="mb-1 ms-1 text-xs font-semibold text-accent">
          <bdi>{message.sender?.username ?? t("messages.deletedUser")}</bdi>
        </span>
      )}
      <div className={cn("flex w-full items-end gap-2", mine && "flex-row-reverse")}>
        <div
          title={time}
          className={cn(bubbleBase, bubbleShape(mine, firstOfRun, lastOfRun), mine ? "bg-bubble text-on-bubble" : "border border-rule bg-elevated text-ink")}
        >
          <p dir="auto" className="whitespace-pre-wrap break-words text-start">{message.body}</p>
        </div>
        {!lastOfRun && (
          <time dateTime={message.createdAt} className="pb-1 font-mono text-[10px] text-umber opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true">
            {time}
          </time>
        )}
      </div>
      {(lastOfRun || showReceipt) && (
        <span className="mt-1 flex items-center gap-2 px-1 font-mono text-[10px] text-umber">
          <time dateTime={message.createdAt}>{time}</time>
          {showReceipt && <Receipt label={receipt} read={receipt !== t("messages.sent")} />}
        </span>
      )}
    </li>
  );
}

/** Optimistic copy of a message being sent, or that failed to send. */
export function PendingItem({ p, onRetry, onDiscard }: { p: PendingMessage; onRetry: () => void; onDiscard: () => void }) {
  const { t } = useI18n();
  const failed = p.state === "failed";
  return (
    <li className="animate-message-in flex flex-col items-end pt-[3px]">
      <div className={cn(bubbleBase, "rounded-lg", failed ? "border border-dashed border-ink bg-paper text-ink" : "bg-bubble text-on-bubble opacity-75")}>
        <p dir="auto" className="whitespace-pre-wrap break-words text-start">{p.body}</p>
      </div>
      <span className="mt-1 flex items-center gap-3 px-1 text-[11px] text-umber" role={failed ? "alert" : "status"}>
        {failed ? (
          <>
            <span className="inline-flex items-center gap-1 font-semibold text-ink">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" /></svg>
              {t("messages.failed")}
            </span>
            <button type="button" onClick={onRetry} className="font-semibold text-ink underline underline-offset-2 hover:text-umber">{t("messages.retry")}</button>
            <button type="button" onClick={onDiscard} className="underline underline-offset-2 hover:text-ink">{t("messages.discard")}</button>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px]">
            <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" aria-hidden="true" />
            {t("messages.sending")}
          </span>
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
