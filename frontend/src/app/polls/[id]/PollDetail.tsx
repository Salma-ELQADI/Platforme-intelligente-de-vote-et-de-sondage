"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AiSummary } from "@/components/AiSummary";
import { Ballot } from "@/components/Ballot";
import { Countdown } from "@/components/Countdown";
import { ResultsBars } from "@/components/ResultsBars";
import { Alert, Badge, Button, ButtonLink, LiveIndicator, PageLoader, SectionTitle, Skeleton, StatusBadge } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/PreferencesContext";
import { useToast } from "@/contexts/ToastContext";
import { usePollRoom } from "@/hooks/usePollRoom";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { api, ApiError } from "@/lib/api";
import { serial } from "@/lib/format";
import type { Poll, PollVoter } from "@/types";

export function PollDetail({ id }: { id: string }) {
  const { ready } = useRequireAuth();
  const { user } = useAuth();
  const { t, errorText, fmt } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [poll, setPoll] = useState<Poll | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
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
  const canEdit = ((poll.status === "DRAFT" || poll.status === "SCHEDULED") && isOwner) || (poll.status === "ACTIVE" && (isOwner || isAdmin)) || isAdmin;

  const submitVote = async () => {
    if (selected.length === 0) return;
    setVoting(true);
    setVoteError(null);
    try {
      const data = await api.vote(poll.id, selected);
      setPoll({ ...poll, myVoteOptionId: selected[0], myChoices: selected, totalVotes: data.results.totalVotes });
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
      <header className="mt-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <StatusBadge status={poll.status} isOpen={poll.isOpen} size="lg" />
          {poll.status !== "DRAFT" && <LiveIndicator connected={connected} />}
        </div>
        <h1 className="bidi-auto mt-4 w-fit max-w-4xl text-balance font-serif text-[2rem] font-bold leading-[1.1] text-ink sm:text-[2.6rem] lg:text-5xl lg:leading-[1.06]">
          {poll.question}
        </h1>
        {poll.description && <p className="bidi-auto mt-4 w-fit max-w-3xl font-serif text-lg italic leading-snug text-umber sm:text-xl">{poll.description}</p>}
        {/* Attributes of the poll, one quiet line: the method and access carry meaning, so they are set in ink. */}
        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1">
          {[
            poll.votingMethod !== "SINGLE" && (
              <Badge key="m" className="text-ink">
                {poll.votingMethod === "MULTIPLE" ? t("poll.methodMultipleMax", { count: poll.maxChoices ?? 2 }) : t("poll.methodRANKED")}
              </Badge>
            ),
            poll.access === "PRIVATE" && <Badge key="a" className="text-ink">{t("poll.privateLong")}</Badge>,
            poll.group && (
              <Link key="g" href={`/messages/${poll.group.id}`} className="kicker text-accent underline-offset-4 hover:underline">
                {t("poll.groupBadge", { name: poll.group.name })}
              </Link>
            ),
            <Badge key="r">{poll.resultsVisibility === "LIVE" ? t("poll.liveResults") : t("poll.afterCloseResults")}</Badge>,
            <Badge key="c">{poll.creationMode === "AI" ? t("poll.aiWritten") : t("poll.manualWritten")}</Badge>,
          ]
            .filter(Boolean)
            .flatMap((el, i) => (i === 0 ? [el] : [<span key={`s${i}`} className="text-muted" aria-hidden="true">·</span>, el]))}
        </p>
      </header>

      {/* Dateline: who, when, until when, how many */}
      <dl className="mt-7 grid grid-cols-2 border-y border-ink sm:grid-cols-4">
        <MetaCell label={t("pollDetail.metaAuthor")}>
          <bdi className="font-serif text-[17px] font-semibold text-ink">{poll.creator.username}</bdi>
        </MetaCell>
        <MetaCell label={poll.publishedAt ? t("pollDetail.metaPublished") : t("pollDetail.metaCreated")}>
          <span className="font-mono text-sm text-ink">
            {fmt.shortDate(poll.publishedAt ?? poll.createdAt)}
            {poll.publishedAt && <span className="text-umber"> · {fmt.time(poll.publishedAt)}</span>}
          </span>
        </MetaCell>
        <MetaCell
          label={
            poll.status === "CLOSED" ? t("pollDetail.metaClosed") : poll.status === "SCHEDULED" ? t("pollDetail.metaOpens") : t("pollDetail.metaCloses")
          }
        >
          {poll.status === "CLOSED" && poll.closedAt ? (
            <span className="font-mono text-sm text-ink">{fmt.shortDate(poll.closedAt)} <span className="text-umber">· {fmt.time(poll.closedAt)}</span></span>
          ) : poll.status === "SCHEDULED" && poll.startsAt ? (
            <span className="font-mono text-sm text-accent">{fmt.shortDate(poll.startsAt)} · {fmt.time(poll.startsAt)}</span>
          ) : poll.status === "ACTIVE" ? (
            <Countdown endTime={poll.endTime} startTime={poll.publishedAt} onExpire={() => setPoll((p) => (p ? { ...p, isOpen: false } : p))} />
          ) : (
            <span className="font-mono text-sm text-umber">{fmt.shortDate(poll.endTime)} · {fmt.time(poll.endTime)}</span>
          )}
        </MetaCell>
        <MetaCell label={t("pollDetail.metaTurnout")}>
          <span className="font-mono text-sm tabular-nums text-ink">{t("poll.votes", { count: results?.totalVotes ?? poll.totalVotes })}</span>
        </MetaCell>
      </dl>

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
          {poll.status === "SCHEDULED" && isOwner && (
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              onClick={() => runAction(async () => setPoll((await api.unschedulePoll(poll.id)).poll), t("poll.unscheduled"))}
            >
              {t("poll.unschedule")}
            </Button>
          )}
          {(poll.status === "DRAFT" || poll.status === "SCHEDULED" || isAdmin) && (
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

      {poll.voters && <InvitedVoters voters={poll.voters} />}

      {poll.status === "DRAFT" || poll.status === "SCHEDULED" ? (
        <div className="mt-10 max-w-2xl">
          <Alert kind="info">
            {poll.status === "SCHEDULED" && poll.startsAt
              ? t("pollDetail.scheduledNotice", { date: fmt.shortDate(poll.startsAt), time: fmt.time(poll.startsAt) })
              : t("pollDetail.draftNotice")}
          </Alert>
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
          <div className="mt-10 grid gap-12 lg:grid-cols-12 lg:gap-10">
            <section className="lg:col-span-7" aria-labelledby="vote">
              <SectionTitle number="01">
                <span id="vote">{t("pollDetail.yourVote")}</span>
              </SectionTitle>
              <Ballot poll={poll} isOwner={isOwner} selected={selected} onChange={setSelected} onSubmit={submitVote} voting={voting} error={voteError} />
            </section>
            <section className="lg:col-span-5 lg:border-s lg:border-rule lg:ps-10" aria-labelledby="resultats">
              <SectionTitle number="02">
                <span id="resultats">{poll.status === "CLOSED" ? t("pollDetail.finalResults") : t("pollDetail.counting")}</span>
              </SectionTitle>
              {roomError && <div className="mb-4"><Alert kind="warning">{t("pollDetail.roomError")}</Alert></div>}
              {results ? (
                <ResultsBars results={results} myVoteOptionId={poll.myVoteOptionId} myChoices={poll.myChoices} />
              ) : (
                <div role="status" aria-label={t("pollDetail.countingInProgress")} className="space-y-6">
                  <Skeleton className="h-14 w-32" />
                  {poll.options.map((o) => (
                    <div key={o.id} className="space-y-2">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-2.5 w-full" />
                    </div>
                  ))}
                </div>
              )}
              {poll.status === "CLOSED" && poll.totalVotes > 0 && <div className="mt-8"><AiSummary pollId={poll.id} /></div>}
            </section>
          </div>
        </>
      )}
    </article>
  );
}

/** One cell of the dateline grid: small label above, value below. */
function MetaCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 border-rule py-3.5 odd:pe-4 even:border-s even:ps-4 [&:nth-child(n+3)]:border-t sm:border-s sm:px-4 sm:first:border-s-0 sm:first:ps-0 sm:[&:nth-child(n+3)]:border-t-0">
      <dt className="kicker text-umber">{label}</dt>
      <dd className="mt-1.5">{children}</dd>
    </div>
  );
}

/** Invited voters of a private poll as name tags; long lists are folded. */
function InvitedVoters({ voters }: { voters: PollVoter[] }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const LIMIT = 12;
  const shown = all ? voters : voters.slice(0, LIMIT);
  return (
    <div className="mt-6 max-w-4xl">
      <p className="kicker text-umber">{t("pollDetail.invited", { count: voters.length })}</p>
      {voters.length === 0 ? (
        <p className="mt-2 font-serif italic text-umber">{t("pollDetail.noInvited")}</p>
      ) : (
        <ul className="mt-2.5 flex flex-wrap gap-2">
          {shown.map((v) => (
            <li key={v.id} className="inline-flex h-8 items-center gap-2 border border-rule bg-paper pe-3 ps-1 text-sm text-ink">
              <span className="grid h-6 w-6 place-items-center rounded-full border border-ink/60 font-serif text-xs font-bold" aria-hidden="true">
                {[...v.username][0]?.toUpperCase()}
              </span>
              <bdi>{v.username}</bdi>
            </li>
          ))}
          {voters.length > LIMIT && (
            <li>
              <button type="button" onClick={() => setAll((a) => !a)} className="kicker h-8 px-2 text-ink underline decoration-rule underline-offset-4 hover:decoration-ink">
                {all ? t("pollDetail.showFewer") : t("pollDetail.showAll", { count: voters.length })}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
