"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PollEntry } from "@/components/PollCard";
import { Alert, Button, ButtonLink, EmptyState, Input, PageHeader, PageLoader, Tabs } from "@/components/ui";
import { useI18n } from "@/contexts/PreferencesContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/format";
import type { Pagination, Poll } from "@/types";

export function PollsIndex() {
  const { ready } = useRequireAuth();
  const { t, errorText } = useI18n();
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
      .catch((e: ApiError) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, tab, query, page]);

  if (!ready) return <PageLoader />;
  const totalPages = data ? Math.max(1, Math.ceil(data.pagination.total / data.pagination.limit)) : 1;

  return (
    <>
      <PageHeader
        kicker={t("pollsIndex.kicker")}
        title={t("pollsIndex.title")}
        subtitle={t("pollsIndex.subtitle")}
        action={<ButtonLink href="/polls/new">{t("pollsIndex.write")}</ButtonLink>}
      />

      <div className="mb-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <Tabs
          label={t("pollsIndex.filter")}
          value={tab}
          onChange={(t) => {
            setTab(t);
            setPage(1);
            setData(null);
          }}
          items={[
            { value: "ACTIVE", label: t("pollsIndex.open") },
            { value: "CLOSED", label: t("pollsIndex.archives") },
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
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("pollsIndex.searchPlaceholder")} aria-label={t("pollsIndex.searchPlaceholder")} dir="auto" className="border-e-0 md:w-72" />
          <Button type="submit" variant="secondary" className="h-11">{t("common.search")}</Button>
        </form>
      </div>

      {error && <Alert>{error}</Alert>}
      {!data && !error && <PageLoader />}
      {data && data.polls.length === 0 && (
        <EmptyState
          title={query ? t("pollsIndex.noMatch") : tab === "ACTIVE" ? t("pollsIndex.noOpen") : t("pollsIndex.noArchives")}
          description={query ? t("pollsIndex.tryOther") : tab === "ACTIVE" ? t("pollsIndex.writeFirst") : undefined}
          action={tab === "ACTIVE" && !query ? <ButtonLink href="/polls/new">{t("pollsIndex.write")}</ButtonLink> : undefined}
        />
      )}
      {data && data.polls.length > 0 && (
        <>
          {query && (
            <p className="mb-6 font-serif italic text-umber">
              {t("pollsIndex.results", { count: data.pagination.total, query })}
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
            <nav className="mt-14 flex items-center justify-between border-t border-ink pt-4" aria-label={t("common.pagination")}>
              <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t("common.previousPage")}</Button>
              <span className="font-mono text-sm text-umber">{t("common.pageOf", { page, total: totalPages })}</span>
              <Button variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>{t("common.nextPage")}</Button>
            </nav>
          )}
        </>
      )}
    </>
  );
}
