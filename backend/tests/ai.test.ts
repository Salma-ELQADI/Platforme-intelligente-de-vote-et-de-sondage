import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env';
import { extractJson, sanitizeOutput } from '../src/modules/ai/ai.service';
import { app, closeDb, createUser, resetDb, type TestUser } from './helpers';

let user: TestUser;
beforeAll(async () => {
  await resetDb();
  user = await createUser();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(closeDb);

/** Fake OpenRouter response returning `content` as the assistant message. */
const openRouterReply = (content: string, status = 200) =>
  new Response(JSON.stringify({ model: 'test/model', choices: [{ message: { content } }] }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const openRouterError = (status: number, message = 'error') =>
  new Response(JSON.stringify({ error: { code: status, message } }), { status, headers: { 'content-type': 'application/json' } });

const generate = (body: object = { topic: 'Langages de programmation', optionCount: 3 }) =>
  request(app).post('/api/ai/generate').set(user.auth).send(body);

describe('AI poll generation (OpenRouter mocked)', () => {
  it('returns a validated proposal and sends the key only server-side', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      openRouterReply(JSON.stringify({ question: 'Quel langage préférez-vous ?', options: ['Python', 'JavaScript', 'Go'] })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await generate().expect(200);
    expect(res.body.data.poll).toEqual({ question: 'Quel langage préférez-vous ?', options: ['Python', 'JavaScript', 'Go'], model: 'test/model' });
    expect(JSON.stringify(res.body)).not.toContain('test-key');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe('test/model');
    expect(sent.response_format.type).toBe('json_schema');
    expect(sent.messages[1].content).toContain('Langages de programmation');
  });

  it('accepts JSON wrapped in markdown fences and trims extra options', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(openRouterReply('```json\n{"question":"Votre saison préférée ?","options":["1. Été","Hiver","Printemps","Automne"]}\n```')),
    );
    const res = await generate({ topic: 'Saisons', optionCount: 3 }).expect(200);
    expect(res.body.data.poll.options).toEqual(['Été', 'Hiver', 'Printemps']);
  });

  it('retries once when the first answer is malformed JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(openRouterReply('Sure! Here is a poll: question = ...'))
      .mockResolvedValueOnce(openRouterReply('{"question":"Quel sport pratiquez-vous ?","options":["Football","Tennis","Natation"]}'));
    vi.stubGlobal('fetch', fetchMock);
    await generate().expect(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns 502 AI_INVALID_RESPONSE when the output never matches the schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => openRouterReply('{"question":"Q?","options":"not-an-array"}')));
    const res = await generate().expect(502);
    expect(res.body.error.code).toBe('AI_INVALID_RESPONSE');
  });

  it('returns 502 when the model returns fewer distinct options than requested', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => openRouterReply('{"question":"Une question ?","options":["Oui","oui","Non"]}')));
    await generate().expect(502);
  });

  it.each([
    [429, 429, 'AI_RATE_LIMITED'],
    [402, 503, 'AI_INSUFFICIENT_CREDITS'],
    [404, 503, 'AI_MODEL_UNAVAILABLE'],
    [401, 503, 'AI_UNAVAILABLE'],
    [500, 503, 'AI_UNAVAILABLE'],
  ])('maps OpenRouter HTTP %i to %i %s', async (providerStatus, expectedStatus, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(openRouterError(providerStatus)));
    const res = await generate().expect(expectedStatus);
    expect(res.body.error.code).toBe(code);
  });

  it('returns 503 when the API is unreachable (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const res = await generate().expect(503);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
  });

  it('aborts and returns 504 when OpenRouter does not answer in time', async () => {
    // Never resolves by itself; rejects only when our AbortController fires (OPENROUTER_TIMEOUT_MS=300 in tests).
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))),
          ),
      ),
    );
    const res = await generate().expect(504);
    expect(res.body.error.code).toBe('AI_TIMEOUT');
  });

  it('returns 503 AI_NOT_CONFIGURED when no API key is set', async () => {
    const original = env.OPENROUTER_API_KEY;
    env.OPENROUTER_API_KEY = '';
    try {
      const res = await generate().expect(503);
      expect(res.body.error.code).toBe('AI_NOT_CONFIGURED');
    } finally {
      env.OPENROUTER_API_KEY = original;
    }
  });

  it('validates the request and requires authentication', async () => {
    await generate({ topic: 'x', optionCount: 20 }).expect(400);
    await request(app).post('/api/ai/generate').send({ topic: 'Sport' }).expect(401);
  });
});

describe('AI output helpers (unit)', () => {
  it('extractJson finds an object inside surrounding text', () => {
    expect(extractJson('Voici : {"question":"Q ?","options":["a","b"]} merci')).toEqual({ question: 'Q ?', options: ['a', 'b'] });
    expect(() => extractJson('no json here')).toThrow();
  });

  it('sanitizeOutput removes numbering, duplicates and control characters', () => {
    expect(sanitizeOutput({ question: ' Quelle  couleur ? ', options: ['1) Rouge', '- Bleu', 'rouge', 'Vert\u0007'] }, 3)).toEqual({
      question: 'Quelle couleur ?',
      options: ['Rouge', 'Bleu', 'Vert'],
    });
    expect(sanitizeOutput({ question: 'Quelle couleur ?', options: ['A'] }, 2)).toBeNull();
  });
});
