"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useMessaging } from "@/contexts/MessagingContext";
import { useSocket } from "@/contexts/SocketContext";
import { api, ApiError } from "@/lib/api";
import type { Message, PendingMessage } from "@/types";

const PAGE_SIZE = 30;
const ACK_TIMEOUT = 8000;
const TYPING_THROTTLE = 2500;
const TYPING_IDLE = 3500;

/** RFC 4122 v4 id; crypto.randomUUID only exists in secure contexts (https or localhost). */
function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Merges messages by id (duplicated deliveries are harmless) and keeps them ordered by seq. */
function merge(current: Message[], incoming: Message[]) {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

type Ack = { ok: true; data: { message: Message } } | { ok: false; error: { code: string; message: string } };

/**
 * State of one open conversation.
 *  - history comes from REST, page by page (keyset on seq);
 *  - new messages arrive through MessagingContext (Socket.IO);
 *  - sending is optimistic: a pending copy is shown at once, keyed by a
 *    client-generated id; a retry reuses that id, so the server never stores
 *    the same message twice, even if the first attempt actually succeeded;
 *  - after a reconnection, everything newer than the last known seq is fetched.
 */
export function useConversationThread(conversationId: string) {
  const { user } = useAuth();
  const { socket, connected } = useSocket();
  const { subscribe, markLocallyRead, getConversation } = useMessaging();
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "removed">("loading");
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const messagesRef = useRef<Message[]>([]);
  const lastTypingSent = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readSent = useRef(0);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Initial page. The component is keyed by conversation, so state starts fresh for each one.
  useEffect(() => {
    let cancelled = false;
    api
      .messages(conversationId, { limit: PAGE_SIZE })
      .then((d) => {
        if (cancelled) return;
        setMessages(d.messages);
        setHasMore(d.hasMore);
        setStatus("ready");
      })
      .catch((e: ApiError) => {
        if (cancelled) return;
        setLoadError(e);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  /** Fetches everything newer than what we have (after a reconnection). */
  const catchUp = useCallback(async () => {
    let after = messagesRef.current.at(-1)?.seq ?? 0;
    for (let i = 0; i < 20; i++) {
      const d = await api.messages(conversationId, { after, limit: 100 }).catch(() => null);
      if (!d) return;
      setMessages((m) => merge(m, d.messages));
      if (!d.hasMore || d.messages.length === 0) return;
      after = d.messages.at(-1)!.seq;
    }
  }, [conversationId]);

  // Live events for this conversation.
  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === "message" && e.message.conversationId === conversationId) {
          setMessages((m) => merge(m, [e.message]));
          setPending((p) => p.filter((x) => x.clientId !== e.message.clientId));
        } else if (e.type === "removed" && e.conversationId === conversationId) {
          setStatus("removed");
        } else if (e.type === "reconnected") {
          catchUp();
        }
      }),
    [subscribe, conversationId, catchUp],
  );

  /** Moves the read position to the newest message, when the reader can actually see it. */
  const markRead = useCallback(() => {
    const last = messagesRef.current.at(-1);
    if (!last || document.visibilityState !== "visible" || last.seq <= readSent.current) return;
    const conv = getConversation(conversationId);
    if (conv && conv.myLastReadSeq >= last.seq && conv.unreadCount === 0) return;
    readSent.current = last.seq;
    markLocallyRead(conversationId, last.seq);
    if (socket?.connected) socket.emit("conversation:read", { conversationId, seq: last.seq });
    else api.markConversationRead(conversationId, last.seq).catch(() => undefined);
  }, [conversationId, socket, getConversation, markLocallyRead]);

  useEffect(() => {
    if (status === "ready") markRead();
  }, [messages, status, markRead]);

  useEffect(() => {
    const onVisible = () => markRead();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [markRead]);

  const loadOlder = useCallback(async () => {
    const first = messagesRef.current[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const d = await api.messages(conversationId, { before: first.seq, limit: PAGE_SIZE });
      setMessages((m) => merge(m, d.messages));
      setHasMore(d.hasMore);
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, loadingOlder]);

  const stopTyping = useCallback(() => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = null;
    if (lastTypingSent.current) {
      lastTypingSent.current = 0;
      socket?.emit("typing", { conversationId, isTyping: false });
    }
  }, [socket, conversationId]);

  /** Called on every keystroke: throttled "typing" events, auto-stop after a pause. */
  const notifyTyping = useCallback(() => {
    if (!socket?.connected) return;
    const now = Date.now();
    if (now - lastTypingSent.current > TYPING_THROTTLE) {
      lastTypingSent.current = now;
      socket.emit("typing", { conversationId, isTyping: true });
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, TYPING_IDLE);
  }, [socket, conversationId, stopTyping]);

  useEffect(() => stopTyping, [stopTyping]);

  /** One delivery attempt: Socket.IO with an acknowledgement, or REST when offline. */
  const deliver = useCallback(
    async (p: PendingMessage) => {
      try {
        let message: Message;
        if (socket?.connected) {
          const ack = (await socket.timeout(ACK_TIMEOUT).emitWithAck("message:send", { conversationId, body: p.body, clientId: p.clientId })) as Ack;
          if (!ack.ok) throw new ApiError(400, ack.error.code, ack.error.message);
          message = ack.data.message;
        } else {
          message = (await api.sendMessage(conversationId, { body: p.body, clientId: p.clientId })).message;
        }
        setMessages((m) => merge(m, [message]));
        setPending((list) => list.filter((x) => x.clientId !== p.clientId));
      } catch {
        // Timeout, network or server refusal: the copy stays, marked "not sent", with a retry button.
        setPending((list) => list.map((x) => (x.clientId === p.clientId ? { ...x, state: "failed" } : x)));
      }
    },
    [socket, conversationId],
  );

  const send = useCallback(
    (body: string) => {
      const text = body.trim();
      if (!text || !user) return;
      stopTyping();
      const p: PendingMessage = { clientId: uuid(), conversationId, body: text, createdAt: new Date().toISOString(), state: "sending" };
      setPending((list) => [...list, p]);
      deliver(p);
    },
    [user, conversationId, deliver, stopTyping],
  );

  const retry = useCallback(
    (clientId: string) => {
      const p = pending.find((x) => x.clientId === clientId);
      if (!p) return;
      const again = { ...p, state: "sending" as const };
      setPending((list) => list.map((x) => (x.clientId === clientId ? again : x)));
      deliver(again);
    },
    [pending, deliver],
  );

  const discard = useCallback((clientId: string) => setPending((list) => list.filter((x) => x.clientId !== clientId)), []);

  return { messages, pending, status, loadError, hasMore, loadingOlder, loadOlder, send, retry, discard, notifyTyping, connected };
}
