"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, ButtonLink, EmptyState, PageHeader, PageLoader, StatusBadge } from "@/components/ui";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/contexts/PreferencesContext";
import type { VoteHistoryItem } from "@/types";

export default function MyVotesPage() {
  const { ready } = useRequireAuth();
  const { t, fmt, errorText } = useI18n();
  const [votes, setVotes] = useState<VoteHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready) api.myVotes().then(({ votes }) => setVotes(votes)).catch((e: ApiError) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (!ready) return <PageLoader />;

  return (
    <>
      <PageHeader kicker={t("myVotes.kicker")} title={t("myVotes.title")} subtitle={t("myVotes.subtitle")} />
      {error && <Alert>{error}</Alert>}
      {!votes && !error && <PageLoader />}
      {votes?.length === 0 && <EmptyState title={t("myVotes.emptyTitle")} description={t("myVotes.emptyText")} action={<ButtonLink href="/polls">{t("myVotes.seeOpen")}</ButtonLink>} />}
      {votes && votes.length > 0 && (
        <div className="max-w-4xl">
          <div className="hidden grid-cols-12 gap-4 border-b border-ink pb-2 md:grid">
            <span className="kicker col-span-2 text-umber">{t("myVotes.date")}</span>
            <span className="kicker col-span-6 text-umber">{t("myVotes.question")}</span>
            <span className="kicker col-span-4 text-umber">{t("myVotes.yourAnswer")}</span>
          </div>
          <ol>
            {votes.map((v) => (
              <li key={v.id} className="group relative grid gap-2 border-b border-rule py-4 md:grid-cols-12 md:gap-4">
                <span className="font-mono text-xs text-umber md:col-span-2 md:pt-1">
                  {fmt.shortDate(v.votedAt)}
                  <br className="hidden md:block" /> <span className="md:hidden">·</span> {fmt.time(v.votedAt)}
                </span>
                <div className="md:col-span-6">
                  <Link href={`/polls/${v.poll.id}`} className="bidi-auto font-serif text-lg font-semibold leading-snug text-ink after:absolute after:inset-0 group-hover:underline">
                    {v.poll.question}
                  </Link>
                  <div className="mt-2">
                    <StatusBadge status={v.poll.status} isOpen={v.poll.status === "ACTIVE" ? new Date(v.poll.endTime) > new Date() : false} />
                  </div>
                </div>
                {v.choices.length > 1 ? (
                  // Ranked ballots keep their order; multiple choice lists the selection.
                  <ol className="font-serif text-[17px] italic text-ink md:col-span-4">
                    {v.choices.map((c) => (
                      <li key={c.id} className="flex gap-2">
                        {v.poll.votingMethod === "RANKED" && <span className="font-mono text-xs not-italic leading-7 text-umber">{c.rank}.</span>}
                        <bdi>{c.text}</bdi>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <span className="font-serif text-lg italic text-ink md:col-span-4">{t("myVotes.quoted", { text: v.option.text })}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}
