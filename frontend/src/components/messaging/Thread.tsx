"use client";

import Link from "next/link";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useMessaging } from "@/contexts/MessagingContext";
import { useI18n } from "@/contexts/PreferencesContext";
import { useConversationThread } from "@/hooks/useConversationThread";
import { cn } from "@/lib/format";
import type { Conversation, Message } from "@/types";
import { Alert, Button, ButtonLink, Spinner } from "../ui";
import { Composer } from "./Composer";
import { ConversationInfo } from "./ConversationInfo";
import { MessageItem, PendingItem, TypingIndicator } from "./MessageItem";
import { Avatar, conversationTitle, otherMember } from "./shared";

/** Read state of my latest message: per person in a direct conversation, a count in a group. */
function useReceipt(conversation: Conversation, messages: Message[], meId: string) {
  const { t } = useI18n();
  const mine = [...messages].reverse().find((m) => m.sender?.id === meId);
  if (!mine) return { id: null, label: undefined };
  const others = conversation.members.filter((m) => m.id !== meId);
  const readers = others.filter((m) => m.lastReadSeq >= mine.seq).length;
  let label: string;
  if (conversation.type === "DIRECT") label = readers > 0 ? t("messages.read") : t("messages.sent");
  else if (others.length > 0 && readers === others.length) label = t("messages.readByAll");
  else if (readers > 0) label = t("messages.readBy", { count: readers });
  else label = t("messages.sent");
  return { id: mine.id, label };
}

/** A new "run" starts when the author changes, after a day break, or after 5 minutes. */
const breaksRun = (a: Message, b: Message) =>
  a.sender?.id !== b.sender?.id ||
  new Date(a.createdAt).toDateString() !== new Date(b.createdAt).toDateString() ||
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() > 300_000;

function Header({ conversation, meId, onToggleInfo, infoOpen }: { conversation: Conversation; meId: string; onToggleInfo: () => void; infoOpen: boolean }) {
  const { t } = useI18n();
  const title = conversationTitle(conversation, meId, t("messages.deletedUser"));
  const other = conversation.type === "DIRECT" ? otherMember(conversation, meId) : undefined;
  const online = conversation.members.filter((m) => m.online && m.id !== meId).length;

  return (
    <header className="flex items-center gap-3 border-b border-ink bg-paper/40 px-3 py-3.5 sm:gap-4 sm:px-5 sm:py-4">
      <Link href="/messages" className="grid h-10 w-10 shrink-0 place-items-center text-ink hover:text-umber md:hidden" aria-label={t("messages.backToList")}>
        <svg className="h-5 w-5 rtl:-scale-x-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
          <path strokeLinejoin="round" d="M20 12H6m6-7-7 7 7 7" />
        </svg>
      </Link>
      <span className="sm:hidden"><Avatar name={title} group={conversation.type === "GROUP"} online={other?.online} /></span>
      <span className="hidden sm:block"><Avatar name={title} group={conversation.type === "GROUP"} online={other?.online} size="lg" /></span>
      <div className="min-w-0 flex-1">
        <p className="kicker text-umber">{conversation.type === "GROUP" ? t("messages.groupKicker") : t("messages.directKicker")}</p>
        <h2 dir="auto" className="mt-0.5 line-clamp-2 break-words text-start font-serif text-xl font-bold leading-tight text-ink sm:text-2xl">{title}</h2>
        <p className="mt-1 flex min-w-0 items-center gap-2 text-xs text-umber">
          {conversation.type === "DIRECT" ? (
            <>
              <span className={cn("h-2 w-2 shrink-0 rounded-full", other?.online ? "bg-copper" : "bg-muted")} aria-hidden="true" />
              {other?.online ? <span className="font-medium text-accent">{t("messages.online")}</span> : t("messages.offline")}
            </>
          ) : (
            <>
              <span className="shrink-0 font-mono">{t("messages.membersOnline", { count: conversation.members.length, online })}</span>
              <span className="hidden min-w-0 truncate sm:inline">
                <span className="mx-1 text-muted" aria-hidden="true">·</span>
                <bdi>{conversation.members.filter((m) => m.id !== meId).map((m) => m.username).join(", ")}</bdi>
              </span>
            </>
          )}
        </p>
      </div>
      {conversation.type === "GROUP" && (
        // Hidden while the details panel (which has the same action) narrows the thread.
        // (A wrapper owns the visibility: the button's own classes already set a display.)
        <span className={cn("hidden shrink-0", infoOpen ? "2xl:block" : "sm:block")}>
          <ButtonLink href={`/polls/new?group=${conversation.id}`} variant="secondary" size="sm">
            {t("messages.newGroupPoll")}
          </ButtonLink>
        </span>
      )}
      <button
        type="button"
        onClick={onToggleInfo}
        aria-expanded={infoOpen}
        aria-controls="conversation-info"
        aria-label={infoOpen ? t("messages.hideInfo") : t("messages.info")}
        title={infoOpen ? t("messages.hideInfo") : t("messages.info")}
        className={cn("grid h-9 w-9 shrink-0 place-items-center border transition-colors", infoOpen ? "border-ink bg-ink text-paper" : "border-transparent text-ink hover:border-rule")}
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" d="M12 11v5M12 8v.01" />
        </svg>
      </button>
    </header>
  );
}

export function Thread({ conversationId }: { conversationId: string }) {
  const { user } = useAuth();
  const { t, fmt, errorText } = useI18n();
  const { getConversation, refreshConversation, setActiveConversation, typing } = useMessaging();
  const conversation = getConversation(conversationId);
  const [missing, setMissing] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const thread = useConversationThread(conversationId);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const restoreFrom = useRef<number | null>(null);
  // Newest seq present when the thread first loaded: only later messages animate in.
  const [loadedUpTo, setLoadedUpTo] = useState<number | null>(null);
  if (thread.status === "ready" && loadedUpTo === null) setLoadedUpTo(thread.messages.at(-1)?.seq ?? 0);

  useEffect(() => {
    setActiveConversation(conversationId);
    return () => setActiveConversation(null);
  }, [conversationId, setActiveConversation]);

  // Opened from a link before the list was loaded (or a conversation created elsewhere).
  useEffect(() => {
    if (conversation) return;
    refreshConversation(conversationId).then((c) => setMissing(!c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Keep the view pinned to the newest message, unless the reader scrolled up to read history.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (restoreFrom.current !== null) {
      el.scrollTop = el.scrollHeight - restoreFrom.current; // older page prepended: keep the same message in view
      restoreFrom.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [thread.messages, thread.pending, typing]);

  const loadOlder = () => {
    if (scroller.current) restoreFrom.current = scroller.current.scrollHeight - scroller.current.scrollTop;
    thread.loadOlder();
  };

  const receipt = useReceipt(conversation ?? ({ members: [], type: "DIRECT" } as unknown as Conversation), thread.messages, user?.id ?? "");

  if (!user) return null;
  if (thread.status === "removed" || missing || (thread.status === "error" && thread.loadError?.status === 404)) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div className="max-w-sm space-y-4">
          <Alert kind="warning">{thread.status === "removed" ? t("messages.removedFromGroup") : t("messages.notFound")}</Alert>
          <ButtonLink href="/messages" variant="secondary">{t("messages.backToList")}</ButtonLink>
        </div>
      </div>
    );
  }
  if (!conversation) return <div className="grid h-full place-items-center text-umber"><Spinner /></div>;

  const typingNames = (typing[conversationId] ?? []).map((u) => u.username);
  const isGroup = conversation.type === "GROUP";

  return (
    <div className="flex h-full min-h-0">
      <section className="flex min-w-0 flex-1 flex-col" aria-label={conversationTitle(conversation, user.id, t("messages.deletedUser"))}>
        <Header conversation={conversation} meId={user.id} infoOpen={infoOpen} onToggleInfo={() => setInfoOpen((o) => !o)} />

        {!thread.connected && (
          <p className="border-b border-rule bg-paper px-4 py-2 text-xs text-umber" role="status">{t("messages.reconnecting")}</p>
        )}

        <div
          ref={scroller}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6"
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {thread.status === "loading" && <div className="grid place-items-center py-16 text-umber"><Spinner /></div>}
          {thread.status === "error" && <Alert>{errorText(thread.loadError)}</Alert>}

          {thread.status === "ready" && (
            <>
              <div className="mb-4 text-center">
                {thread.hasMore ? (
                  <Button variant="ghost" size="sm" onClick={loadOlder} loading={thread.loadingOlder}>
                    {thread.loadingOlder ? t("messages.loadingOlder") : t("messages.loadOlder")}
                  </Button>
                ) : (
                  thread.messages.length > 0 && <p className="kicker text-muted">{t("messages.beginning")}</p>
                )}
              </div>

              {thread.messages.length === 0 && thread.pending.length === 0 && (
                <div className="py-16 text-center">
                  <p className="font-serif text-2xl italic text-ink">{t("messages.emptyThreadTitle")}</p>
                  <p className="mt-2 text-sm text-umber">{t("messages.emptyThreadText")}</p>
                </div>
              )}

              <ol>
                {thread.messages.map((m, i) => {
                  const prev = thread.messages[i - 1];
                  const next = thread.messages[i + 1];
                  const newDay = !prev || !fmt.sameDay(prev.createdAt, m.createdAt);
                  const newRun = !prev || breaksRun(prev, m);
                  const lastOfRun = !next || breaksRun(m, next);
                  const mine = m.sender?.id === user.id;
                  return (
                    <Fragment key={m.id}>
                      {newDay && (
                        <li className="flex items-center gap-3 py-3" aria-hidden="false">
                          <span className="h-px flex-1 bg-rule" />
                          <span className="kicker text-umber">{fmt.dayLabel(m.createdAt)}</span>
                          <span className="h-px flex-1 bg-rule" />
                        </li>
                      )}
                      <MessageItem
                        message={m}
                        mine={mine}
                        showSender={isGroup && newRun}
                        firstOfRun={newRun}
                        lastOfRun={lastOfRun}
                        fresh={loadedUpTo !== null && m.seq > loadedUpTo}
                        receipt={m.id === receipt.id ? receipt.label : undefined}
                      />
                    </Fragment>
                  );
                })}
                {thread.pending.map((p) => (
                  <PendingItem key={p.clientId} p={p} onRetry={() => thread.retry(p.clientId)} onDiscard={() => thread.discard(p.clientId)} />
                ))}
              </ol>
            </>
          )}
        </div>

        <TypingIndicator names={typingNames} />
        <Composer
          onSend={(body) => { stickToBottom.current = true; thread.send(body); }}
          onTyping={thread.notifyTyping}
          disabled={thread.status !== "ready"}
          sending={thread.pending.some((p) => p.state !== "failed")}
        />
      </section>

      {infoOpen && (
        <aside
          id="conversation-info"
          className={cn(
            "absolute inset-0 z-20 overflow-y-auto bg-paper lg:static lg:inset-auto lg:z-auto lg:w-80 lg:shrink-0 lg:border-s lg:border-ink",
          )}
        >
          <ConversationInfo conversation={conversation} meId={user.id} onClose={() => setInfoOpen(false)} />
        </aside>
      )}
    </div>
  );
}
