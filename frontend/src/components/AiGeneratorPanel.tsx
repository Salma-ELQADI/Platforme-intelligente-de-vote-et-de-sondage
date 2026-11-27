"use client";

import { useState } from "react";
import { useI18n } from "@/contexts/PreferencesContext";
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
  const { t, locale, errorText, fieldError } = useI18n();
  const [topic, setTopic] = useState("");
  const [optionCount, setOptionCount] = useState(4);
  const [instructions, setInstructions] = useState("");
  // Default publication language: the reader's interface language.
  const [language, setLanguage] = useState<"fr" | "en" | "ar">(locale);
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
      setError(e instanceof ApiError ? e : new ApiError(0, "UNKNOWN", ""));
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
          <p className="kicker text-umber">{t("ai.commission")}</p>
          <p className="mt-1 font-serif italic text-umber">{t("ai.commissionText")}</p>
        </div>
        <Field label={t("ai.topic")} htmlFor="topic" error={fieldError(error, "topic")} hint={t("ai.topicHint")}>
          <Input id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} required minLength={3} maxLength={200} dir="auto" className="font-serif text-lg" />
        </Field>
        <div className="grid grid-cols-2 gap-5">
          <Field label={t("ai.count")} htmlFor="count">
            <Select id="count" value={optionCount} onChange={(e) => setOptionCount(Number(e.target.value))} className="font-mono">
              {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("ai.language")} htmlFor="lang">
            <Select id="lang" value={language} onChange={(e) => setLanguage(e.target.value as "fr" | "en" | "ar")}>
              <option value="fr" lang="fr">Français</option>
              <option value="en" lang="en">English</option>
              <option value="ar" lang="ar">العربية</option>
            </Select>
          </Field>
        </div>
        <Field label={t("ai.note")} htmlFor="instr">
          <Textarea id="instr" value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={500} dir="auto" placeholder={t("ai.notePlaceholder")} />
        </Field>
        {error && <Alert>{errorText(error)}</Alert>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={loading && !generated}>{t("ai.order")}</Button>
          {generated && (
            <Button type="button" variant="secondary" loading={loading} disabled={topic.trim().length < 3} onClick={() => generate(true)}>
              {t("ai.another")}
            </Button>
          )}
        </div>
      </form>

      {/* The proof: what comes back from the desk */}
      <div className="lg:col-span-7 lg:border-s lg:border-rule lg:ps-10">
        <p className="kicker text-umber">{t("ai.proof")}</p>
        <div className="mt-3 min-h-72 border border-ink bg-paper p-1.5">
          <div className="flex h-full min-h-[17rem] flex-col border border-rule p-6 sm:p-8">
            {loading ? (
              <div className="m-auto">
                <PressLoader label={t("ai.writing")} />
              </div>
            ) : generated ? (
              <>
                <div className="flex items-center justify-between font-mono text-[11px] text-umber">
                  <span>{t("ai.proofNumber", { n: proofNumber })}</span>
                  <span>{t("ai.writtenBy", { model: generated.model })}</span>
                </div>
                <h3 className="bidi-auto mt-4 font-serif text-3xl font-bold leading-tight text-ink">{generated.question}</h3>
                <ol className="mt-5 border-t border-ink">
                  {generated.options.map((o, i) => (
                    <li key={i} className="flex gap-4 border-b border-rule py-2.5 font-serif text-lg text-ink">
                      <span className="font-mono text-xs leading-7 text-umber">{String(i + 1).padStart(2, "0")}</span>
                      <bdi>{o}</bdi>
                    </li>
                  ))}
                </ol>
                <p className="mt-auto pt-5 font-serif text-sm italic text-umber">
                  {t("ai.unpublished")}
                </p>
              </>
            ) : (
              <div className="m-auto max-w-xs text-center">
                <Fleuron size={22} outline className="mx-auto text-umber" />
                <p className="mt-4 font-serif text-lg italic text-umber">{t("ai.blank")}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
