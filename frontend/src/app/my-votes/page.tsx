"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, ButtonLink, EmptyState, PageHeader, PageLoader, StatusBadge } from "@/components/ui";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { api, ApiError } from "@/lib/api";
import { formatShortDate, formatTime } from "@/lib/format";
import type { VoteHistoryItem } from "@/types";

export default function MyVotesPage() {
  const { ready } = useRequireAuth();
  const [votes, setVotes] = useState<VoteHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready) api.myVotes().then(({ votes }) => setVotes(votes)).catch((e: ApiError) => setError(e.message));
  }, [ready]);

  if (!ready) return <PageLoader />;

  return (
    <>
      <PageHeader kicker="Vos bulletins" title="Mes votes" subtitle="Le registre de chaque bulletin que vous avez déposé." />
      {error && <Alert>{error}</Alert>}
      {!votes && !error && <PageLoader />}
      {votes?.length === 0 && <EmptyState title="Aucun bulletin déposé." description="Les scrutins ouverts attendent votre voix." action={<ButtonLink href="/polls">Voir les scrutins ouverts</ButtonLink>} />}
      {votes && votes.length > 0 && (
        <div className="max-w-4xl">
          <div className="hidden grid-cols-12 gap-4 border-b border-ink pb-2 md:grid">
            <span className="kicker col-span-2 text-umber">Date</span>
            <span className="kicker col-span-6 text-umber">Question</span>
            <span className="kicker col-span-4 text-umber">Votre réponse</span>
          </div>
          <ol>
            {votes.map((v) => (
              <li key={v.id} className="group relative grid gap-2 border-b border-rule py-4 md:grid-cols-12 md:gap-4">
                <span className="font-mono text-xs text-umber md:col-span-2 md:pt-1">
                  {formatShortDate(v.votedAt)}
                  <br className="hidden md:block" /> <span className="md:hidden">à</span> {formatTime(v.votedAt)}
                </span>
                <div className="md:col-span-6">
                  <Link href={`/polls/${v.poll.id}`} className="font-serif text-lg font-semibold leading-snug text-ink after:absolute after:inset-0 group-hover:underline">
                    {v.poll.question}
                  </Link>
                  <div className="mt-2">
                    <StatusBadge status={v.poll.status} isOpen={v.poll.status === "ACTIVE" ? new Date(v.poll.endTime) > new Date() : false} />
                  </div>
                </div>
                <span className="font-serif text-lg italic text-ink md:col-span-4">« {v.option.text} »</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}
