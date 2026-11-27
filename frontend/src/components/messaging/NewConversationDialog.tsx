"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMessaging } from "@/contexts/MessagingContext";
import { useI18n } from "@/contexts/PreferencesContext";
import { api, ApiError } from "@/lib/api";
import type { PollVoter } from "@/types";
import { Alert, Button, Field, Input } from "../ui";
import { PeoplePicker } from "./PeoplePicker";
import { Dialog } from "./shared";

/** "Nouveau message" (one person → direct conversation) or "Nouveau groupe" (name + several people). */
export function NewConversationDialog({ mode, onClose }: { mode: "direct" | "group" | null; onClose: () => void }) {
  const { t, errorText, fieldError } = useI18n();
  const { upsertConversation } = useMessaging();
  const router = useRouter();
  const [name, setName] = useState("");
  const [members, setMembers] = useState<PollVoter[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const close = () => {
    setName("");
    setMembers([]);
    setError(null);
    onClose();
  };

  const open = async (conversationId: string) => {
    close();
    router.push(`/messages/${conversationId}`);
  };

  const startDirect = async (u: PollVoter) => {
    setBusy(true);
    setError(null);
    try {
      const { conversation } = await api.openDirect(u.id);
      upsertConversation(conversation);
      await open(conversation.id);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const createGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (members.length === 0) return setError(new ApiError(400, "CLIENT", t("newConversation.pickOne")));
    setBusy(true);
    setError(null);
    try {
      const { conversation } = await api.createGroup({ name: name.trim(), memberIds: members.map((m) => m.id) });
      upsertConversation(conversation);
      await open(conversation.id);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (u: PollVoter) => setMembers((list) => (list.some((m) => m.id === u.id) ? list.filter((m) => m.id !== u.id) : [...list, u]));

  return (
    <Dialog open={mode !== null} onClose={close} title={mode === "group" ? t("newConversation.groupTitle") : t("newConversation.title")}>
      {mode === "direct" && (
        <div className="space-y-4">
          <PeoplePicker onPick={startDirect} autoFocus />
          {error && <Alert>{errorText(error)}</Alert>}
          {busy && <p className="kicker text-umber">{t("common.loading")}…</p>}
        </div>
      )}
      {mode === "group" && (
        <form onSubmit={createGroup} className="space-y-5">
          <Field label={t("newConversation.groupName")} htmlFor="groupName" error={fieldError(error, "name")}>
            <Input id="groupName" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder={t("newConversation.groupNamePlaceholder")} dir="auto" autoFocus />
          </Field>
          <PeoplePicker onPick={toggle} selectedIds={members.map((m) => m.id)} />
          {members.length > 0 && (
            <div>
              <p className="kicker text-umber">{t("newConversation.selected", { count: members.length })}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center gap-1 border border-ink bg-paper py-1 ps-3 pe-1 font-mono text-xs">
                    <bdi>{m.username}</bdi>
                    <button type="button" onClick={() => toggle(m)} className="grid h-6 w-6 place-items-center text-umber hover:text-ink" aria-label={`${t("common.remove")} ${m.username}`}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && !fieldError(error, "name") && <Alert>{errorText(error)}</Alert>}
          <div className="flex justify-end gap-3 border-t border-rule pt-4">
            <Button type="button" variant="ghost" onClick={close}>{t("common.cancel")}</Button>
            <Button type="submit" loading={busy} disabled={!name.trim()}>{t("newConversation.create")}</Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
