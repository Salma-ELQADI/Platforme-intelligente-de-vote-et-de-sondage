"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Fleuron } from "@/components/decor";
import { PollBrief, PollEntry, PollMeta } from "@/components/PollCard";
import { ResultsBars } from "@/components/ResultsBars";
import { Alert, ButtonLink, EmptyState, PageLoader, SectionTitle, StatusBadge } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/PreferencesContext";
import { api, ApiError } from "@/lib/api";
import type { Poll, PollResults } from "@/types";

export default function FrontPage() {
  const { status } = useAuth();
  if (status === "loading") return <PageLoader />;
  return status === "authenticated" ? <LiveFrontPage /> : <VisitorFrontPage />;
}

/* ------------------------------------------------------------------ */
/* Front page for signed-in readers: built only from real polls         */
/* ------------------------------------------------------------------ */

function LiveFrontPage() {
  const { t, rich, errorText } = useI18n();
  const [active, setActive] = useState<Poll[] | null>(null);
  const [closed, setClosed] = useState<Poll[]>([]);
  const [leadResults, setLeadResults] = useState<PollResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.listPolls({ status: "ACTIVE", limit: 50 }), api.listPolls({ status: "CLOSED", limit: 4 })])
      .then(([a, c]) => {
        // Lead story: the most-voted open poll (ties: the one closing soonest, as returned by the API).
        const ranked = [...a.polls].sort((x, y) => y.totalVotes - x.totalVotes);
        setActive(ranked);
        setClosed(c.polls);
        if (ranked[0]) api.results(ranked[0].id).then((r) => setLeadResults(r.results)).catch(() => undefined);
      })
      .catch((e: ApiError) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!active) return <PageLoader />;

  if (active.length === 0) {
    return (
      <>
        <EmptyState
          title={t("home.emptyTitle")}
          description={t("home.emptyText")}
          action={<ButtonLink href="/polls/new">{t("home.write")}</ButtonLink>}
        />
        {closed.length > 0 && <ClosedSection polls={closed} />}
      </>
    );
  }

  const [lead, ...rest] = active;
  const trending = rest.slice(0, 5);
  const latest = [...rest].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")).slice(0, 6);

  return (
    <>
      {/* Lead story + ranked sidebar */}
      <section className="grid gap-10 lg:grid-cols-12">
        <article className="lg:col-span-8 lg:border-e lg:border-rule lg:pe-10">
          <div className="flex flex-wrap items-center gap-3">
            <span className="kicker text-umber">{t("home.front")}</span>
            <StatusBadge status={lead.status} isOpen={lead.isOpen} />
          </div>
          <h1 className="bidi-auto mt-4 font-serif text-4xl font-black leading-[1.05] text-ink sm:text-6xl">
            <Link href={`/polls/${lead.id}`} className="decoration-2 underline-offset-[6px] hover:underline">
              {lead.question}
            </Link>
          </h1>
          {lead.description && <p className="bidi-auto mt-4 font-serif text-xl italic leading-snug text-umber">{lead.description}</p>}
          <p className="mt-4 text-sm text-umber">
            {rich("home.askedBy", { author: <bdi className="font-medium text-ink">{lead.creator.username}</bdi> })}
          </p>
          <PollMeta poll={lead} className="mt-2" />
          <div className="mt-8 grid gap-8 border-t border-rule pt-6 md:grid-cols-2">
            <div>
              <p className="kicker text-umber">{t("home.proposedAnswers")}</p>
              <ol className="mt-3 space-y-2">
                {lead.options.map((o, i) => (
                  <li key={o.id} className="flex gap-3 font-serif text-lg text-ink">
                    <span className="font-mono text-sm leading-7 text-umber">{String(i + 1).padStart(2, "0")}</span>
                    <bdi>{o.text}</bdi>
                  </li>
                ))}
              </ol>
              <ButtonLink href={`/polls/${lead.id}`} className="mt-6">
                {lead.canVote && !lead.myVoteOptionId && lead.isOpen ? t("poll.vote") : t("poll.follow")}
              </ButtonLink>
            </div>
            <div>{leadResults && <ResultsBars results={leadResults} myVoteOptionId={lead.myVoteOptionId} compact />}</div>
          </div>
        </article>

        <aside className="lg:col-span-4">
          <SectionTitle>{t("home.mostFollowed")}</SectionTitle>
          {trending.length > 0 ? (
            <ol>
              {trending.map((p, i) => (
                <PollBrief key={p.id} poll={p} rank={i + 2} />
              ))}
            </ol>
          ) : (
            <p className="font-serif italic text-umber">{t("home.othersHere")}</p>
          )}
        </aside>
      </section>

      {latest.length > 0 && (
        <section className="mt-16">
          <SectionTitle aside={<Link href="/polls" className="kicker text-umber hover:text-ink">{t("home.allPolls")}</Link>}>{t("home.latest")}</SectionTitle>
          <div className="grid gap-x-10 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
            {latest.map((p) => (
              <PollEntry key={p.id} poll={p} />
            ))}
          </div>
        </section>
      )}

      {closed.length > 0 && <ClosedSection polls={closed} />}
    </>
  );
}

function ClosedSection({ polls }: { polls: Poll[] }) {
  const { t } = useI18n();
  return (
    <section className="mt-16">
      <SectionTitle aside={<Link href="/polls?status=CLOSED" className="kicker text-umber hover:text-ink">{t("home.archives")}</Link>}>{t("home.finalResults")}</SectionTitle>
      <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
        {polls.map((p) => (
          <article key={p.id} className="group relative border-t border-rule pt-3">
            <Link href={`/polls/${p.id}`} className="bidi-auto font-serif text-lg font-semibold leading-snug text-ink after:absolute after:inset-0 group-hover:underline">
              {p.question}
            </Link>
            <p className="mt-2 font-mono text-xs text-umber">
              {t("home.countedVotes", { count: p.totalVotes })}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Front page for visitors: an editorial presenting the platform        */
/* ------------------------------------------------------------------ */

function VisitorFrontPage() {
  const { t, fmt } = useI18n();
  const briefs = [1, 2, 3, 4].map((n) => ({ title: t(`visitor.step${n}Title`), text: t(`visitor.step${n}`) }));
  const rubrics = [1, 2, 3].map((n) => ({ title: t(`visitor.rubric${n}Title`), text: t(`visitor.rubric${n}`) }));
  return (
    <>
      <section className="grid gap-10 lg:grid-cols-12">
        <article className="lg:col-span-8 lg:border-e lg:border-rule lg:pe-10">
          <p className="kicker text-umber">{t("visitor.kicker")}</p>
          <h1 className="mt-4 font-serif text-5xl font-black leading-[1.02] text-ink sm:text-7xl">{t("visitor.headline")}</h1>
          <p className="mt-5 font-serif text-xl italic leading-snug text-umber">{t("visitor.standfirst")}</p>
          <div className="mt-8 gap-8 border-t border-rule pt-6 text-[15px] leading-relaxed text-ink md:columns-2 [column-rule:1px_solid_var(--border)]">
            <p className="dropcap">{t("visitor.p1")}</p>
            <p className="mt-4">{t("visitor.p2")}</p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/register" size="lg">{t("visitor.register")}</ButtonLink>
            <ButtonLink href="/login" size="lg" variant="secondary">{t("visitor.login")}</ButtonLink>
          </div>
        </article>
        <aside className="lg:col-span-4">
          <SectionTitle>{t("visitor.fourSteps")}</SectionTitle>
          <ol>
            {briefs.map((b, i) => (
              <li key={b.title} className="flex gap-4 border-b border-rule py-4 last:border-b-0">
                <span className="font-serif text-3xl font-black leading-none text-muted">{fmt.number(i + 1)}</span>
                <div>
                  <p className="font-serif text-lg font-semibold text-ink">{b.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-umber">{b.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </section>

      <section className="mt-16">
        <SectionTitle>{t("visitor.rubrics")}</SectionTitle>
        <div className="grid gap-10 md:grid-cols-3 md:gap-0 md:divide-x md:divide-rule">
          {rubrics.map((r) => (
            <div key={r.title} className="md:px-8 md:first:ps-0 md:last:pe-0">
              <Fleuron size={14} className="text-umber" />
              <h2 className="mt-3 font-serif text-2xl font-bold text-ink">{r.title}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-umber">{r.text}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
