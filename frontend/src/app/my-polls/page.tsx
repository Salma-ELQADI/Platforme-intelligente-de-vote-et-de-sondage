"use client";

import { useCallback, useEffect, useState } from "react";
import { PollEntry } from "@/components/PollCard";
import { Alert, Button, ButtonLink, EmptyState, PageHeader, PageLoader, Tabs } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { api, ApiError } from "@/lib/api";
import type { Poll, PollStatus } from "@/types";

const tabs: { value: PollStatus | undefined; label: string }[] = [
  { value: undefined, label: "Tous" },
  { value: "DRAFT", label: "Brouillons" },
  { value: "ACTIVE", label: "Scrutins ouverts" },
  { value: "CLOSED", label: "Archives" },
];

export default function MyPollsPage() {
  const { ready } = useRequireAuth();
  const toast = useToast();
  const [status, setStatus] = useState<PollStatus | undefined>(undefined);
  const [polls, setPolls] = useState<Poll[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.myPolls(status).then(({ polls }) => setPolls(polls)).catch((e: ApiError) => setError(e.message));
  }, [status]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg, "success");
      load();
    } catch (e) {
      toast((e as ApiError).message, "error");
    }
  };

  if (!ready) return <PageLoader />;

  const counts = polls ? { drafts: polls.filter((p) => p.status === "DRAFT").length, votes: polls.reduce((s, p) => s + p.totalVotes, 0) } : null;

  return (
    <>
      <PageHeader
        kicker="Vos signatures"
        title="Mes sondages"
        subtitle="Vos brouillons, vos scrutins en cours et vos archives."
        action={<ButtonLink href="/polls/new">Rédiger un sondage</ButtonLink>}
      />
      <div className="mb-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <Tabs label="Filtrer mes sondages" value={status} onChange={(v) => (setStatus(v), setPolls(null))} items={tabs} />
        {counts && status === undefined && (
          <p className="font-mono text-xs text-umber">
            <span className="text-ink">{polls!.length}</span> sondages <span className="mx-2 text-muted">/</span>
            <span className="text-ink">{counts.drafts}</span> brouillons <span className="mx-2 text-muted">/</span>
            <span className="text-ink">{counts.votes}</span> votes reçus
          </p>
        )}
      </div>

      {error && <Alert>{error}</Alert>}
      {!polls && !error && <PageLoader />}
      {polls?.length === 0 && (
        <EmptyState title="Rien sous presse." description="Rédigez votre premier sondage : il apparaîtra ici, du brouillon jusqu’aux résultats." action={<ButtonLink href="/polls/new">Rédiger un sondage</ButtonLink>} />
      )}
      {polls && polls.length > 0 && (
        <div className="grid gap-x-10 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
          {polls.map((p) => (
            <PollEntry
              key={p.id}
              poll={p}
              actions={
                <>
                  {p.status === "DRAFT" && (
                    <>
                      <ButtonLink href={`/polls/${p.id}/edit`} variant="secondary" size="sm">Modifier</ButtonLink>
                      <Button size="sm" onClick={() => act(() => api.publishPoll(p.id), "Sondage publié.")}>Publier</Button>
                      <Button variant="danger" size="sm" onClick={() => confirm("Supprimer ce brouillon ?") && act(() => api.deletePoll(p.id), "Brouillon supprimé.")}>
                        Supprimer
                      </Button>
                    </>
                  )}
                  {p.status === "ACTIVE" && (
                    <Button variant="secondary" size="sm" onClick={() => confirm("Clore ce scrutin maintenant ?") && act(() => api.closePoll(p.id), "Scrutin clos.")}>
                      Clore le scrutin
                    </Button>
                  )}
                  <ButtonLink href={`/polls/${p.id}`} variant="ghost" size="sm">Lire</ButtonLink>
                </>
              }
            />
          ))}
        </div>
      )}
    </>
  );
}
