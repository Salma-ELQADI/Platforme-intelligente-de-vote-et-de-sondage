"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/contexts/PreferencesContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/format";
import type { PollVoter } from "@/types";
import { Field, Input, Spinner } from "../ui";
import { Avatar } from "./shared";

/**
 * Searches registered users by username (GET /users/directory, debounced).
 * `exclude` hides people already in the conversation.
 */
export function PeoplePicker({ onPick, selectedIds = [], exclude = [], autoFocus }: { onPick: (u: PollVoter) => void; selectedIds?: string[]; exclude?: string[]; autoFocus?: boolean }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PollVoter[] | null>(null);
  const [loading, setLoading] = useState(false);

  const q = query.trim();
  useEffect(() => {
    if (!q) return;
    const id = setTimeout(() => {
      setLoading(true);
      api
        .directory(q)
        .then(({ users }) => setResults(users))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(id);
  }, [q]);

  // Results of a previous search are hidden as soon as the field is emptied.
  const visible = q ? results?.filter((u) => !exclude.includes(u.id)) : undefined;

  return (
    <div>
      <Field label={t("newConversation.searchPeople")} htmlFor="people">
        <div className="relative">
          <Input
            id="people"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("newConversation.searchPlaceholder")}
            autoComplete="off"
            autoFocus={autoFocus}
            dir="auto"
          />
          {loading && <Spinner className="absolute end-3 top-1/2 -translate-y-1/2 text-umber" />}
        </div>
      </Field>
      <ul className="mt-3 max-h-60 overflow-y-auto border-t border-rule" aria-live="polite">
        {!q && <li className="py-3 text-sm italic text-umber">{t("newConversation.typeToSearch")}</li>}
        {visible?.length === 0 && <li className="py-3 text-sm italic text-umber">{t("newConversation.noPeople")}</li>}
        {visible?.map((u) => {
          const selected = selectedIds.includes(u.id);
          return (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => onPick(u)}
                aria-pressed={selected}
                className={cn("flex w-full items-center gap-3 border-b border-rule px-1 py-2.5 text-start transition-colors hover:bg-cream/60", selected && "bg-cream/80")}
              >
                <Avatar name={u.username} size="sm" />
                <bdi className="flex-1 font-serif text-lg text-ink">{u.username}</bdi>
                {selected && <span className="kicker text-accent">✓</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
