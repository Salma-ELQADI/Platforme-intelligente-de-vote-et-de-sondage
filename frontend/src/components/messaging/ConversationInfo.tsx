"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMessaging } from "@/contexts/MessagingContext";
import { useI18n } from "@/contexts/PreferencesContext";
import { useToast } from "@/contexts/ToastContext";
import { api, ApiError } from "@/lib/api";
import type { Conversation, Poll, PollVoter } from "@/types";
import { Button, ButtonLink, Field, Input, SectionTitle, StatusBadge } from "../ui";
import { PeoplePicker } from "./PeoplePicker";
import { Avatar, conversationTitle, Dialog } from "./shared";

/** The group's polls ("Où allons-nous ce week-end ?"), newest first. */
function GroupPolls({ conversation }: { conversation: Conversation }) {
  const { t, fmt } = useI18n();
  const [polls, setPolls] = useState<Poll[] | null>(null);

  useEffect(() => {
    api.groupPolls(conversation.id).then((d) => setPolls(d.polls)).catch(() => setPolls([]));
    // Refreshed when a new poll message arrives (lastMessage changes).
  }, [conversation.id, conversation.lastMessage?.id]);

  return (
    <section className="px-5 py-5">
      <SectionTitle>{t("groups.polls")}</SectionTitle>
      {polls?.length === 0 && <p className="text-sm italic text-umber">{t("groups.noPolls")}</p>}
      <ul className="space-y-3">
        {polls?.map((p) => (
          <li key={p.id} className="border-t border-rule pt-3">
            <StatusBadge status={p.status} isOpen={p.isOpen} />
            <Link href={`/polls/${p.id}`} dir="auto" className="mt-1.5 block font-serif text-[17px] font-semibold leading-snug text-ink hover:underline">
              {p.question}
            </Link>
            <p className="mt-1 font-mono text-[11px] text-umber">
              {t("poll.votes", { count: p.totalVotes })} · {t("poll.closesOn", { date: fmt.shortDate(p.endTime), time: fmt.time(p.endTime) })}
            </p>
          </li>
        ))}
      </ul>
      <ButtonLink href={`/polls/new?group=${conversation.id}`} size="sm" className="mt-4 w-full">
        {t("messages.newGroupPoll")}
      </ButtonLink>
    </section>
  );
}

export function ConversationInfo({ conversation, meId, onClose }: { conversation: Conversation; meId: string; onClose: () => void }) {
  const { t, fmt, errorText } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const { upsertConversation, removeConversation } = useMessaging();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(conversation.name ?? "");
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState<PollVoter[]>([]);
  const [busy, setBusy] = useState(false);
  const isGroup = conversation.type === "GROUP";
  const isAdmin = isGroup && conversation.myRole === "ADMIN";
  const title = conversationTitle(conversation, meId, t("messages.deletedUser"));

  /** Runs a management call; the server re-checks every permission. */
  const run = async (fn: () => Promise<{ conversation: Conversation } | unknown>, success: string) => {
    setBusy(true);
    try {
      const res = await fn();
      if (res && typeof res === "object" && "conversation" in res) upsertConversation((res as { conversation: Conversation }).conversation);
      toast(success, "success");
      return true;
    } catch (e) {
      toast(errorText(e as ApiError), "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (!confirm(t("groups.confirmLeave"))) return;
    if (await run(() => api.removeMember(conversation.id, meId), t("groups.left"))) {
      removeConversation(conversation.id);
      router.push("/messages");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between border-b border-rule px-5 py-3 lg:hidden">
        <span className="kicker text-umber">{t("messages.info")}</span>
        <Button variant="ghost" size="sm" onClick={onClose}>{t("common.close")}</Button>
      </div>

      <div className="px-5 py-6 text-center">
        <div className="flex justify-center"><Avatar name={title} group={isGroup} size="lg" /></div>
        <h3 className="mt-3 font-serif text-2xl font-bold text-ink"><bdi>{title}</bdi></h3>
        <p className="mt-1 text-xs text-umber">
          {isGroup ? t("groups.membersCount", { count: conversation.members.length }) : t("groups.directWith", { name: title })}
        </p>
        <p className="mt-1 font-mono text-[11px] text-umber">{fmt.shortDate(conversation.createdAt)}</p>
        {isAdmin && (
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => { setName(conversation.name ?? ""); setRenaming(true); }}>
            {t("groups.rename")}
          </Button>
        )}
      </div>

      {isGroup && (
        <section className="border-t border-ink px-5 py-5">
          <SectionTitle aside={isAdmin ? <button type="button" className="kicker text-umber hover:text-ink" onClick={() => setAdding(true)}>+ {t("groups.addMembers")}</button> : undefined}>
            {t("groups.members")}
          </SectionTitle>
          <ul>
            {conversation.members.map((m) => {
              const me = m.id === meId;
              return (
                <li key={m.id} className="flex items-center gap-3 border-b border-rule py-2.5 last:border-b-0">
                  <Avatar name={m.username} size="sm" online={m.online} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      <bdi>{m.username}</bdi> {me && <span className="text-umber">({t("common.you")})</span>}
                    </p>
                    <p className="kicker text-[10px] text-umber">{m.role === "ADMIN" ? t("groups.admin") : t("groups.member")}</p>
                  </div>
                  {isAdmin && !me && (
                    <details className="relative">
                      <summary className="grid h-8 w-8 cursor-pointer list-none place-items-center text-umber hover:text-ink" aria-label={m.username}>⋯</summary>
                      <div className="absolute end-0 z-10 mt-1 w-52 border border-ink bg-elevated py-1 text-sm shadow-[3px_3px_0_var(--foreground)]">
                        <button
                          type="button"
                          disabled={busy}
                          className="block w-full px-3 py-2 text-start hover:bg-paper"
                          onClick={() => run(() => api.setMemberRole(conversation.id, m.id, m.role === "ADMIN" ? "MEMBER" : "ADMIN"), t("groups.roleUpdated"))}
                        >
                          {m.role === "ADMIN" ? t("groups.revokeAdmin") : t("groups.makeAdmin")}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className="block w-full px-3 py-2 text-start text-umber hover:bg-paper hover:text-ink"
                          onClick={() =>
                            confirm(t("groups.confirmRemove", { name: m.username })) &&
                            run(() => api.removeMember(conversation.id, m.id), t("groups.removed", { name: m.username })).then(
                              (ok) => ok && upsertConversation({ ...conversation, members: conversation.members.filter((x) => x.id !== m.id) }),
                            )
                          }
                        >
                          {t("groups.removeMember")}
                        </button>
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
          {!isAdmin && <p className="mt-3 text-xs italic text-umber">{t("groups.adminsOnly")}</p>}
        </section>
      )}

      {isGroup && <div className="border-t border-ink"><GroupPolls conversation={conversation} /></div>}

      {isGroup && (
        <div className="border-t border-ink px-5 py-5">
          <Button variant="danger" size="sm" className="w-full" onClick={leave} loading={busy}>{t("groups.leave")}</Button>
        </div>
      )}

      <Dialog open={renaming} onClose={() => setRenaming(false)} title={t("groups.rename")}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api.renameGroup(conversation.id, name.trim()), t("groups.renamed"))) setRenaming(false);
          }}
        >
          <Field label={t("groups.name")} htmlFor="rename">
            <Input id="rename" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required dir="auto" autoFocus />
          </Field>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>{t("common.cancel")}</Button>
            <Button type="submit" loading={busy} disabled={!name.trim()}>{t("common.save")}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={adding} onClose={() => { setAdding(false); setToAdd([]); }} title={t("groups.addMembers")}>
        <div className="space-y-4">
          <PeoplePicker
            autoFocus
            exclude={conversation.members.map((m) => m.id)}
            selectedIds={toAdd.map((u) => u.id)}
            onPick={(u) => setToAdd((l) => (l.some((x) => x.id === u.id) ? l.filter((x) => x.id !== u.id) : [...l, u]))}
          />
          {toAdd.length > 0 && <p className="kicker text-umber">{t("newConversation.selected", { count: toAdd.length })}</p>}
          <div className="flex justify-end gap-3 border-t border-rule pt-4">
            <Button type="button" variant="ghost" onClick={() => { setAdding(false); setToAdd([]); }}>{t("common.cancel")}</Button>
            <Button
              type="button"
              loading={busy}
              disabled={toAdd.length === 0}
              onClick={async () => {
                if (await run(() => api.addMembers(conversation.id, toAdd.map((u) => u.id)), t("groups.added"))) {
                  setAdding(false);
                  setToAdd([]);
                }
              }}
            >
              {t("newConversation.add")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
