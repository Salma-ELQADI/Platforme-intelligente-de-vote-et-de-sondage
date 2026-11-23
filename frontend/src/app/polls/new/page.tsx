"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AiGeneratorPanel } from "@/components/AiGeneratorPanel";
import { PollForm } from "@/components/PollForm";
import { PageHeader, PageLoader, SectionTitle, Tabs } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { api } from "@/lib/api";
import type { GeneratedPoll, PollFormValues } from "@/types";

const guide = [
  { title: "Une seule idée par question", text: "Évitez les questions doubles : « et » dans une question cache souvent deux sondages." },
  { title: "Une formulation neutre", text: "La question ne doit pas suggérer de réponse. Préférez « Que pensez-vous de… » à « N’êtes-vous pas d’accord que… »." },
  { title: "Des réponses qui ne se chevauchent pas", text: "Chaque lecteur doit pouvoir se reconnaître dans une seule réponse." },
  { title: "Une clôture réaliste", text: "Laissez aux lecteurs le temps de voter : quelques heures pour un sujet chaud, quelques jours sinon." },
];

export default function NewPollPage() {
  const { ready } = useRequireAuth();
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
    toast(publish ? "Sondage publié." : "Brouillon enregistré.", "success");
    router.push(`/polls/${poll.id}`);
  };

  return (
    <>
      <PageHeader
        kicker="La rédaction"
        title="Rédiger un sondage"
        subtitle="Écrivez la question vous-même, ou commandez une première épreuve à l’IA puis corrigez-la."
      />
      <div className="mb-10">
        <Tabs
          label="Mode de rédaction"
          value={mode}
          onChange={setMode}
          items={[
            { value: "MANUAL", label: "Plume libre" },
            { value: "AI", label: "Bureau de l’IA" },
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
            {mode === "AI" && <SectionTitle>Relecture et mise en page</SectionTitle>}
            <PollForm
              key={`${mode}-${generation}`}
              initial={mode === "AI" && generated ? { question: generated.question, options: generated.options } : undefined}
              onSubmit={save}
            />
          </section>
          <aside className="lg:col-span-4 lg:border-l lg:border-rule lg:pl-10">
            <SectionTitle>Guide de rédaction</SectionTitle>
            <ol className="space-y-5">
              {guide.map((g, i) => (
                <li key={g.title} className="flex gap-4">
                  <span className="font-serif text-2xl font-black leading-none text-muted">{i + 1}</span>
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
