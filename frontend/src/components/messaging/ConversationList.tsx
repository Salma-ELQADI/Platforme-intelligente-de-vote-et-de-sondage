"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useMessaging } from "@/contexts/MessagingContext";
import { useI18n } from "@/contexts/PreferencesContext";
import { cn } from "@/lib/format";
import type { Conversation } from "@/types";
import { Alert, Button, Input, Skeleton } from "../ui";
import { PendingInvitations } from "./InvitationCard";
import { NewConversationDialog } from "./NewConversationDialog";
import { Avatar, conversationTitle, otherMember } from "./shared";

/** One line of the list: avatar, name, last message preview, time, unread count. */
function Row({ c, active, meId }: { c: Conversation; active: boolean; meId: string }) {
  const { t, fmt } = useI18n();
  const { typing } = useMessaging();
  const title = conversationTitle(c, meId, t("messages.deletedUser"));
  const other = c.type === "DIRECT" ? otherMember(c, meId) : undefined;
  const who = typing[c.id] ?? [];
  const last = c.lastMessage;
  const preview = !last
    ? t("messages.emptyThreadTitle")
    : last.kind === "POLL"
      ? t("messages.pollMessage", { question: last.body })
      : last.sender?.id === meId
        ? t("messages.you", { text: last.body })
        : c.type === "GROUP" && last.sender
          ? t("messages.groupPreview", { name: last.sender.username, text: last.body })
          : last.body;
  const unread = c.unreadCount > 0;

  return (
    <li>
      <Link
        href={`/messages/${c.id}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex items-center gap-3 border-b border-rule px-4 py-3.5 transition-colors",
          active ? "bg-paper" : "hover:bg-paper/60",
        )}
      >
        {active && <span className="absolute inset-y-0 start-0 w-[3px] bg-copper" aria-hidden="true" />}
        <Avatar name={title} group={c.type === "GROUP"} online={other?.online} active={active} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span dir="auto" className={cn("min-w-0 truncate font-serif text-[17px] leading-tight text-ink", unread || active ? "font-bold" : "font-semibold")}>{title}</span>
            {c.lastMessageAt && <span className={cn("shrink-0 font-mono text-[11px] tabular-nums", unread ? "font-medium text-accent" : "text-umber")}>{fmt.listTime(c.lastMessageAt)}</span>}
          </div>
          <div className="mt-1 flex items-center justify-between gap-3">
            {who.length > 0 ? (
              <span className="min-w-0 truncate text-sm italic text-accent">{t("messages.typing", { name: who[0].username })}</span>
            ) : (
              <span className={cn("min-w-0 truncate text-[13.5px]", unread ? "font-medium text-ink" : "text-umber")}>{preview}</span>
            )}
            {unread && (
              <span
                key={c.unreadCount}
                className="animate-count-pop inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-accent px-1.5 font-mono text-[10px] leading-none text-on-accent"
                aria-label={t("messages.unread", { count: c.unreadCount })}
              >
                {c.unreadCount > 99 ? "99+" : c.unreadCount}
              </span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

/**
 * Left panel: search, "new" actions and the list. The search filters the
 * already loaded list locally (group name or participants' usernames), so it
 * reacts on every keystroke.
 */
export function ConversationList({ activeId }: { activeId?: string }) {
  const { user } = useAuth();
  const { conversations, error } = useMessaging();
  const { t, errorText } = useI18n();
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<"direct" | "group" | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    if (!q || !conversations) return conversations;
    return conversations.filter(
      (c) => c.name?.toLocaleLowerCase().includes(q) || c.members.some((m) => m.id !== user?.id && m.username.toLocaleLowerCase().includes(q)),
    );
  }, [conversations, search, user]);

  if (!user) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-ink px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-serif text-2xl font-black leading-none text-ink">{t("messages.title")}</h1>
          <div className="flex gap-1.5">
            <Button size="sm" onClick={() => setDialog("direct")} title={t("messages.newMessage")} className="px-2.5">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
              {t("messages.newShort")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setDialog("group")} title={t("messages.newGroup")} className="px-2.5">
              {t("messages.groupShort")}
            </Button>
          </div>
        </div>
        <div role="search" className="relative mt-3">
          <svg className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-umber" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path strokeLinecap="round" d="m16 16 4 4" />
          </svg>
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("messages.searchPlaceholder")}
            aria-label={t("messages.searchPlaceholder")}
            dir="auto"
            className="h-10 ps-9 text-sm"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <PendingInvitations />
        {error && !conversations && <div className="p-4"><Alert>{errorText(error)}</Alert></div>}
        {!conversations && !error && (
          <ul role="status" aria-label={t("common.loading")}>
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex items-center gap-3 border-b border-rule px-4 py-3.5">
                <Skeleton className="h-11 w-11 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </li>
            ))}
          </ul>
        )}
        {conversations?.length === 0 && (
          <div className="px-6 py-12 text-center">
            <p className="font-serif text-xl italic text-ink">{t("messages.emptyListTitle")}</p>
            <p className="mt-2 text-sm text-umber">{t("messages.emptyListText")}</p>
          </div>
        )}
        {conversations && conversations.length > 0 && filtered?.length === 0 && (
          <p className="px-6 py-10 text-center font-serif italic text-umber">{t("messages.noMatch")}</p>
        )}
        <ul aria-label={t("messages.conversations")}>
          {filtered?.map((c) => <Row key={c.id} c={c} active={c.id === activeId} meId={user.id} />)}
        </ul>
      </div>

      <NewConversationDialog mode={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}
