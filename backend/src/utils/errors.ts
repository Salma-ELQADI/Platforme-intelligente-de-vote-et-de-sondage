/**
 * Business errors thrown anywhere in the code base. The central error
 * middleware converts them into a consistent JSON response:
 *   { "success": false, "error": { "code": "...", "message": "...", "details"?: ... } }
 * `message` is always safe to show to the end user.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'VALIDATION_ERROR', message, details);
export const unauthorized = (message = 'Authentification requise') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = "Vous n'avez pas les droits nécessaires") =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Ressource introuvable') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);

/** PostgreSQL error codes we react to (https://www.postgresql.org/docs/current/errcodes-appendix.html). */
export const PG_ERRORS = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  INVALID_TEXT_REPRESENTATION: '22P02',
} as const;

export function isPgError(err: unknown, code: string): err is { code: string; constraint?: string } {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === code;
}
