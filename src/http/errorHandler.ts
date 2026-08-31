import type { NextFunction, Request, Response } from 'express';

/**
 * Sin esto, un JSON mal formado devuelve un HTML de Express en lugar de un error
 * en el mismo formato que el resto de la API.
 */
export function errorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction
): Response {
  if (isJsonParseError(error)) {
    return response.status(400).json({ error: 'INVALID_JSON' });
  }
  console.error(error);
  return response.status(500).json({ error: 'INTERNAL_ERROR' });
}

function isJsonParseError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as { type?: string }).type === 'entity.parse.failed';
}
