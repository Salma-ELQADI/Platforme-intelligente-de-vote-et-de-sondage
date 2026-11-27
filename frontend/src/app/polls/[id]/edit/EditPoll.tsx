"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PollForm } from "@/components/PollForm";
import { Alert, ButtonLink, PageHeader, PageLoader } from "@/components/ui";
import { useI18n } from "@/contexts/PreferencesContext";
import { useToast } from "@/contexts/ToastContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { api, ApiError } from "@/lib/api";
import type { Poll, PollFormValues } from "@/types";

export function EditPoll({ id }: { id: string }) {
  const { ready, user } = useRequireAuth();
  const { t, errorText } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [poll, setPoll] = useState<Poll | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    api.getPoll(id).then(({ poll }) => setPoll(poll)).catch((e: ApiError) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, id]);

  const initial = useMemo(
    () =>
      poll && {
        question: poll.question,
        description: poll.description,
        options: poll.options.map((o) => o.text),
        endTime: poll.endTime,
        resultsVisibility: poll.resultsVisibility,
        access: poll.access,
        voters: poll.voters?.map((v) => v.username) ?? [],
        groupId: poll.group?.id ?? null,
      },
    [poll],
  );

  if (!ready || (!poll && !error)) return <PageLoader />;
  if (error || !poll || !initial) return <Alert>{error}</Alert>;
  if (poll.status !== "DRAFT" || poll.creator.id !== user?.id) {
    return (
      <div className="max-w-xl space-y-6">
        <Alert kind="warning">{t("editPoll.ownerOnly")}</Alert>
        <ButtonLink href={`/polls/${id}`} variant="secondary">{t("editPoll.back")}</ButtonLink>
      </div>
    );
  }

  const save = async (values: PollFormValues, publish: boolean) => {
    await api.updatePoll(id, values);
    if (publish) await api.publishPoll(id);
    toast(publish ? t("poll.published") : t("poll.changesSaved"), "success");
    router.push(`/polls/${id}`);
  };

  return (
    <>
      <PageHeader kicker={t("newPoll.kicker")} title={t("editPoll.title")} subtitle={t("editPoll.subtitle")} />
      <div className="max-w-3xl">
        <PollForm initial={initial} onSubmit={save} submitLabels={{ draft: t("pollForm.save"), publish: t("pollForm.saveAndPublish") }} />
      </div>
    </>
  );
}
