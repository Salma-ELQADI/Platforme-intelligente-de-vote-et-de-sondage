"use client";

import { useCallback, useEffect, useState } from "react";
import { PollEntry } from "@/components/PollCard";
import { Alert, Button, ButtonLink, EmptyState, PageHeader, PageLoader, Tabs } from "@/components/ui";
import { useI18n } from "@/contexts/PreferencesContext";
import { useToast } from "@/contexts/ToastContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { api, ApiError } from "@/lib/api";
import type { Poll, PollStatus } from "@/types";

const tabs: { value: PollStatus | undefined; key: string }[] = [
  { value: undefined, key: "all" },
  { value: "DRAFT", key: "drafts" },
  { value: "SCHEDULED", key: "scheduled" },
  { value: "ACTIVE", key: "open" },
  { value: "CLOSED", key: "archives" },
];

export default function MyPollsPage() {
  const { ready } = useRequireAuth();
  const { t, errorText } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState<PollStatus | undefined>(undefined);
  const [polls, setPolls] = useState<Poll[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.myPolls(status).then(({ polls }) => setPolls(polls)).catch((e: ApiError) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      toast(errorText(e), "error");
    }
  };

  if (!ready) return <PageLoader />;

  const counts = polls ? { drafts: polls.filter((p) => p.status === "DRAFT").length, votes: polls.reduce((s, p) => s + p.totalVotes, 0) } : null;

  return (
    <>
      <PageHeader
        kicker={t("myPolls.kicker")}
        title={t("myPolls.title")}
        subtitle={t("myPolls.subtitle")}
        action={<ButtonLink href="/polls/new">{t("pollsIndex.write")}</ButtonLink>}
      />
      <div className="mb-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <Tabs label={t("myPolls.filter")} value={status} onChange={(v) => (setStatus(v), setPolls(null))} items={tabs.map((tab) => ({ value: tab.value, label: t(`myPolls.${tab.key}`) }))} />
        {counts && status === undefined && (
          <p className="font-mono text-xs text-umber">
            {t("myPolls.pollsCount", { count: polls!.length })} <span className="mx-2 text-muted">/</span>
            {t("myPolls.draftsCount", { count: counts.drafts })} <span className="mx-2 text-muted">/</span>
            {t("myPolls.votesCount", { count: counts.votes })}
          </p>
        )}
      </div>

      {error && <Alert>{error}</Alert>}
      {!polls && !error && <PageLoader />}
      {polls?.length === 0 && (
        <EmptyState title={t("myPolls.emptyTitle")} description={t("myPolls.emptyText")} action={<ButtonLink href="/polls/new">{t("pollsIndex.write")}</ButtonLink>} />
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
                      <ButtonLink href={`/polls/${p.id}/edit`} variant="secondary" size="sm">{t("poll.edit")}</ButtonLink>
                      <Button size="sm" onClick={() => act(() => api.publishPoll(p.id), t("poll.published"))}>{t("poll.publish")}</Button>
                      <Button variant="danger" size="sm" onClick={() => confirm(t("poll.confirmDeleteDraft")) && act(() => api.deletePoll(p.id), t("poll.draftDeleted"))}>
                        {t("poll.delete")}
                      </Button>
                    </>
                  )}
                  {p.status === "SCHEDULED" && (
                    <>
                      <Button variant="secondary" size="sm" onClick={() => act(() => api.unschedulePoll(p.id), t("poll.unscheduled"))}>
                        {t("poll.unschedule")}
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => confirm(t("poll.confirmDelete")) && act(() => api.deletePoll(p.id), t("poll.deleted"))}>
                        {t("poll.delete")}
                      </Button>
                    </>
                  )}
                  {p.status === "ACTIVE" && (
                    <Button variant="secondary" size="sm" onClick={() => confirm(t("poll.confirmClose")) && act(() => api.closePoll(p.id), t("poll.closed"))}>
                      {t("poll.close")}
                    </Button>
                  )}
                  <ButtonLink href={`/polls/${p.id}`} variant="ghost" size="sm">{t("poll.read")}</ButtonLink>
                </>
              }
            />
          ))}
        </div>
      )}
    </>
  );
}
