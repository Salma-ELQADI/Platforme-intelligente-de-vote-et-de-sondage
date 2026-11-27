"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Button, EmptyState, PageHeader, PageLoader } from "@/components/ui";
import { useSocket } from "@/contexts/SocketContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/contexts/PreferencesContext";
import { cn } from "@/lib/format";
import type { Notification } from "@/types";

export default function NotificationsPage() {
  const { ready } = useRequireAuth();
  const { t, fmt, errorText } = useI18n();
  const { socket, setUnreadCount } = useSocket();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    api
      .notifications()
      .then((d) => {
        setItems(d.notifications);
        setUnreadCount(d.unreadCount);
      })
      .catch((e: ApiError) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, setUnreadCount]);

  // New notices are inserted at the top in real time.
  useEffect(() => {
    if (!socket) return;
    const onNew = (n: Notification) => setItems((list) => (list ? [n, ...list] : list));
    socket.on("notification:new", onNew);
    return () => {
      socket.off("notification:new", onNew);
    };
  }, [socket]);

  const markRead = async (n: Notification) => {
    if (n.isRead) return;
    await api.markNotificationRead(n.id).catch(() => undefined);
    setItems((list) => list?.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)) ?? null);
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  const markAll = async () => {
    await api.markAllNotificationsRead();
    setItems((list) => list?.map((x) => ({ ...x, isRead: true })) ?? null);
    setUnreadCount(0);
  };

  if (!ready) return <PageLoader />;

  return (
    <>
      <PageHeader
        kicker={t("notifications.kicker")}
        title={t("notifications.title")}
        subtitle={t("notifications.subtitle")}
        action={items?.some((n) => !n.isRead) ? <Button variant="secondary" onClick={markAll}>{t("notifications.markAll")}</Button> : undefined}
      />
      {error && <Alert>{error}</Alert>}
      {!items && !error && <PageLoader />}
      {items?.length === 0 && <EmptyState title={t("notifications.emptyTitle")} description={t("notifications.emptyText")} />}
      {items && items.length > 0 && (
        <ol className="max-w-3xl border-t border-ink">
          {items.map((n) => (
            <li key={n.id} className="border-b border-rule">
              <Link href={n.pollId ? `/polls/${n.pollId}` : "#"} onClick={() => markRead(n)} className="group flex gap-5 py-5">
                <span className="w-24 shrink-0 font-mono text-xs leading-6 text-umber">
                  {fmt.shortDate(n.createdAt)}
                  <br />
                  {fmt.time(n.createdAt)}
                </span>
                <div className="flex-1">
                  {!n.isRead && <span className="kicker mb-1 block text-accent">{t("notifications.new")}</span>}
                  <p className={cn("font-serif text-lg leading-snug group-hover:underline", n.isRead ? "text-umber" : "font-semibold text-ink")}>
                    {/* Worded in the reader's language; the stored French text is the fallback. */}
                    {n.pollQuestion ? t(`notifications.${n.type}`, { question: n.pollQuestion }) : n.message}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
