"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AiGeneratorPanel } from "@/components/AiGeneratorPanel";
import { PollForm } from "@/components/PollForm";
import { PageHeader, PageLoader, SectionTitle, Tabs } from "@/components/ui";
import { useI18n } from "@/contexts/PreferencesContext";
import { useToast } from "@/contexts/ToastContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { api } from "@/lib/api";
import type { GeneratedPoll, PollFormValues } from "@/types";

export default function NewPollPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <NewPoll />
    </Suspense>
  );
}

function NewPoll() {
  const { ready } = useRequireAuth();
  const { t, fmt } = useI18n();
  // "Lancer un sondage" from a group conversation pre-selects that group.
  const groupId = useSearchParams().get("group");
  const guide = [1, 2, 3, 4].map((n) => ({ title: t(`newPoll.guide${n}Title`), text: t(`newPoll.guide${n}`) }));
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<"MANUAL" | "AI">("MANUAL");
  const [generated, setGenerated] = useState<GeneratedPoll | null>(null);
  // Incremented for every AI proof: changing the form's key re-mounts it with the new values.
  const [generation, setGeneration] = useState(0);

  if (!ready) return <PageLoader />;

  /** Save = create (DRAFT), then optionally publish. Two explicit steps, as in the poll lifecycle. */
  const save = async (values: PollFormValues, publish: boolean) => {
    const { poll } = await api.createPoll({ ...values, creationMode: mode === "AI" && generated ? "AI" : "MANUAL" });
    if (publish) await api.publishPoll(poll.id);
    toast(publish ? t("poll.published") : t("poll.draftSaved"), "success");
    router.push(`/polls/${poll.id}`);
  };

  return (
    <>
      <PageHeader
        kicker={t("newPoll.kicker")}
        title={t("newPoll.title")}
        subtitle={t("newPoll.subtitle")}
      />
      <div className="mb-10">
        <Tabs
          label={t("newPoll.mode")}
          value={mode}
          onChange={setMode}
          items={[
            { value: "MANUAL", label: t("newPoll.manual") },
            { value: "AI", label: t("newPoll.aiDesk") },
          ]}
        />
      </div>

      {mode === "AI" && (
        <section className="mb-14">
          <AiGeneratorPanel
            generated={generated}
            proofNumber={generation}
            onGenerated={(poll) => {
              setGenerated(poll);
              setGeneration((g) => g + 1);
            }}
          />
        </section>
      )}

      {(mode === "MANUAL" || generated) && (
        <div className="grid gap-12 lg:grid-cols-12">
          <section className="lg:col-span-8">
            {mode === "AI" && <SectionTitle>{t("newPoll.review")}</SectionTitle>}
            <PollForm
              key={`${mode}-${generation}`}
              initial={{
                ...(mode === "AI" && generated ? { question: generated.question, options: generated.options } : {}),
                ...(groupId ? { access: "GROUP" as const, groupId } : {}),
              }}
              onSubmit={save}
            />
          </section>
          <aside className="lg:col-span-4 lg:border-s lg:border-rule lg:ps-10">
            <SectionTitle>{t("newPoll.guide")}</SectionTitle>
            <ol className="space-y-5">
              {guide.map((g, i) => (
                <li key={g.title} className="flex gap-4">
                  <span className="font-serif text-2xl font-black leading-none text-muted">{fmt.number(i + 1)}</span>
                  <div>
                    <p className="font-serif text-lg font-semibold text-ink">{g.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-umber">{g.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      )}
    </>
  );
}
