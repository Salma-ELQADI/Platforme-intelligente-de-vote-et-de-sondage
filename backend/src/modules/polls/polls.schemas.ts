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
}).refine((d) => d.access !== 'GROUP' || !!d.groupId, { path: ['groupId'], message: 'Choisissez le groupe concerné' });

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
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'Aucune modification fournie' });

export const listPollsQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'CLOSED']).default('ACTIVE'),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const myPollsQuerySchema = z.object({
  status: z.enum(['DRAFT', 'ACTIVE', 'CLOSED']).optional(),
});

export type CreatePollInput = z.infer<typeof createPollSchema>;
export type UpdatePollInput = z.infer<typeof updatePollSchema>;
export type ListPollsQuery = z.infer<typeof listPollsQuerySchema>;
