import { z } from 'zod';

const MIN_DURATION_MS = 60_000; // at least 1 minute in the future
const MAX_DURATION_MS = 365 * 24 * 3600 * 1000; // at most 1 year

const question = z
  .string({ error: 'La question est obligatoire' })
  .trim()
  .min(5, 'La question doit contenir au moins 5 caractères')
  .max(300, 'La question ne peut pas dépasser 300 caractères');

const description = z.string().trim().max(1000, 'La description ne peut pas dépasser 1000 caractères').nullish();

const options = z
  .array(
    z.string().trim().min(1, 'Une proposition ne peut pas être vide').max(200, 'Une proposition ne peut pas dépasser 200 caractères'),
    { error: 'Les propositions sont obligatoires' },
  )
  .min(2, 'Un sondage doit contenir au moins 2 propositions')
  .max(10, 'Un sondage ne peut pas contenir plus de 10 propositions')
  .refine((opts) => new Set(opts.map((o) => o.toLowerCase())).size === opts.length, {
    message: 'Les propositions doivent être différentes',
  });

/** Exported because the same rule is re-checked at publish time. */
export function isValidEndTime(date: Date, now = Date.now()) {
  const delta = date.getTime() - now;
  return delta >= MIN_DURATION_MS && delta <= MAX_DURATION_MS;
}

const endTime = z.coerce
  .date({ error: 'La date de clôture est invalide' })
  .refine((d) => isValidEndTime(d), {
    message: "La date de clôture doit être comprise entre 1 minute et 1 an à partir de maintenant",
  });

const access = z.enum(['PUBLIC', 'PRIVATE', 'GROUP']);

const votingMethod = z.enum(['SINGLE', 'MULTIPLE', 'RANKED']);
const maxChoices = z.coerce.number().int().min(2, 'Au moins 2 choix').max(10, 'Au plus 10 choix').nullable();

/** Scheduled opening: from 1 minute to 1 year from now. */
const startsAt = z.coerce
  .date({ error: "La date d'ouverture est invalide" })
  .refine((d) => isValidEndTime(d), { message: "L'ouverture doit être comprise entre 1 minute et 1 an à partir de maintenant" })
  .nullable();

/** Reminder lead time, in minutes (5 min to 7 days). */
const remindBeforeMinutes = z.coerce.number().int().min(5).max(10080).nullable();

/** Rules that involve several fields; also re-checked by the service on the stored poll. */
export function crossFieldIssues(d: {
  options?: string[]; votingMethod?: string; maxChoices?: number | null; startsAt?: Date | null; endTime?: Date;
  access?: string; remindBeforeMinutes?: number | null;
}): { path: string; message: string; code: string }[] {
  const issues: { path: string; message: string; code: string }[] = [];
  if (d.votingMethod === 'MULTIPLE' && !d.maxChoices) {
    issues.push({ path: 'maxChoices', code: 'MAX_CHOICES_REQUIRED', message: 'Indiquez le nombre maximal de choix' });
  }
  if (d.votingMethod === 'MULTIPLE' && d.maxChoices && d.options && d.maxChoices > d.options.length) {
    issues.push({ path: 'maxChoices', code: 'MAX_CHOICES_TOO_MANY', message: 'Le nombre de choix ne peut pas dépasser le nombre de propositions' });
  }
  if (d.startsAt && d.endTime && d.endTime.getTime() - d.startsAt.getTime() < 60_000) {
    issues.push({ path: 'endTime', code: 'END_BEFORE_START', message: "La clôture doit suivre l'ouverture d'au moins 1 minute" });
  }
  if (d.remindBeforeMinutes && d.access === 'PUBLIC') {
    issues.push({ path: 'remindBeforeMinutes', code: 'REMINDER_PUBLIC', message: 'Les rappels sont réservés aux sondages privés et de groupe' });
  }
  return issues;
}

/** Group conversation of a GROUP poll (the author must be one of its members). */
const groupId = z.uuid({ message: 'Groupe invalide' }).nullable();

/** Invited voters of a private poll, given by username or email (resolved by the service). */
const voters = z
  .array(z.string().trim().min(1, 'Un votant ne peut pas être vide').max(255), { error: 'La liste des votants est invalide' })
  .max(500, 'Un sondage privé ne peut pas avoir plus de 500 votants')
  .transform((list) => [...new Set(list)]);

export const createPollSchema = z.object({
  question,
  description,
  options,
  endTime,
  resultsVisibility: z.enum(['LIVE', 'AFTER_CLOSE']).default('LIVE'),
  creationMode: z.enum(['MANUAL', 'AI']).default('MANUAL'),
  access: access.default('PUBLIC'),
  voters: voters.default([]),
  groupId: groupId.optional(),
  votingMethod: votingMethod.default('SINGLE'),
  maxChoices: maxChoices.optional(),
  startsAt: startsAt.optional(),
  remindBeforeMinutes: remindBeforeMinutes.optional(),
}).refine((d) => d.access !== 'GROUP' || !!d.groupId, { path: ['groupId'], message: 'Choisissez le groupe concerné' })
  .superRefine((d, ctx) => {
    for (const i of crossFieldIssues(d)) ctx.addIssue({ code: 'custom', path: [i.path], message: i.message, params: { code: i.code } });
  });

export const updatePollSchema = z
  .object({
    question: question.optional(),
    description,
    options: options.optional(),
    endTime: endTime.optional(),
    resultsVisibility: z.enum(['LIVE', 'AFTER_CLOSE']).optional(),
    access: access.optional(),
    voters: voters.optional(),
    groupId: groupId.optional(),
    votingMethod: votingMethod.optional(),
    maxChoices: maxChoices.optional(),
    startsAt: startsAt.optional(),
    remindBeforeMinutes: remindBeforeMinutes.optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'Aucune modification fournie' });

export const listPollsQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'CLOSED']).default('ACTIVE'),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const myPollsQuerySchema = z.object({
  status: z.enum(['DRAFT', 'SCHEDULED', 'ACTIVE', 'CLOSED']).optional(),
});

export type CreatePollInput = z.infer<typeof createPollSchema>;
export type UpdatePollInput = z.infer<typeof updatePollSchema>;
export type ListPollsQuery = z.infer<typeof listPollsQuerySchema>;
