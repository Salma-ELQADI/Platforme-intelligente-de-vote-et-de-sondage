import { NextFunction, Request, Response } from 'express';
import { z, ZodType } from 'zod';
import { badRequest } from '../utils/errors';

type Schemas = { body?: ZodType; query?: ZodType; params?: ZodType };

/**
 * Converts zod issues into a flat, front-end friendly list. A custom rule may
 * attach a stable `code` (params.code) that clients translate precisely; the
 * French `message` stays as the readable default.
 */
export function formatIssues(error: z.ZodError) {
  return error.issues.map((i) => {
    const code = i.code === 'custom' ? (i.params as { code?: string } | undefined)?.code : undefined;
    return { field: i.path.join('.'), message: i.message, ...(code && { code }) };
  });
}

/**
 * Validates (and normalises) the request before it reaches the controller.
 * The parsed values replace the raw ones, so controllers only ever see
 * trimmed, typed and checked data. Unknown body fields are stripped.
 */
export const validate = (schemas: Schemas) => (req: Request, _res: Response, next: NextFunction) => {
  for (const key of ['params', 'query', 'body'] as const) {
    const schema = schemas[key];
    if (!schema) continue;
    const result = schema.safeParse(req[key]);
    if (!result.success) {
      throw badRequest('Les données envoyées sont invalides', formatIssues(result.error));
    }
    if (key === 'query') {
      // req.query is a read-only getter in Express 5.
      Object.defineProperty(req, 'query', { value: result.data, writable: true });
    } else {
      req[key] = result.data;
    }
  }
  next();
};

export const uuidParam = (name = 'id') =>
  z.object({ [name]: z.uuid({ message: 'Identifiant invalide' }) });
