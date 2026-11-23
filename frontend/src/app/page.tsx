"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Fleuron } from "@/components/decor";
import { PollBrief, PollEntry, PollMeta } from "@/components/PollCard";
import { ResultsBars } from "@/components/ResultsBars";
import { Alert, ButtonLink, EmptyState, PageLoader, SectionTitle, StatusBadge } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
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
      .catch((e: ApiError) => setError(e.message));
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!active) return <PageLoader />;

  if (active.length === 0) {
    return (
      <>
        <EmptyState
          title="La une est encore blanche."
          description="Aucun sondage n’est ouvert pour le moment. Rédigez le premier : il fera la une dès sa publication."
          action={<ButtonLink href="/polls/new">Rédiger un sondage</ButtonLink>}
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
        <article className="lg:col-span-8 lg:border-r lg:border-rule lg:pr-10">
          <div className="flex flex-wrap items-center gap-3">
            <span className="kicker text-umber">À la une</span>
            <StatusBadge status={lead.status} isOpen={lead.isOpen} />
          </div>
          <h1 className="mt-4 font-serif text-4xl font-black leading-[1.05] text-ink sm:text-6xl">
            <Link href={`/polls/${lead.id}`} className="decoration-2 underline-offset-[6px] hover:underline">
              {lead.question}
            </Link>
          </h1>
          {lead.description && <p className="mt-4 font-serif text-xl italic leading-snug text-umber">{lead.description}</p>}
          <p className="mt-4 text-sm text-umber">
            Une question posée par <span className="font-medium text-ink">{lead.creator.username}</span>
          </p>
          <PollMeta poll={lead} className="mt-2" />
          <div className="mt-8 grid gap-8 border-t border-rule pt-6 md:grid-cols-2">
            <div>
              <p className="kicker text-umber">Les réponses proposées</p>
              <ol className="mt-3 space-y-2">
                {lead.options.map((o, i) => (
                  <li key={o.id} className="flex gap-3 font-serif text-lg text-ink">
                    <span className="font-mono text-sm leading-7 text-umber">{String(i + 1).padStart(2, "0")}</span>
                    {o.text}
                  </li>
                ))}
              </ol>
              <ButtonLink href={`/polls/${lead.id}`} className="mt-6">
                {lead.myVoteOptionId ? "Suivre le dépouillement" : "Voter"}
              </ButtonLink>
            </div>
            <div>{leadResults && <ResultsBars results={leadResults} myVoteOptionId={lead.myVoteOptionId} compact />}</div>
          </div>
        </article>

        <aside className="lg:col-span-4">
          <SectionTitle>Les plus suivis</SectionTitle>
          {trending.length > 0 ? (
            <ol>
              {trending.map((p, i) => (
                <PollBrief key={p.id} poll={p} rank={i + 2} />
              ))}
            </ol>
          ) : (
            <p className="font-serif italic text-umber">Les autres sondages ouverts apparaîtront ici.</p>
          )}
        </aside>
      </section>

      {latest.length > 0 && (
        <section className="mt-16">
          <SectionTitle aside={<Link href="/polls" className="kicker text-umber hover:text-ink">Tous les sondages</Link>}>Dernières publications</SectionTitle>
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
  return (
    <section className="mt-16">
      <SectionTitle aside={<Link href="/polls?status=CLOSED" className="kicker text-umber hover:text-ink">Archives</Link>}>Résultats définitifs</SectionTitle>
      <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
        {polls.map((p) => (
          <article key={p.id} className="group relative border-t border-rule pt-3">
            <Link href={`/polls/${p.id}`} className="font-serif text-lg font-semibold leading-snug text-ink after:absolute after:inset-0 group-hover:underline">
              {p.question}
            </Link>
            <p className="mt-2 font-mono text-xs text-umber">
              <span className="text-ink">{p.totalVotes}</span> vote{p.totalVotes > 1 ? "s" : ""} au dépouillement
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

const briefs = [
  { title: "Rédigez", text: "Une question, de deux à dix réponses, une date de clôture. Ou un simple thème, et l’IA propose un premier jet." },
  { title: "Publiez", text: "Le sondage passe du brouillon à la une. Vous décidez si les résultats se lisent en direct ou à la clôture." },
  { title: "Dépouillez", text: "Chaque bulletin déposé met à jour les chiffres sur l’écran de tous les lecteurs, sans recharger la page." },
  { title: "Concluez", text: "À l’heure dite, le scrutin se ferme seul et les participants sont avertis des résultats définitifs." },
];

const rubrics = [
  { title: "Le bulletin", text: "Un compte, une voix. La règle est vérifiée par le serveur et garantie par la base de données, même quand deux clics partent en même temps." },
  { title: "Le direct", text: "Les résultats sont recalculés à partir des votes enregistrés et diffusés aux seuls lecteurs du sondage concerné." },
  { title: "La rédaction assistée", text: "L’IA propose une question neutre et des réponses claires. Rien n’est publié sans votre relecture." },
];

function VisitorFrontPage() {
  return (
    <>
      <section className="grid gap-10 lg:grid-cols-12">
        <article className="lg:col-span-8 lg:border-r lg:border-rule lg:pr-10">
          <p className="kicker text-umber">Éditorial</p>
          <h1 className="mt-4 font-serif text-5xl font-black leading-[1.02] text-ink sm:text-7xl">Chaque voix compte une fois, et se lit tout de suite.</h1>
          <p className="mt-5 font-serif text-xl italic leading-snug text-umber">
            VoteLive est une salle de rédaction pour vos questions : vous les posez, la communauté vote, et les résultats s’impriment en direct.
          </p>
          <div className="mt-8 gap-8 border-t border-rule pt-6 text-[15px] leading-relaxed text-ink md:columns-2 [column-rule:1px_solid_#cbbba4]">
            <p className="dropcap">
              Un sondage commence par une question bien posée. Sur VoteLive, vous la rédigez vous-même, ou vous confiez un thème à l’intelligence
              artificielle, qui propose une formulation neutre et des réponses cohérentes. Vous relisez, corrigez, puis publiez.
            </p>
            <p className="mt-4">
              Une fois le scrutin ouvert, chaque participant dépose un seul bulletin. Les chiffres se mettent à jour à l’instant sur l’écran de tous ceux qui
              suivent le sondage. À la date prévue, le scrutin se ferme de lui-même et les résultats définitifs sont publiés.
            </p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/register" size="lg">Créer un compte</ButtonLink>
            <ButtonLink href="/login" size="lg" variant="secondary">Se connecter</ButtonLink>
          </div>
        </article>
        <aside className="lg:col-span-4">
          <SectionTitle>En quatre temps</SectionTitle>
          <ol>
            {briefs.map((b, i) => (
              <li key={b.title} className="flex gap-4 border-b border-rule py-4 last:border-b-0">
                <span className="font-serif text-3xl font-black leading-none text-muted">{i + 1}</span>
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
        <SectionTitle>Nos rubriques</SectionTitle>
        <div className="grid gap-10 md:grid-cols-3 md:gap-0 md:divide-x md:divide-rule">
          {rubrics.map((r) => (
            <div key={r.title} className="md:px-8 md:first:pl-0 md:last:pr-0">
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
