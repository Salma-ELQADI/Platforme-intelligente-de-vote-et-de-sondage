import { z } from 'zod';

/** What the user sends to POST /api/ai/generate. */
export const generatePollSchema = z.object({
  topic: z
    .string({ error: 'Le thème est obligatoire' })
    .trim()
    .min(3, 'Le thème doit contenir au moins 3 caractères')
    .max(200, 'Le thème ne peut pas dépasser 200 caractères'),
  optionCount: z.coerce.number().int().min(2, 'Au moins 2 propositions').max(8, 'Au plus 8 propositions').default(4),
  instructions: z.string().trim().max(500, 'Les instructions ne peuvent pas dépasser 500 caractères').optional(),
  language: z.enum(['fr', 'en']).default('fr'),
  /** Sent on "Regenerate" so the model proposes something different. */
  previousQuestion: z.string().trim().max(300).optional(),
});

export type GeneratePollInput = z.infer<typeof generatePollSchema>;

/**
 * What we REQUIRE from the model. The AI output is untrusted input:
 * it is parsed and validated exactly like data coming from a user.
 */
export const aiPollOutputSchema = z.object({
  question: z.string().trim().min(5).max(300),
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(10),
});

export type AiPollOutput = z.infer<typeof aiPollOutputSchema>;

/** JSON Schema sent to OpenRouter (structured outputs) – mirrors aiPollOutputSchema. */
export const AI_POLL_JSON_SCHEMA = {
  name: 'poll',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'A clear, neutral poll question' },
      options: { type: 'array', items: { type: 'string' }, description: 'Distinct answer options' },
    },
    required: ['question', 'options'],
    additionalProperties: false,
  },
} as const;
