import { NextFunction, Request, Response } from 'express';
import { logger } from '../config/logger';
import { AppError, isPgError, PG_ERRORS } from '../utils/errors';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: { code: 'ROUTE_NOT_FOUND', message: `Route ${req.method} ${req.path} introuvable` },
  });
}

/**
 * Centralised error handler (Express 5 forwards rejected promises here
 * automatically). Known errors are mapped to a status code; anything else
 * is logged with its stack trace and returned as a generic 500 so that no
 * internal detail (SQL, stack, file paths) leaks to the client.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, path: req.path }, err.message);
    return res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message, ...(err.details !== undefined && { details: err.details }) },
    });
  }

  // Malformed JSON body sent by the client.
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_JSON', message: 'Corps JSON invalide' } });
  }

  if (isPgError(err, PG_ERRORS.INVALID_TEXT_REPRESENTATION)) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Identifiant invalide' } });
  }

  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  const dbDown = typeof err === 'object' && err !== null && ['ECONNREFUSED', '57P01', '53300'].includes((err as { code?: string }).code ?? '');
  return res.status(dbDown ? 503 : 500).json({
    success: false,
    error: dbDown
      ? { code: 'SERVICE_UNAVAILABLE', message: 'Service momentanément indisponible, réessayez plus tard' }
      : { code: 'INTERNAL_ERROR', message: 'Erreur interne du serveur' },
  });
}
