"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PollEntry } from "@/components/PollCard";
import { Alert, Button, ButtonLink, EmptyState, Input, PageHeader, PageLoader, Tabs } from "@/components/ui";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/format";
import type { Pagination, Poll } from "@/types";

export function PollsIndex() {
  const { ready } = useRequireAuth();
  const initialTab = useSearchParams().get("status") === "CLOSED" ? "CLOSED" : "ACTIVE";
  const [tab, setTab] = useState<"ACTIVE" | "CLOSED">(initialTab);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ polls: Poll[]; pagination: Pagination } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    api
      .listPolls({ status: tab, search: query, page })
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch((e: ApiError) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [ready, tab, query, page]);

  if (!ready) return <PageLoader />;
  const totalPages = data ? Math.max(1, Math.ceil(data.pagination.total / data.pagination.limit)) : 1;

  return (
    <>
      <PageHeader
        kicker="Rubrique"
        title="Sondages"
        subtitle="Les scrutins ouverts attendent votre bulletin ; les archives gardent les résultats définitifs."
        action={<ButtonLink href="/polls/new">Rédiger un sondage</ButtonLink>}
      />

      <div className="mb-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <Tabs
          label="Filtrer les sondages"
          value={tab}
          onChange={(t) => {
            setTab(t);
            setPage(1);
            setData(null);
          }}
          items={[
            { value: "ACTIVE", label: "Scrutins ouverts" },
            { value: "CLOSED", label: "Archives" },
          ]}
        />
        <form
          role="search"
          className="flex"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQuery(search.trim());
          }}
        >
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher dans les questions" aria-label="Rechercher dans les questions" className="border-r-0 md:w-72" />
          <Button type="submit" variant="secondary" className="h-11">Rechercher</Button>
        </form>
      </div>

      {error && <Alert>{error}</Alert>}
      {!data && !error && <PageLoader />}
      {data && data.polls.length === 0 && (
        <EmptyState
          title={query ? "Aucune question ne correspond." : tab === "ACTIVE" ? "Aucun scrutin ouvert." : "Les archives sont vides."}
          description={query ? "Essayez avec d’autres mots." : tab === "ACTIVE" ? "Rédigez le premier sondage : il paraîtra ici dès sa publication." : undefined}
          action={tab === "ACTIVE" && !query ? <ButtonLink href="/polls/new">Rédiger un sondage</ButtonLink> : undefined}
        />
      )}
      {data && data.polls.length > 0 && (
        <>
          {query && (
            <p className="mb-6 font-serif italic text-umber">
              {data.pagination.total} résultat{data.pagination.total > 1 ? "s" : ""} pour « {query} »
            </p>
          )}
          <div className="grid gap-x-10 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
            {data.polls.map((p, i) => (
              // The first entry of the first page leads the page, across two columns.
              <div key={p.id} className={cn(i === 0 && page === 1 && "md:col-span-2")}>
                <PollEntry poll={p} size={i === 0 && page === 1 ? "lg" : "md"} />
              </div>
            ))}
          </div>
          {totalPages > 1 && (
            <nav className="mt-14 flex items-center justify-between border-t border-ink pt-4" aria-label="Pagination">
              <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Page précédente</Button>
              <span className="font-mono text-sm text-umber">
                Page {page} / {totalPages}
              </span>
              <Button variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Page suivante</Button>
            </nav>
          )}
        </>
      )}
    </>
  );
}
