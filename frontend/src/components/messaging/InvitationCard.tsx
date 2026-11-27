"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMessaging } from "@/contexts/MessagingContext";
import { useI18n } from "@/contexts/PreferencesContext";
import { useToast } from "@/contexts/ToastContext";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/format";
import { Button } from "../ui";

/**
 * An invitation to join a group, with Accept / Decline. Used at the top of
 * the conversation list and on the notifications page.
 */
export function InvitationActions({
  invitationId,
  groupName,
  invitedBy,
  compact = false,
  onAnswered,
}: {
  invitationId: string;
  groupName: string;
  invitedBy: string | null;
  compact?: boolean;
  onAnswered?: (status: "ACCEPTED" | "DECLINED") => void;
}) {
  const { t, rich, errorText } = useI18n();
  const { acceptInvitation, declineInvitation } = useMessaging();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);

  const answer = async (accept: boolean) => {
    setBusy(accept ? "accept" : "decline");
    try {
      if (accept) {
        const conversation = await acceptInvitation(invitationId);
        toast(t("invitations.accepted", { group: groupName }), "success");
        onAnswered?.("ACCEPTED");
        router.push(`/messages/${conversation.id}`);
      } else {
        await declineInvitation(invitationId);
        toast(t("invitations.declined", { group: groupName }), "info");
        onAnswered?.("DECLINED");
      }
    } catch (e) {
      toast(errorText(e as ApiError), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={cn(compact ? "space-y-2" : "space-y-3")}>
      <p className={cn("text-ink", compact ? "text-sm" : "font-serif text-lg leading-snug")}>
        {rich(invitedBy ? "invitations.text" : "invitations.textAnonymous", {
          name: <bdi className="font-semibold">{invitedBy}</bdi>,
          group: <bdi className="font-semibold">{groupName}</bdi>,
        })}
      </p>
      <div className="flex gap-2">
        <Button size="sm" loading={busy === "accept"} disabled={busy !== null} onClick={() => answer(true)}>
          {t("invitations.accept")}
        </Button>
        <Button size="sm" variant="secondary" loading={busy === "decline"} disabled={busy !== null} onClick={() => answer(false)}>
          {t("invitations.decline")}
        </Button>
      </div>
    </div>
  );
}

/** "Invitations" block at the top of the conversation list. */
export function PendingInvitations() {
  const { invitations } = useMessaging();
  const { t } = useI18n();
  if (invitations.length === 0) return null;
  return (
    <section className="border-b border-ink bg-paper px-4 py-4" aria-label={t("invitations.title")}>
      <p className="kicker text-accent">{t("invitations.pending", { count: invitations.length })}</p>
      <ul className="mt-3 space-y-4">
        {invitations.map((inv) => (
          <li key={inv.id} className="border-t border-rule pt-3 first:border-t-0 first:pt-0">
            <InvitationActions invitationId={inv.id} groupName={inv.group.name} invitedBy={inv.invitedBy?.username ?? null} compact />
          </li>
        ))}
      </ul>
    </section>
  );
}
