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
import { useI18n } from "@/contexts/PreferencesContext";
import { useToast } from "@/contexts/ToastContext";
import { usePollRoom } from "@/hooks/usePollRoom";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { api, ApiError } from "@/lib/api";
import { serial } from "@/lib/format";
import type { Poll } from "@/types";

export function PollDetail({ id }: { id: string }) {
  const { ready } = useRequireAuth();
  const { user } = useAuth();
  const { t, rich, errorText, fmt } = useI18n();
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
      toast(t("pollDetail.justClosed"), "info");
    },
    [toast, t],
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
        <Alert>{loadError?.status === 404 ? t("pollDetail.notFound") : errorText(loadError)}</Alert>
        <ButtonLink href="/polls" variant="secondary">{t("pollDetail.backToPolls")}</ButtonLink>
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
      toast(t("pollDetail.voteCast"), "success");
    } catch (e) {
      const err = e as ApiError;
      setVoteError(errorText(err));
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
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article>
      <nav className="kicker flex items-center gap-2 text-umber" aria-label={t("pollDetail.breadcrumb")}>
        <Link href="/polls" className="hover:text-ink">{t("nav.polls")}</Link>
        <span aria-hidden="true">/</span>
        {poll.group && (
          <>
            <Link href={`/messages/${poll.group.id}`} className="hover:text-ink"><bdi>{poll.group.name}</bdi></Link>
            <span aria-hidden="true">/</span>
          </>
        )}
        <span className="font-mono normal-case tracking-normal">{t("pollDetail.serial", { serial: serial(poll.id) })}</span>
      </nav>

      {/* Article header */}
      <header className="mt-6 max-w-4xl">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <StatusBadge status={poll.status} isOpen={poll.isOpen} />
          <Badge>{poll.creationMode === "AI" ? t("poll.aiWritten") : t("poll.manualWritten")}</Badge>
          <Badge>{poll.resultsVisibility === "LIVE" ? t("poll.liveResults") : t("poll.afterCloseResults")}</Badge>
          {poll.access === "PRIVATE" && <Badge className="text-ink">{t("poll.privateLong")}</Badge>}
          {poll.group && <Badge className="text-accent">{t("poll.groupBadge", { name: poll.group.name })}</Badge>}
          {poll.status !== "DRAFT" && <LiveIndicator connected={connected} />}
        </div>
        <h1 className="bidi-auto mt-5 font-serif text-4xl font-black leading-[1.05] text-ink sm:text-6xl">{poll.question}</h1>
        {poll.description && <p className="bidi-auto mt-5 font-serif text-xl italic leading-snug text-umber">{poll.description}</p>}
      </header>

      {/* Byline */}
      <div className="mt-8 flex flex-col gap-4 border-y border-rule py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="text-umber">
            {rich("common.by", { author: <bdi className="font-medium text-ink">{poll.creator.username}</bdi> })}
          </span>
          <span className="font-mono text-xs text-umber">
            {poll.publishedAt
              ? t("pollDetail.publishedOn", { date: fmt.shortDate(poll.publishedAt), time: fmt.time(poll.publishedAt) })
              : t("pollDetail.createdOn", { date: fmt.shortDate(poll.createdAt) })}
          </span>
          {poll.group && (
            <Link href={`/messages/${poll.group.id}`} className="kicker text-accent hover:text-ink">
              {t("pollDetail.openGroup")}
            </Link>
          )}
        </div>
        <div>
          {poll.status === "CLOSED" && poll.closedAt ? (
            <span className="font-mono text-sm text-ink">{t("pollDetail.closedOn", { date: fmt.shortDate(poll.closedAt), time: fmt.time(poll.closedAt) })}</span>
          ) : poll.status === "ACTIVE" ? (
            <Countdown endTime={poll.endTime} startTime={poll.publishedAt} onExpire={() => setPoll((p) => (p ? { ...p, isOpen: false } : p))} />
          ) : (
            <span className="font-mono text-sm text-umber">{t("pollDetail.plannedClose", { date: fmt.shortDate(poll.endTime), time: fmt.time(poll.endTime) })}</span>
          )}
        </div>
      </div>

      {/* Editor's actions */}
      {canEdit && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="kicker me-2 text-umber">{t("pollDetail.editing")}</span>
          {poll.status === "DRAFT" && isOwner && (
            <>
              <ButtonLink href={`/polls/${poll.id}/edit`} variant="secondary" size="sm">{t("poll.edit")}</ButtonLink>
              <Button size="sm" loading={busy} onClick={() => runAction(async () => setPoll((await api.publishPoll(poll.id)).poll), t("poll.published"))}>{t("poll.publish")}</Button>
            </>
          )}
          {poll.status === "ACTIVE" && (
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              onClick={() => confirm(t("poll.confirmClose")) && runAction(async () => setPoll((await api.closePoll(poll.id)).poll), t("poll.closed"))}
            >
              {t("poll.close")}
            </Button>
          )}
          {(poll.status === "DRAFT" || isAdmin) && (
            <Button
              variant="danger"
              size="sm"
              loading={busy}
              onClick={() =>
                confirm(t("poll.confirmDelete")) &&
                runAction(async () => {
                  await api.deletePoll(poll.id);
                  router.push("/my-polls");
                }, t("poll.deleted"))
              }
            >
              {t("poll.delete")}
            </Button>
          )}
        </div>
      )}

      {poll.voters && (
        <div className="mt-6 max-w-4xl text-sm text-umber">
          <span className="kicker me-3">{t("pollDetail.invited", { count: poll.voters.length })}</span>
          {poll.voters.length ? (
            <bdi className="font-mono text-xs text-ink">{poll.voters.map((v) => v.username).join(", ")}</bdi>
          ) : (
            <span className="italic">{t("pollDetail.noInvited")}</span>
          )}
        </div>
      )}

      {poll.status === "DRAFT" ? (
        <div className="mt-10 max-w-2xl">
          <Alert kind="info">{t("pollDetail.draftNotice")}</Alert>
          <ol className="mt-8 border-t border-ink">
            {poll.options.map((o, i) => (
              <li key={o.id} className="flex gap-4 border-b border-rule py-3 font-serif text-lg">
                <span className="font-mono text-xs leading-7 text-umber">{String(i + 1).padStart(2, "0")}</span>
                <bdi>{o.text}</bdi>
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
                <span id="vote">{t("pollDetail.yourVote")}</span>
              </SectionTitle>
              <Ballot poll={poll} isOwner={isOwner} selected={selected} onSelect={setSelected} onSubmit={submitVote} voting={voting} error={voteError} />
            </section>
            <section className="lg:col-span-5 lg:border-s lg:border-rule lg:ps-10" aria-labelledby="resultats">
              <SectionTitle>
                <span id="resultats">{poll.status === "CLOSED" ? t("pollDetail.finalResults") : t("pollDetail.counting")}</span>
              </SectionTitle>
              {roomError && <div className="mb-4"><Alert kind="warning">{t("pollDetail.roomError")}</Alert></div>}
              {results ? <ResultsBars results={results} myVoteOptionId={poll.myVoteOptionId} /> : <PageLoader label={t("pollDetail.countingInProgress")} />}
            </section>
          </div>
        </>
      )}
    </article>
  );
}
