"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/PreferencesContext";
import { api, ApiError } from "@/lib/api";
import { cn, toDateTimeLocal } from "@/lib/format";
import type { Conversation, PollAccess, PollFormValues, ResultsVisibility, VotingMethod } from "@/types";
import { Alert, Button, Field, Input, Select, Textarea } from "./ui";

const defaultEnd = () => new Date(Date.now() + 24 * 3600_000).toISOString();

const visibilityChoices: { value: ResultsVisibility; key: string }[] = [
  { value: "LIVE", key: "live" },
  { value: "AFTER_CLOSE", key: "embargo" },
];

const methodChoices: { value: VotingMethod; key: string }[] = [
  { value: "SINGLE", key: "single" },
  { value: "MULTIPLE", key: "multiple" },
  { value: "RANKED", key: "ranked" },
];

/** Reminder lead times offered (minutes). */
const reminderChoices = [15, 60, 180, 1440];

const accessChoices: { value: PollAccess; key: string }[] = [
  { value: "PUBLIC", key: "public" },
  { value: "PRIVATE", key: "private" },
  { value: "GROUP", key: "group" },
];

/** Radio card used for the results and access choices. */
function Choice({ name, checked, onChange, title, text }: { name: string; checked: boolean; onChange: () => void; title: string; text: string }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 border px-3 py-2.5 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink",
        checked ? "border-ink bg-paper" : "border-rule hover:border-umber",
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="mt-1 accent-[var(--foreground)]" />
      <span>
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="block text-xs text-umber">{text}</span>
      </span>
    </label>
  );
}

/** The groups the author belongs to: a group poll can only target one of them. */
function GroupPicker({ value, onChange, error }: { value: string; onChange: (id: string) => void; error?: string }) {
  const { t } = useI18n();
  const [groups, setGroups] = useState<Conversation[] | null>(null);

  useEffect(() => {
    api
      .conversations()
      .then(({ conversations }) => setGroups(conversations.filter((c) => c.type === "GROUP")))
      .catch(() => setGroups([]));
  }, []);

  if (groups && groups.length === 0) return <Alert kind="info">{t("pollForm.noGroups")}</Alert>;
  return (
    <Field label={t("pollForm.group")} htmlFor="groupId" error={error}>
      <Select id="groupId" value={value} onChange={(e) => onChange(e.target.value)} disabled={!groups}>
        <option value="">{t("pollForm.chooseGroup")}</option>
        {groups?.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name} · {t("groups.membersCount", { count: g.members.length })}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/**
 * Invited voters of a private poll. Each username or email is checked against
 * the backend before being added; the backend resolves the list again on save.
 */
function VotersPicker({ voters, onChange, error }: { voters: string[]; onChange: (v: string[]) => void; error?: string }) {
  const { t, errorText } = useI18n();
  const { user: me } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [checking, setChecking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const add = async () => {
    const value = identifier.trim();
    if (!value) return;
    setLookupError(null);
    setChecking(true);
    try {
      const { user } = await api.lookupUser(value);
      // Caught here, before saving: the author never votes in their own private poll.
      if (user.id === me?.id) setLookupError(t("fieldErrors.codes.SELF_INVITE"));
      else if (voters.some((v) => v.toLowerCase() === user.username.toLowerCase())) setLookupError(t("pollForm.alreadyInvited", { name: user.username }));
      else {
        onChange([...voters, user.username]);
        setIdentifier("");
      }
    } catch (e) {
      setLookupError(e instanceof ApiError ? errorText(e) : t("pollForm.checkFailed"));
    } finally {
      setChecking(false);
    }
  };

  return (
    <Field
      label={t("pollForm.invited")}
      htmlFor="voter"
      error={lookupError ?? error}
      hint={t("pollForm.invitedHint")}
    >
      <div className="flex gap-2">
        <Input
          id="voter"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          maxLength={255}
          placeholder={t("pollForm.invitePlaceholder")}
          autoComplete="off"
          dir="auto"
        />
        <Button type="button" variant="secondary" loading={checking} disabled={!identifier.trim()} onClick={add}>
          {t("pollForm.invite")}
        </Button>
      </div>
      {voters.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label={t("pollForm.invited")}>
          {voters.map((v) => (
            <li key={v} className="flex items-center gap-1 border border-ink bg-paper py-1 ps-3 pe-1 font-mono text-xs text-ink">
              <bdi>{v}</bdi>
              <button type="button" className="grid h-6 w-6 place-items-center text-umber hover:text-ink" onClick={() => onChange(voters.filter((x) => x !== v))} aria-label={t("pollForm.removeVoter", { name: v })}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </Field>
  );
}

/**
 * Shared layout form: manual creation, editing a draft and correcting an AI proof.
 * `initial` is only read on mount: the parent changes the `key` to load new values.
 * Client-side checks only improve the experience; the backend validates everything again.
 */
export function PollForm({
  initial,
  onSubmit,
  submitLabels,
}: {
  initial?: Partial<PollFormValues>;
  onSubmit: (values: PollFormValues, publish: boolean) => Promise<void>;
  submitLabels?: { draft: string; publish: string };
}) {
  const { t, fieldError, errorText } = useI18n();
  const labels = submitLabels ?? { draft: t("pollForm.saveDraft"), publish: t("pollForm.publish") };
  const [question, setQuestion] = useState(initial?.question ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [options, setOptions] = useState<string[]>(initial?.options?.length ? initial.options : ["", ""]);
  const [endTime, setEndTime] = useState(toDateTimeLocal(initial?.endTime ?? defaultEnd()));
  const [visibility, setVisibility] = useState<ResultsVisibility>(initial?.resultsVisibility ?? "LIVE");
  const [access, setAccess] = useState<PollAccess>(initial?.access ?? "PUBLIC");
  const [voters, setVoters] = useState<string[]>(initial?.voters ?? []);
  const [groupId, setGroupId] = useState(initial?.groupId ?? "");
  const [method, setMethod] = useState<VotingMethod>(initial?.votingMethod ?? "SINGLE");
  const [maxChoices, setMaxChoices] = useState(initial?.maxChoices ?? 2);
  const [scheduled, setScheduled] = useState(!!initial?.startsAt);
  const [startsAt, setStartsAt] = useState(() => toDateTimeLocal(initial?.startsAt ?? new Date(Date.now() + 3600_000).toISOString()));
  const [reminder, setReminder] = useState<number | null>(initial?.remindBeforeMinutes ?? null);
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
    // Client-side checks, worded in the reader's language ("CLIENT" errors are shown as is).
    if (cleaned.length < 2) return setError(new ApiError(400, "CLIENT", t("pollForm.twoAnswers")));
    if (publish && access === "PRIVATE" && voters.length === 0) {
      const message = t("pollForm.inviteOne");
      return setError(new ApiError(400, "CLIENT", message, [{ field: "voters", message }]));
    }
    if (access === "GROUP" && !groupId) {
      const message = t("pollForm.pickGroup");
      return setError(new ApiError(400, "CLIENT", message, [{ field: "groupId", message }]));
    }
    setPending(publish ? "publish" : "draft");
    try {
      await onSubmit(
        {
          question: question.trim(),
          description: description.trim() || null,
          options: cleaned,
          endTime: new Date(endTime).toISOString(),
          resultsVisibility: visibility,
          access,
          voters: access === "PRIVATE" ? voters : [],
          groupId: access === "GROUP" ? groupId : null,
          votingMethod: method,
          maxChoices: method === "MULTIPLE" ? Math.min(maxChoices, cleaned.length) : null,
          startsAt: scheduled ? new Date(startsAt).toISOString() : null,
          remindBeforeMinutes: access === "PUBLIC" ? null : reminder,
        },
        publish,
      );
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "UNKNOWN", ""));
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
      <Field label={t("pollForm.question")} htmlFor="question" error={fieldError(error, "question")}>
        <Textarea
          id="question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          required
          minLength={5}
          maxLength={300}
          rows={2}
          placeholder={t("pollForm.questionPlaceholder")}
          dir="auto"
          className="min-h-0 font-serif text-2xl font-bold leading-tight sm:text-3xl"
        />
      </Field>

      <Field label={t("pollForm.standfirst")} htmlFor="description" error={fieldError(error, "description")} hint={t("pollForm.standfirstHint")}>
        <Textarea id="description" value={description ?? ""} onChange={(e) => setDescription(e.target.value)} maxLength={1000} dir="auto" className="font-serif text-lg italic" />
      </Field>

      <fieldset>
        <legend className="kicker mb-3 flex w-full items-center justify-between text-umber">
          <span>{t("pollForm.answers")}</span>
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
                placeholder={t("pollForm.answer", { n: i + 1 })}
                aria-label={t("pollForm.answer", { n: i + 1 })}
                dir="auto"
                className="h-10 flex-1 border-b border-transparent bg-transparent font-serif text-lg text-ink placeholder:text-umber/50 focus:border-ink focus:outline-none"
              />
              <div className="flex shrink-0 text-umber">
                <button type="button" className="grid h-8 w-8 place-items-center hover:text-ink disabled:opacity-25" disabled={i === 0} onClick={() => moveOption(i, -1)} aria-label={t("pollForm.moveUp", { n: i + 1 })}>↑</button>
                <button type="button" className="grid h-8 w-8 place-items-center hover:text-ink disabled:opacity-25" disabled={i === options.length - 1} onClick={() => moveOption(i, 1)} aria-label={t("pollForm.moveDown", { n: i + 1 })}>↓</button>
                <button type="button" className="grid h-8 w-8 place-items-center hover:text-ink disabled:opacity-25" disabled={options.length <= 2} onClick={() => removeOption(i)} aria-label={t("pollForm.removeAnswer", { n: i + 1 })}>×</button>
              </div>
            </li>
          ))}
        </ol>
        {fieldError(error, "options") && <p className="mt-2 font-serif text-[13px] italic text-ink">{fieldError(error, "options")}</p>}
        {options.length < 10 && (
          <button type="button" className="kicker mt-3 text-umber underline decoration-rule underline-offset-4 hover:text-ink" onClick={() => setOptions((o) => [...o, ""])}>
            {t("pollForm.addAnswer")}
          </button>
        )}
      </fieldset>

      <fieldset className="border-t border-rule pt-8">
        <legend className="kicker mb-2 text-umber">{t("pollForm.method")}</legend>
        <div className="grid gap-2 md:grid-cols-3">
          {methodChoices.map((c) => (
            <Choice
              key={c.value}
              name="method"
              checked={method === c.value}
              onChange={() => setMethod(c.value)}
              title={t(`pollForm.${c.key}Title`)}
              text={t(`pollForm.${c.key}Text`)}
            />
          ))}
        </div>
        {method === "MULTIPLE" && (
          <div className="mt-4 max-w-xs">
            <Field label={t("pollForm.maxChoices")} htmlFor="maxChoices" error={fieldError(error, "maxChoices")}>
              <Select id="maxChoices" value={maxChoices} onChange={(e) => setMaxChoices(Number(e.target.value))} className="font-mono">
                {Array.from({ length: Math.max(1, options.length - 1) }, (_, i) => i + 2).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </fieldset>

      <div className="grid gap-8 border-t border-rule pt-8 md:grid-cols-2">
        <div className="space-y-5">
          <label className="flex cursor-pointer items-start gap-3 text-sm text-ink">
            <input type="checkbox" checked={scheduled} onChange={(e) => setScheduled(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--foreground)]" />
            <span>
              <span className="block font-semibold">{t("pollForm.schedule")}</span>
              <span className="block text-xs text-umber">{t("pollForm.scheduleHint")}</span>
            </span>
          </label>
          {scheduled && (
            <Field label={t("pollForm.opening")} htmlFor="startsAt" error={fieldError(error, "startsAt")}>
              <Input id="startsAt" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required dir="ltr" className="font-mono" />
            </Field>
          )}
          <Field label={t("pollForm.closing")} htmlFor="endTime" error={fieldError(error, "endTime")}>
            <Input id="endTime" type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} required dir="ltr" className="font-mono" />
          </Field>
        </div>
        <fieldset>
          <legend className="kicker mb-2 text-umber">{t("pollForm.resultsPublication")}</legend>
          <div className="grid gap-2">
            {visibilityChoices.map((c) => (
              <Choice
                key={c.value}
                name="visibility"
                checked={visibility === c.value}
                onChange={() => setVisibility(c.value)}
                title={t(`pollForm.${c.key}Title`)}
                text={t(`pollForm.${c.key}Text`)}
              />
            ))}
          </div>
        </fieldset>
      </div>

      <div className="grid gap-8 border-t border-rule pt-8 md:grid-cols-2">
        <fieldset>
          <legend className="kicker mb-2 text-umber">{t("pollForm.access")}</legend>
          <div className="grid gap-2">
            {accessChoices.map((c) => (
              <Choice
                key={c.value}
                name="access"
                checked={access === c.value}
                onChange={() => setAccess(c.value)}
                title={t(`pollForm.${c.key}Title`)}
                text={t(`pollForm.${c.key}Text`)}
              />
            ))}
          </div>
        </fieldset>
        <div className="space-y-6">
          {access === "PRIVATE" && <VotersPicker voters={voters} onChange={setVoters} error={fieldError(error, "voters")} />}
          {access === "GROUP" && <GroupPicker value={groupId} onChange={setGroupId} error={fieldError(error, "groupId")} />}
          {access !== "PUBLIC" && (
            <Field label={t("pollForm.reminder")} htmlFor="reminder" hint={t("pollForm.reminderHint")} error={fieldError(error, "remindBeforeMinutes")}>
              <Select id="reminder" value={reminder ?? ""} onChange={(e) => setReminder(e.target.value ? Number(e.target.value) : null)}>
                <option value="">{t("pollForm.noReminder")}</option>
                {reminderChoices.map((m) => (
                  <option key={m} value={m}>{t(`pollForm.remind${m}`)}</option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </div>

      {error && !error.details && <Alert>{errorText(error)}</Alert>}
      {error?.details && !["question", "options", "endTime", "voters", "groupId", "maxChoices", "startsAt", "remindBeforeMinutes"].some((f) => error.fieldError(f)) && <Alert>{errorText(error)}</Alert>}

      <div className="flex flex-wrap items-center gap-3 border-t border-ink pt-6">
        <Button type="button" loading={pending === "publish"} disabled={pending !== null} onClick={() => submit(true)}>
          {labels.publish}
        </Button>
        <Button type="submit" variant="secondary" loading={pending === "draft"} disabled={pending !== null}>
          {labels.draft}
        </Button>
        <span className="text-xs text-umber">{scheduled ? t("pollForm.scheduledPublish") : t("pollForm.lockedAfterPublish")}</span>
      </div>
    </form>
  );
}
