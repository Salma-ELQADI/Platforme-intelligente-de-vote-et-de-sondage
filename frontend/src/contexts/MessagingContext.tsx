"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import type { Conversation, Message } from "@/types";
import { useAuth } from "./AuthContext";
import { usePreferences } from "./PreferencesContext";
import { useSocket } from "./SocketContext";
import { useToast } from "./ToastContext";

export interface TypingUser {
  id: string;
  username: string;
  until: number;
}

/** Events forwarded to the open conversation (see useConversationThread). */
export type ThreadEvent =
  | { type: "message"; message: Message }
  | { type: "removed"; conversationId: string }
  | { type: "reconnected" };

interface MessagingValue {
  conversations: Conversation[] | null;
  totalUnread: number;
  error: ApiError | null;
  typing: Record<string, TypingUser[]>;
  /** Conversation currently on screen: its messages are marked read and not toasted. */
  setActiveConversation: (id: string | null) => void;
  getConversation: (id: string) => Conversation | undefined;
  /** Re-fetches one conversation (REST is the source of truth) and stores it. */
  refreshConversation: (id: string) => Promise<Conversation | null>;
  upsertConversation: (c: Conversation) => void;
  removeConversation: (id: string) => void;
  /** Local read position update after this user read a conversation. */
  markLocallyRead: (id: string, seq: number) => void;
  subscribe: (fn: (e: ThreadEvent) => void) => () => void;
}

const MessagingContext = createContext<MessagingValue | null>(null);

const TYPING_TTL = 6000; // an indicator disappears if no "typing" event refreshes it

const sortByActivity = (list: Conversation[]) =>
  [...list].sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt));

/**
 * Messaging state shared by the navbar badge, the conversation list and the
 * open thread. Listens once to every messaging event of the user's socket:
 *
 *   message:new, unread:update, conversation:updated, conversation:removed,
 *   conversation:read, typing, presence:update
 *
 * After a reconnection, everything is re-fetched over REST: events emitted
 * while offline are never replayed by Socket.IO, so REST closes the gap.
 */
export function MessagingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { socket } = useSocket();
  const { t, messageNotifications } = usePreferences();
  const toast = useToast();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [totalUnread, setTotalUnread] = useState(0);
  // Whose data is in state: after a logout/login, nothing of the previous account is ever exposed.
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [typing, setTyping] = useState<Record<string, TypingUser[]>>({});
  const activeId = useRef<string | null>(null);
  const listeners = useRef(new Set<(e: ThreadEvent) => void>());
  const conversationsRef = useRef<Conversation[] | null>(null);
  const prefs = useRef({ t, messageNotifications });

  useEffect(() => {
    prefs.current = { t, messageNotifications };
  }, [t, messageNotifications]);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const emit = useCallback((e: ThreadEvent) => listeners.current.forEach((fn) => fn(e)), []);

  const upsertConversation = useCallback((c: Conversation) => {
    setConversations((list) => sortByActivity([c, ...(list ?? []).filter((x) => x.id !== c.id)]));
  }, []);

  const removeConversation = useCallback((id: string) => {
    setConversations((list) => list?.filter((c) => c.id !== id) ?? null);
  }, []);

  const refreshConversation = useCallback(
    async (id: string) => {
      try {
        const { conversation } = await api.conversation(id);
        upsertConversation(conversation);
        return conversation;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) removeConversation(id);
        return null;
      }
    },
    [upsertConversation, removeConversation],
  );

  const loadAll = useCallback((forUserId: string) => {
    Promise.all([api.conversations(), api.unreadMessages()])
      .then(([{ conversations }, { total }]) => {
        // Keep the conversation on screen even if the list omits it (an empty
        // direct conversation opened from a link is only listed for its creator).
        setConversations((prev) => {
          const open = prev?.find((c) => c.id === activeId.current);
          return sortByActivity(open && !conversations.some((c) => c.id === open.id) ? [...conversations, open] : conversations);
        });
        setTotalUnread(total);
        setOwnerId(forUserId);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e : null));
  }, []);

  // Load on login (and again once the socket is up, so presence is fresh).
  useEffect(() => {
    if (user) loadAll(user.id);
  }, [user, socket, loadAll]);

  useEffect(() => {
    if (!socket || !user) return;

    const onMessage = ({ message }: { message: Message }) => {
      const known = conversationsRef.current?.find((c) => c.id === message.conversationId);
      if (known) {
        setConversations((list) =>
          sortByActivity(
            (list ?? []).map((c) =>
              c.id === message.conversationId && (!c.lastMessage || c.lastMessage.seq < message.seq)
                ? { ...c, lastMessage: message, lastMessageAt: message.createdAt }
                : c,
            ),
          ),
        );
      } else {
        // First message of a conversation we did not know about yet.
        refreshConversation(message.conversationId);
      }
      // The author stops "typing" as soon as their message lands.
      setTyping((all) => ({ ...all, [message.conversationId]: (all[message.conversationId] ?? []).filter((u) => u.id !== message.sender?.id) }));
      emit({ type: "message", message });

      const fromOther = message.sender && message.sender.id !== user.id;
      const visible = activeId.current === message.conversationId && document.visibilityState === "visible";
      if (fromOther && !visible && prefs.current.messageNotifications) {
        const { t } = prefs.current;
        const conv = known;
        const preview = message.kind === "POLL" ? t("messages.pollMessage", { question: message.body }) : message.body;
        const title =
          conv?.type === "GROUP"
            ? t("messages.newInGroup", { name: message.sender!.username, group: conv.name ?? "" })
            : t("messages.newFrom", { name: message.sender!.username });
        toast(`${title} — ${preview.length > 90 ? `${preview.slice(0, 90)}…` : preview}`, "info");
      }
    };

    const onUnread = (p: { total: number; conversationId?: string; unreadCount?: number }) => {
      setTotalUnread(p.total);
      if (p.conversationId !== undefined) {
        setConversations((list) => list?.map((c) => (c.id === p.conversationId ? { ...c, unreadCount: p.unreadCount ?? 0 } : c)) ?? null);
      }
    };

    const onUpdated = ({ conversationId }: { conversationId: string }) => refreshConversation(conversationId);

    const onRemoved = ({ conversationId }: { conversationId: string }) => {
      removeConversation(conversationId);
      emit({ type: "removed", conversationId });
    };

    const onRead = (p: { conversationId: string; userId: string; lastReadSeq: number }) => {
      setConversations(
        (list) =>
          list?.map((c) =>
            c.id !== p.conversationId
              ? c
              : {
                  ...c,
                  myLastReadSeq: p.userId === user.id ? Math.max(c.myLastReadSeq, p.lastReadSeq) : c.myLastReadSeq,
                  members: c.members.map((m) => (m.id === p.userId ? { ...m, lastReadSeq: Math.max(m.lastReadSeq, p.lastReadSeq) } : m)),
                },
          ) ?? null,
      );
    };

    const onTyping = (p: { conversationId: string; user: { id: string; username: string }; isTyping: boolean }) => {
      if (p.user.id === user.id) return;
      setTyping((all) => {
        const others = (all[p.conversationId] ?? []).filter((u) => u.id !== p.user.id);
        return { ...all, [p.conversationId]: p.isTyping ? [...others, { ...p.user, until: Date.now() + TYPING_TTL }] : others };
      });
    };

    const onPresence = (p: { userId: string; online: boolean }) => {
      setConversations((list) => list?.map((c) => ({ ...c, members: c.members.map((m) => (m.id === p.userId ? { ...m, online: p.online } : m)) })) ?? null);
    };

    // `connect` fires on every reconnection (the first connection happened before this effect).
    const onReconnect = () => {
      loadAll(user.id);
      emit({ type: "reconnected" });
    };

    socket.on("message:new", onMessage);
    socket.on("unread:update", onUnread);
    socket.on("conversation:updated", onUpdated);
    socket.on("conversation:removed", onRemoved);
    socket.on("conversation:read", onRead);
    socket.on("typing", onTyping);
    socket.on("presence:update", onPresence);
    socket.on("connect", onReconnect);
    return () => {
      socket.off("message:new", onMessage);
      socket.off("unread:update", onUnread);
      socket.off("conversation:updated", onUpdated);
      socket.off("conversation:removed", onRemoved);
      socket.off("conversation:read", onRead);
      socket.off("typing", onTyping);
      socket.off("presence:update", onPresence);
      socket.off("connect", onReconnect);
    };
  }, [socket, user, emit, loadAll, refreshConversation, removeConversation, toast]);

  // Expire typing indicators whose author went quiet (lost "stop" event, closed tab…).
  useEffect(() => {
    const id = setInterval(() => {
      setTyping((all) => {
        const now = Date.now();
        let changed = false;
        const next: Record<string, TypingUser[]> = {};
        for (const [k, users] of Object.entries(all)) {
          next[k] = users.filter((u) => u.until > now);
          if (next[k].length !== users.length) changed = true;
        }
        return changed ? next : all;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const mine = !!user && ownerId === user.id;
  const value = useMemo<MessagingValue>(
    () => ({
      conversations: mine ? conversations : null,
      totalUnread: mine ? totalUnread : 0,
      error,
      typing: mine ? typing : {},
      setActiveConversation: (id) => {
        activeId.current = id;
      },
      getConversation: (id) => conversations?.find((c) => c.id === id),
      refreshConversation,
      upsertConversation,
      removeConversation,
      markLocallyRead: (id, seq) =>
        setConversations((list) => list?.map((c) => (c.id === id ? { ...c, myLastReadSeq: Math.max(c.myLastReadSeq, seq), unreadCount: 0 } : c)) ?? null),
      subscribe: (fn) => {
        listeners.current.add(fn);
        return () => listeners.current.delete(fn);
      },
    }),
    [mine, conversations, totalUnread, error, typing, refreshConversation, upsertConversation, removeConversation],
  );

  return <MessagingContext.Provider value={value}>{children}</MessagingContext.Provider>;
}

const fallback: MessagingValue = {
  conversations: null,
  totalUnread: 0,
  error: null,
  typing: {},
  setActiveConversation: () => undefined,
  getConversation: () => undefined,
  refreshConversation: async () => null,
  upsertConversation: () => undefined,
  removeConversation: () => undefined,
  markLocallyRead: () => undefined,
  subscribe: () => () => undefined,
};

export const useMessaging = () => useContext(MessagingContext) ?? fallback;
