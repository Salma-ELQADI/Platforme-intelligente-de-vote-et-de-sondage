"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Ballot } from "@/components/Ballot";
import { Countdown } from "@/components/Countdown";
import { DoubleRule } from "@/components/decor";
import { ResultsBars } from "@/components/ResultsBars";
import { Alert, Badge, Button, ButtonLink, LiveIndicator, PageLoader, SectionTitle, StatusBadge } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { usePollRoom } from "@/hooks/usePollRoom";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { api, ApiError } from "@/lib/api";
import { formatShortDate, formatTime, serial } from "@/lib/format";
import type { Poll } from "@/types";

export function PollDetail({ id }: { id: string }) {
  const { ready } = useRequireAuth();
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [poll, setPoll] = useState<Poll | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Real-time subscription to the room "poll:<id>".
  const onClosed = useCallback(
    (payload: { closedAt: string }) => {
      setPoll((p) => (p ? { ...p, status: "CLOSED", isOpen: false, closedAt: payload.closedAt } : p));
      toast("Le scrutin vient d’être clos. Les résultats définitifs sont affichés.", "info");
    },
    [toast],
  );
  const { results, setResults, connected, roomError } = usePollRoom(id, onClosed);

  useEffect(() => {
    if (!ready) return;
    api
      .getPoll(id)
      .then(({ poll }) => setPoll(poll))
      .catch((e: ApiError) => setLoadError(e));
    // Initial results over HTTP (in case the socket is not connected yet).
    api.results(id).then(({ results }) => setResults(results)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, id]);

  if (!ready || (!poll && !loadError)) return <PageLoader />;
  if (loadError || !poll) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <Alert>{loadError?.status === 404 ? "Ce sondage n’existe pas ou n’est pas accessible." : loadError?.message}</Alert>
        <ButtonLink href="/polls" variant="secondary">Retour aux sondages</ButtonLink>
      </div>
    );
  }

  const isOwner = user?.id === poll.creator.id;
  const isAdmin = user?.role === "admin";
  // Edition row only when at least one action is actually available.
  const canEdit = (poll.status === "DRAFT" && isOwner) || (poll.status === "ACTIVE" && (isOwner || isAdmin)) || isAdmin;

  const submitVote = async () => {
    if (!selected) return;
    setVoting(true);
    setVoteError(null);
    try {
      const data = await api.vote(poll.id, selected);
      setPoll({ ...poll, myVoteOptionId: selected, totalVotes: data.results.totalVotes });
      setResults(data.results);
      toast("Bulletin déposé. Votre vote est enregistré.", "success");
    } catch (e) {
      const err = e as ApiError;
      setVoteError(err.message);
      if (err.code === "ALREADY_VOTED" || err.code === "POLL_CLOSED") {
        api.getPoll(poll.id).then(({ poll }) => setPoll(poll)).catch(() => undefined);
      }
    } finally {
      setVoting(false);
    }
  };

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast(success, "success");
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article>
      <nav className="kicker flex items-center gap-2 text-umber" aria-label="Fil d’Ariane">
        <Link href="/polls" className="hover:text-ink">Sondages</Link>
        <span aria-hidden="true">/</span>
        <span className="font-mono normal-case tracking-normal">Scrutin n° {serial(poll.id)}</span>
      </nav>

      {/* Article header */}
      <header className="mt-6 max-w-4xl">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <StatusBadge status={poll.status} isOpen={poll.isOpen} />
          <Badge>{poll.creationMode === "AI" ? "Rédaction assistée par IA" : "Rédaction manuelle"}</Badge>
          <Badge>{poll.resultsVisibility === "LIVE" ? "Résultats en direct" : "Résultats à la clôture"}</Badge>
          {poll.status !== "DRAFT" && <LiveIndicator connected={connected} />}
        </div>
        <h1 className="mt-5 font-serif text-4xl font-black leading-[1.05] text-ink sm:text-6xl">{poll.question}</h1>
        {poll.description && <p className="mt-5 font-serif text-xl italic leading-snug text-umber">{poll.description}</p>}
      </header>

      {/* Byline */}
      <div className="mt-8 flex flex-col gap-4 border-y border-rule py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="text-umber">
            Par <span className="font-medium text-ink">{poll.creator.username}</span>
          </span>
          <span className="font-mono text-xs text-umber">
            {poll.publishedAt ? `Publié le ${formatShortDate(poll.publishedAt)} à ${formatTime(poll.publishedAt)}` : `Créé le ${formatShortDate(poll.createdAt)}`}
          </span>
        </div>
        <div>
          {poll.status === "CLOSED" && poll.closedAt ? (
            <span className="font-mono text-sm text-ink">Clos le {formatShortDate(poll.closedAt)} à {formatTime(poll.closedAt)}</span>
          ) : poll.status === "ACTIVE" ? (
            <Countdown endTime={poll.endTime} startTime={poll.publishedAt} onExpire={() => setPoll((p) => (p ? { ...p, isOpen: false } : p))} />
          ) : (
            <span className="font-mono text-sm text-umber">Clôture prévue le {formatShortDate(poll.endTime)} à {formatTime(poll.endTime)}</span>
          )}
        </div>
      </div>

      {/* Editor's actions */}
      {canEdit && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="kicker mr-2 text-umber">Édition</span>
          {poll.status === "DRAFT" && isOwner && (
            <>
              <ButtonLink href={`/polls/${poll.id}/edit`} variant="secondary" size="sm">Modifier</ButtonLink>
              <Button size="sm" loading={busy} onClick={() => runAction(async () => setPoll((await api.publishPoll(poll.id)).poll), "Sondage publié.")}>Publier</Button>
            </>
          )}
          {poll.status === "ACTIVE" && (
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              onClick={() => confirm("Clore ce scrutin maintenant ?") && runAction(async () => setPoll((await api.closePoll(poll.id)).poll), "Scrutin clos.")}
            >
              Clore le scrutin
            </Button>
          )}
          {(poll.status === "DRAFT" || isAdmin) && (
            <Button
              variant="danger"
              size="sm"
              loading={busy}
              onClick={() =>
                confirm("Supprimer définitivement ce sondage ?") &&
                runAction(async () => {
                  await api.deletePoll(poll.id);
                  router.push("/my-polls");
                }, "Sondage supprimé.")
              }
            >
              Supprimer
            </Button>
          )}
        </div>
      )}

      {poll.status === "DRAFT" ? (
        <div className="mt-10 max-w-2xl">
          <Alert kind="info">Ce sondage est un brouillon : vous seul pouvez le lire. Publiez-le pour ouvrir le scrutin.</Alert>
          <ol className="mt-8 border-t border-ink">
            {poll.options.map((o, i) => (
              <li key={o.id} className="flex gap-4 border-b border-rule py-3 font-serif text-lg">
                <span className="font-mono text-xs leading-7 text-umber">{String(i + 1).padStart(2, "0")}</span>
                {o.text}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <>
          <DoubleRule className="mt-10" />
          <div className="mt-10 grid gap-12 lg:grid-cols-12">
            <section className="lg:col-span-7" aria-labelledby="vote">
              <SectionTitle>
                <span id="vote">Votre vote</span>
              </SectionTitle>
              <Ballot poll={poll} selected={selected} onSelect={setSelected} onSubmit={submitVote} voting={voting} error={voteError} />
            </section>
            <section className="lg:col-span-5 lg:border-l lg:border-rule lg:pl-10" aria-labelledby="resultats">
              <SectionTitle>
                <span id="resultats">{poll.status === "CLOSED" ? "Résultats définitifs" : "Dépouillement"}</span>
              </SectionTitle>
              {roomError && <div className="mb-4"><Alert kind="warning">{roomError}</Alert></div>}
              {results ? <ResultsBars results={results} myVoteOptionId={poll.myVoteOptionId} /> : <PageLoader label="Dépouillement en cours" />}
            </section>
          </div>
        </>
      )}
    </article>
  );
}
