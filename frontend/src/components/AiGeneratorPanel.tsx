"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { GeneratedPoll } from "@/types";
import { Fleuron, PressLoader } from "./decor";
import { Alert, Button, Field, Input, Select, Textarea } from "./ui";

/**
 * The AI writing desk. The brief (topic, number of answers, language, note to the
 * newsroom) is sent to the backend (POST /api/ai/generate); the browser never talks
 * to OpenRouter. The result comes back as a typeset proof, which is NOT saved: the
 * parent loads it into the form for review.
 */
export function AiGeneratorPanel({ onGenerated, generated, proofNumber }: { onGenerated: (poll: GeneratedPoll) => void; generated: GeneratedPoll | null; proofNumber: number }) {
  const [topic, setTopic] = useState("");
  const [optionCount, setOptionCount] = useState(4);
  const [instructions, setInstructions] = useState("");
  const [language, setLanguage] = useState<"fr" | "en">("fr");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const generate = async (regenerate: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const { poll } = await api.generatePoll({
        topic,
        optionCount,
        language,
        instructions: instructions || undefined,
        previousQuestion: regenerate ? generated?.question : undefined,
      });
      onGenerated(poll);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "UNKNOWN", "Erreur inattendue"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-10 lg:grid-cols-12">
      {/* The commission: what the editor asks for */}
      <form
        className="space-y-6 lg:col-span-5"
        onSubmit={(e) => {
          e.preventDefault();
          generate(false);
        }}
      >
        <div>
          <p className="kicker text-umber">La commande</p>
          <p className="mt-1 font-serif italic text-umber">Décrivez le sujet ; l’IA rédige une question neutre et ses réponses.</p>
        </div>
        <Field label="Sujet" htmlFor="topic" error={error?.fieldError("topic")} hint="Par exemple : le télétravail, les transports à Casablanca">
          <Input id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} required minLength={3} maxLength={200} className="font-serif text-lg" />
        </Field>
        <div className="grid grid-cols-2 gap-5">
          <Field label="Nombre de réponses" htmlFor="count">
            <Select id="count" value={optionCount} onChange={(e) => setOptionCount(Number(e.target.value))} className="font-mono">
              {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </Select>
          </Field>
          <Field label="Langue de publication" htmlFor="lang">
            <Select id="lang" value={language} onChange={(e) => setLanguage(e.target.value as "fr" | "en")}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </Select>
          </Field>
        </div>
        <Field label="Note à la rédaction (facultatif)" htmlFor="instr">
          <Textarea id="instr" value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={500} placeholder="Public étudiant, ton informel…" />
        </Field>
        {error && <Alert>{error.message}</Alert>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={loading && !generated}>Commander une proposition</Button>
          {generated && (
            <Button type="button" variant="secondary" loading={loading} disabled={topic.trim().length < 3} onClick={() => generate(true)}>
              Demander une autre version
            </Button>
          )}
        </div>
      </form>

      {/* The proof: what comes back from the desk */}
      <div className="lg:col-span-7 lg:border-l lg:border-rule lg:pl-10">
        <p className="kicker text-umber">L’épreuve</p>
        <div className="mt-3 min-h-72 border border-ink bg-paper p-1.5">
          <div className="flex h-full min-h-[17rem] flex-col border border-rule p-6 sm:p-8">
            {loading ? (
              <div className="m-auto">
                <PressLoader label="Rédaction en cours" />
              </div>
            ) : generated ? (
              <>
                <div className="flex items-center justify-between font-mono text-[11px] text-umber">
                  <span>Épreuve n° {proofNumber}</span>
                  <span>Rédigé par {generated.model}</span>
                </div>
                <h3 className="mt-4 font-serif text-3xl font-bold leading-tight text-ink">{generated.question}</h3>
                <ol className="mt-5 border-t border-ink">
                  {generated.options.map((o, i) => (
                    <li key={i} className="flex gap-4 border-b border-rule py-2.5 font-serif text-lg text-ink">
                      <span className="font-mono text-xs leading-7 text-umber">{String(i + 1).padStart(2, "0")}</span>
                      {o}
                    </li>
                  ))}
                </ol>
                <p className="mt-auto pt-5 font-serif text-sm italic text-umber">
                  Épreuve non publiée. Elle est reprise ci-dessous pour relecture et correction.
                </p>
              </>
            ) : (
              <div className="m-auto max-w-xs text-center">
                <Fleuron size={22} outline className="mx-auto text-umber" />
                <p className="mt-4 font-serif text-lg italic text-umber">La page est blanche. Passez commande pour recevoir une première épreuve.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
