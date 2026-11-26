import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { maskUrl } from '../lib/maskUrl.js';

export const apiNotFound: RequestHandler = (req, _res, next) => {
  next(notFound(`No such endpoint: ${req.method} ${req.originalUrl.split('?')[0]}`));
};

type PrismaLike = { name: string; code?: string; meta?: { target?: unknown }; stack?: string };

const isPrismaError = (err: unknown): err is PrismaLike =>
  !!err && typeof err === 'object' && typeof (err as PrismaLike).name === 'string' && (err as PrismaLike).name.startsWith('PrismaClient');

/** Only the "at ..." frames of a stack: its first lines repeat the error message (query arguments, secrets). */
export function frameLines(stack: string | undefined): string {
  return (stack ?? '')
    .split(/\r?\n/)
    .filter((l) => /^\s+at /.test(l))
    .join(String.fromCharCode(10));
}

function send(res: Parameters<ErrorRequestHandler>[2], status: number, code: string, message: string, fields?: Record<string, string>) {
  res.status(status).json({ error: { code, message, ...(fields ? { fields } : {}) } });
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '_';
      if (!(key in fields)) fields[key] = issue.message;
    }
    const first = Object.entries(fields)[0];
    const message = first
      ? `Please check your input: ${first[0] === '_' ? '' : first[0] + ' - '}${first[1]}.`
      : 'Please check your input.';
    return send(res, 400, 'VALIDATION_ERROR', message, fields);
  }
  if (err instanceof AppError) {
    return send(res, err.status, err.code, err.message, err.fields);
  }

  if (isPrismaError(err) && err.name === 'PrismaClientKnownRequestError') {
    if (err.code === 'P2002') {
      return send(res, 409, 'CONFLICT', 'This record already exists.');
    }
    if (err.code === 'P2025') {
      return send(res, 404, 'NOT_FOUND', 'The requested resource was not found.');
    }
  }

  // http-errors raised by body-parser etc. (only those safe to expose)
  const e = err as { type?: string; status?: number; expose?: boolean } | null;
  if (e && typeof e === 'object' && typeof e.status === 'number' && e.status >= 400 && e.status < 500 && e.expose === true) {
    if (e.type === 'entity.parse.failed') {
      return send(res, 400, 'VALIDATION_ERROR', 'The request body is not valid JSON.');
    }
    if (e.status === 413) {
      return send(res, 413, 'PAYLOAD_TOO_LARGE', 'The submitted data is too large.');
    }
    return send(res, e.status, 'BAD_REQUEST', 'The request could not be processed. Please check it and try again.');
  }

  // Prisma messages embed query arguments (possibly secrets): log only safe fields.
  // A Prisma stack starts with the full message (argument values), so keep only the frame lines.
  const safeErr = isPrismaError(err)
    ? { name: err.name, code: err.code, stack: frameLines(err.stack) }
    : err;
  logger.error({ err: safeErr, method: req.method, url: maskUrl(req.url) }, 'Unhandled error');
  send(res, 500, 'INTERNAL_ERROR', 'Something went wrong on our side. Please try again later.');
};
