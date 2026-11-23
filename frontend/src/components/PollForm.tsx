"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { cn, toDateTimeLocal } from "@/lib/format";
import type { PollFormValues, ResultsVisibility } from "@/types";
import { Alert, Button, Field, Input, Textarea } from "./ui";

const defaultEnd = () => new Date(Date.now() + 24 * 3600_000).toISOString();

const visibilityChoices: { value: ResultsVisibility; title: string; text: string }[] = [
  { value: "LIVE", title: "En direct", text: "Les lecteurs suivent les résultats pendant le vote." },
  { value: "AFTER_CLOSE", title: "Sous embargo", text: "Le détail est publié à la clôture, pour ne pas influencer le vote." },
];

/**
 * Shared layout form: manual creation, editing a draft and correcting an AI proof.
 * `initial` is only read on mount: the parent changes the `key` to load new values.
 * Client-side checks only improve the experience; the backend validates everything again.
 */
export function PollForm({
  initial,
  onSubmit,
  submitLabels = { draft: "Enregistrer le brouillon", publish: "Publier" },
}: {
  initial?: Partial<PollFormValues>;
  onSubmit: (values: PollFormValues, publish: boolean) => Promise<void>;
  submitLabels?: { draft: string; publish: string };
}) {
  const [question, setQuestion] = useState(initial?.question ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [options, setOptions] = useState<string[]>(initial?.options?.length ? initial.options : ["", ""]);
  const [endTime, setEndTime] = useState(toDateTimeLocal(initial?.endTime ?? defaultEnd()));
  const [visibility, setVisibility] = useState<ResultsVisibility>(initial?.resultsVisibility ?? "LIVE");
  const [pending, setPending] = useState<"draft" | "publish" | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const setOption = (i: number, value: string) => setOptions((opts) => opts.map((o, j) => (j === i ? value : o)));
  const removeOption = (i: number) => setOptions((opts) => opts.filter((_, j) => j !== i));
  const moveOption = (i: number, dir: -1 | 1) =>
    setOptions((opts) => {
      const next = [...opts];
      [next[i], next[i + dir]] = [next[i + dir], next[i]];
      return next;
    });

  const submit = async (publish: boolean) => {
    setError(null);
    const cleaned = options.map((o) => o.trim()).filter(Boolean);
    if (cleaned.length < 2) return setError(new ApiError(400, "VALIDATION_ERROR", "Ajoutez au moins deux réponses non vides."));
    setPending(publish ? "publish" : "draft");
    try {
      await onSubmit(
        {
          question: question.trim(),
          description: description.trim() || null,
          options: cleaned,
          endTime: new Date(endTime).toISOString(),
          resultsVisibility: visibility,
        },
        publish,
      );
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "UNKNOWN", "Erreur inattendue"));
    } finally {
      setPending(null);
    }
  };

  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      <Field label="La question" htmlFor="question" error={error?.fieldError("question")}>
        <Textarea
          id="question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          required
          minLength={5}
          maxLength={300}
          rows={2}
          placeholder="Quelle est votre question ?"
          className="min-h-0 font-serif text-2xl font-bold leading-tight sm:text-3xl"
        />
      </Field>

      <Field label="Chapeau (facultatif)" htmlFor="description" error={error?.fieldError("description")} hint="Une ou deux phrases de contexte, affichées sous la question.">
        <Textarea id="description" value={description ?? ""} onChange={(e) => setDescription(e.target.value)} maxLength={1000} className="font-serif text-lg italic" />
      </Field>

      <fieldset>
        <legend className="kicker mb-3 flex w-full items-center justify-between text-umber">
          <span>Réponses proposées</span>
          <span className="font-mono normal-case tracking-normal">{options.length} / 10</span>
        </legend>
        <ol className="border-t border-ink">
          {options.map((opt, i) => (
            <li key={i} className="flex items-center gap-3 border-b border-rule py-2">
              <span className="w-7 font-mono text-xs text-umber">{String(i + 1).padStart(2, "0")}</span>
              <input
                value={opt}
                onChange={(e) => setOption(i, e.target.value)}
                maxLength={200}
                placeholder={`Réponse ${i + 1}`}
                aria-label={`Réponse ${i + 1}`}
                className="h-10 flex-1 border-b border-transparent bg-transparent font-serif text-lg text-ink placeholder:text-umber/50 focus:border-ink focus:outline-none"
              />
              <div className="flex shrink-0 text-umber">
                <button type="button" className="grid h-8 w-8 place-items-center hover:text-ink disabled:opacity-25" disabled={i === 0} onClick={() => moveOption(i, -1)} aria-label={`Monter la réponse ${i + 1}`}>↑</button>
                <button type="button" className="grid h-8 w-8 place-items-center hover:text-ink disabled:opacity-25" disabled={i === options.length - 1} onClick={() => moveOption(i, 1)} aria-label={`Descendre la réponse ${i + 1}`}>↓</button>
                <button type="button" className="grid h-8 w-8 place-items-center hover:text-ink disabled:opacity-25" disabled={options.length <= 2} onClick={() => removeOption(i)} aria-label={`Retirer la réponse ${i + 1}`}>×</button>
              </div>
            </li>
          ))}
        </ol>
        {error?.fieldError("options") && <p className="mt-2 font-serif text-[13px] italic text-ink">{error.fieldError("options")}</p>}
        {options.length < 10 && (
          <button type="button" className="kicker mt-3 text-umber underline decoration-rule underline-offset-4 hover:text-ink" onClick={() => setOptions((o) => [...o, ""])}>
            Ajouter une réponse
          </button>
        )}
      </fieldset>

      <div className="grid gap-8 border-t border-rule pt-8 md:grid-cols-2">
        <Field label="Clôture du scrutin" htmlFor="endTime" error={error?.fieldError("endTime")}>
          <Input id="endTime" type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} required className="font-mono" />
        </Field>
        <fieldset>
          <legend className="kicker mb-2 text-umber">Publication des résultats</legend>
          <div className="grid gap-2">
            {visibilityChoices.map((c) => (
              <label
                key={c.value}
                className={cn(
                  "flex cursor-pointer gap-3 border px-3 py-2.5 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink",
                  visibility === c.value ? "border-ink bg-paper" : "border-rule hover:border-umber",
                )}
              >
                <input type="radio" name="visibility" value={c.value} checked={visibility === c.value} onChange={() => setVisibility(c.value)} className="mt-1 accent-[#38291f]" />
                <span>
                  <span className="block text-sm font-semibold text-ink">{c.title}</span>
                  <span className="block text-xs text-umber">{c.text}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {error && !error.details && <Alert>{error.message}</Alert>}
      {error?.details && !error.fieldError("question") && !error.fieldError("options") && !error.fieldError("endTime") && <Alert>{error.message}</Alert>}

      <div className="flex flex-wrap items-center gap-3 border-t border-ink pt-6">
        <Button type="button" loading={pending === "publish"} disabled={pending !== null} onClick={() => submit(true)}>
          {submitLabels.publish}
        </Button>
        <Button type="submit" variant="secondary" loading={pending === "draft"} disabled={pending !== null}>
          {submitLabels.draft}
        </Button>
        <span className="text-xs text-umber">Un sondage publié ne peut plus être modifié.</span>
      </div>
    </form>
  );
}
