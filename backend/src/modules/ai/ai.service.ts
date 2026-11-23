import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../../utils/errors';
import { buildMessages } from './ai.prompt';
import { AI_POLL_JSON_SCHEMA, aiPollOutputSchema, type AiPollOutput, type GeneratePollInput } from './ai.schemas';

const MAX_ATTEMPTS = 2; // 1 retry when the model returns unusable content

export interface GeneratedPoll extends AiPollOutput {
  model: string;
}

/** Errors exposed to the client: explicit but without internal details (no key, no raw provider body). */
const aiError = {
  notConfigured: () => new AppError(503, 'AI_NOT_CONFIGURED', "La génération par IA n'est pas configurée sur ce serveur"),
  timeout: () => new AppError(504, 'AI_TIMEOUT', "Le service d'IA met trop de temps à répondre, réessayez"),
  unavailable: () => new AppError(503, 'AI_UNAVAILABLE', "Le service d'IA est momentanément indisponible, réessayez plus tard"),
  rateLimited: () => new AppError(429, 'AI_RATE_LIMITED', "Trop de demandes envoyées au service d'IA, patientez quelques instants"),
  credits: () => new AppError(503, 'AI_INSUFFICIENT_CREDITS', "Le service d'IA est indisponible (crédits insuffisants)"),
  model: () => new AppError(503, 'AI_MODEL_UNAVAILABLE', "Le modèle d'IA configuré est indisponible"),
  invalid: () => new AppError(502, 'AI_INVALID_RESPONSE', "L'IA a renvoyé une réponse inexploitable, veuillez régénérer"),
};

/** Maps an OpenRouter HTTP error status to an application error. */
function mapProviderStatus(status: number, providerMessage: string): AppError {
  logger.warn({ status, providerMessage }, 'OpenRouter returned an error');
  if (status === 401 || status === 403) return aiError.unavailable(); // invalid key: logged, never shown
  if (status === 402) return aiError.credits();
  if (status === 429) return aiError.rateLimited();
  if (status === 404 || (status === 400 && /model/i.test(providerMessage))) return aiError.model();
  if (status === 408) return aiError.timeout();
  return aiError.unavailable();
}

/**
 * Extracts a JSON object from the model's text. Even with structured outputs
 * some models wrap the JSON in ```json fences or add a sentence around it.
 */
export function extractJson(content: string): unknown {
  const cleaned = content.replace(/```(?:json)?/gi, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('No JSON object found');
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

/**
 * Validates and normalises the model output. Returns null if it cannot be used.
 * Duplicates are removed (case-insensitive); the requested number of options must remain.
 */
export function sanitizeOutput(raw: unknown, optionCount: number): AiPollOutput | null {
  const parsed = aiPollOutputSchema.safeParse(raw);
  if (!parsed.success) return null;

  const clean = (s: string) => s.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/^\s*(\d+[.)]|[-*•])\s*/, '').replace(/\s+/g, ' ').trim();
  const seen = new Set<string>();
  const options: string[] = [];
  for (const opt of parsed.data.options.map(clean)) {
    if (opt && !seen.has(opt.toLowerCase())) {
      seen.add(opt.toLowerCase());
      options.push(opt);
    }
  }
  if (options.length < optionCount) return null;
  return { question: clean(parsed.data.question), options: options.slice(0, optionCount) };
}

/** One HTTP call to OpenRouter, with timeout. Returns the assistant's text content. */
async function callOpenRouter(input: GeneratePollInput): Promise<{ content: string; model: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.OPENROUTER_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        // Optional attribution headers recommended by OpenRouter.
        'HTTP-Referer': env.clientOrigins[0] ?? 'http://localhost:3000',
        'X-Title': 'VoteLive',
      },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL,
        messages: buildMessages(input),
        temperature: 0.7,
        max_tokens: 600,
        response_format: { type: 'json_schema', json_schema: AI_POLL_JSON_SCHEMA },
      }),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw aiError.timeout();
    logger.error({ err }, 'OpenRouter network error');
    throw aiError.unavailable();
  } finally {
    clearTimeout(timer);
  }

  const body = (await response.json().catch(() => null)) as
    | { model?: string; error?: { code?: number; message?: string }; choices?: { message?: { content?: string } }[] }
    | null;

  if (!response.ok) throw mapProviderStatus(response.status, body?.error?.message ?? '');
  // OpenRouter can also report provider errors inside a 200 response.
  if (body?.error) throw mapProviderStatus(Number(body.error.code) || 502, body.error.message ?? '');

  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw aiError.invalid();
  return { content, model: body?.model ?? env.OPENROUTER_MODEL };
}

/**
 * Generates a poll proposal. NOTHING is saved here: the proposal is returned
 * to the user, who reviews/edits it and then saves it through POST /api/polls.
 */
export async function generatePoll(input: GeneratePollInput): Promise<GeneratedPoll> {
  if (!env.OPENROUTER_API_KEY) throw aiError.notConfigured();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { content, model } = await callOpenRouter(input);
    let raw: unknown;
    try {
      raw = extractJson(content);
    } catch {
      logger.warn({ attempt }, 'AI returned malformed JSON');
      continue;
    }
    const poll = sanitizeOutput(raw, input.optionCount);
    if (poll) return { ...poll, model };
    logger.warn({ attempt }, 'AI output failed schema validation');
  }
  throw aiError.invalid();
}
