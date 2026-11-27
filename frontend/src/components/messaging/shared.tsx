"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/format";
import type { Conversation, ConversationMember } from "@/types";
import { Fleuron } from "../decor";

/** The other participant of a direct conversation. */
export const otherMember = (c: Conversation, meId: string): ConversationMember | undefined => c.members.find((m) => m.id !== meId);

/** Group name, or the other person's username for a direct conversation. */
export function conversationTitle(c: Conversation, meId: string, deletedLabel: string) {
  if (c.type === "GROUP") return c.name ?? "";
  return otherMember(c, meId)?.username ?? deletedLabel;
}

/**
 * Initials set in the display face, inside a thin ring, like the portrait
 * medallions of a newspaper's columnists. Groups get the khatam ornament.
 */
export function Avatar({ name, group, online, size = "md" }: { name: string; group?: boolean; online?: boolean; size?: "sm" | "md" | "lg" }) {
  const dims = { sm: "h-8 w-8 text-sm", md: "h-11 w-11 text-lg", lg: "h-14 w-14 text-2xl" }[size];
  // First grapheme: works for Latin and Arabic names alike.
  const initial = [...name.trim()][0]?.toUpperCase() ?? "?";
  return (
    <span className={cn("relative grid shrink-0 place-items-center border border-ink bg-paper font-serif font-bold text-ink", group ? "" : "rounded-full", dims)} aria-hidden="true">
      {group ? <Fleuron size={size === "sm" ? 14 : 20} className="text-umber" /> : initial}
      {online !== undefined && (
        <span className={cn("absolute -bottom-0.5 end-0 h-3 w-3 rounded-full border-2 border-cream", online ? "bg-accent" : "bg-muted")} />
      )}
    </span>
  );
}

/** Native <dialog>: focus trap, Escape to close and the top layer come for free. */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      className="m-auto w-[calc(100%-2rem)] max-w-lg border border-ink bg-paper p-0 text-ink backdrop:bg-[color-mix(in_srgb,var(--background)_70%,transparent)] backdrop:backdrop-blur-[1px]"
    >
      <div className="border-b border-rule px-6 py-4">
        <h2 className="font-serif text-2xl font-bold">{title}</h2>
      </div>
      <div className="px-6 py-5">{open && children}</div>
    </dialog>
  );
}
