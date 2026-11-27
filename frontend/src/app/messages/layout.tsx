"use client";

import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { ConversationList } from "@/components/messaging/ConversationList";
import { PageLoader } from "@/components/ui";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { cn } from "@/lib/format";

/**
 * Two panels on desktop (list | conversation). On mobile only one is shown:
 * the list on /messages, the conversation on /messages/<id> (with a back link).
 * The layout persists between conversations, so the list keeps its scroll and search.
 */
export default function MessagesLayout({ children }: { children: ReactNode }) {
  const { ready } = useRequireAuth();
  const { id } = useParams<{ id?: string }>();
  if (!ready) return <PageLoader />;

  return (
    <div className="-my-6 grid h-[calc(100dvh-9.5rem)] min-h-[28rem] grid-cols-1 border border-ink bg-cream md:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
      <div className={cn("min-h-0 min-w-0 md:border-e md:border-ink", id ? "hidden md:block" : "block")}>
        <ConversationList activeId={id} />
      </div>
      <div className={cn("relative min-h-0 min-w-0 bg-cream", id ? "block" : "hidden md:block")}>{children}</div>
    </div>
  );
}
