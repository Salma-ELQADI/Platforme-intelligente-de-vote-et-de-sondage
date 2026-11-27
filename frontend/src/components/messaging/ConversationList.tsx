"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useMessaging } from "@/contexts/MessagingContext";
import { useI18n } from "@/contexts/PreferencesContext";
import { cn } from "@/lib/format";
import type { Conversation } from "@/types";
import { Alert, Button, Input, Spinner } from "../ui";
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
          "flex items-center gap-3 border-b border-rule px-4 py-3.5 transition-colors",
          active ? "bg-paper shadow-[inset_3px_0_0_var(--foreground)] rtl:shadow-[inset_-3px_0_0_var(--foreground)]" : "hover:bg-paper/60",
        )}
      >
        <Avatar name={title} group={c.type === "GROUP"} online={other?.online} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span dir="auto" className={cn("min-w-0 truncate font-serif text-[17px] leading-tight text-ink", unread ? "font-bold" : "font-semibold")}>{title}</span>
            {c.lastMessageAt && <span className={cn("shrink-0 font-mono text-[11px]", unread ? "text-accent" : "text-umber")}>{fmt.listTime(c.lastMessageAt)}</span>}
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-3">
            {who.length > 0 ? (
              <span className="min-w-0 truncate text-sm italic text-accent">{t("messages.typing", { name: who[0].username })}</span>
            ) : (
              <span className={cn("min-w-0 truncate text-sm", unread ? "text-ink" : "text-umber")}>{preview}</span>
            )}
            {unread && (
              <span className="shrink-0 bg-accent px-1.5 py-0.5 font-mono text-[10px] leading-none text-on-accent" aria-label={t("messages.unread", { count: c.unreadCount })}>
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
      <div className="border-b border-ink px-4 pb-4 pt-5">
        <div className="flex items-center justify-between gap-2">
          <h1 className="font-serif text-3xl font-black text-ink">{t("messages.title")}</h1>
        </div>
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => setDialog("direct")} className="flex-1">{t("messages.newMessage")}</Button>
          <Button size="sm" variant="secondary" onClick={() => setDialog("group")} className="flex-1">{t("messages.newGroup")}</Button>
        </div>
        <div role="search" className="mt-3">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("messages.searchPlaceholder")}
            aria-label={t("messages.searchPlaceholder")}
            dir="auto"
            className="h-9 text-sm"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <PendingInvitations />
        {error && !conversations && <div className="p-4"><Alert>{errorText(error)}</Alert></div>}
        {!conversations && !error && (
          <div className="grid place-items-center py-16 text-umber"><Spinner /></div>
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
