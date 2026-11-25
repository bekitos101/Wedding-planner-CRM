import { createRequire } from 'node:module';
import pino, { type LoggerOptions, type DestinationStream } from 'pino';
import { env } from '../config/env.js';

const sensitive = ['password', 'currentPassword', 'passwordHash', 'token', 'tokenHash', 'authorization', 'cookie', 'jwt'];

export const redactPaths = [
  ...sensitive.flatMap((k) => [k, `*.${k}`, `*.*.${k}`, `*.*.*.${k}`]),
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  '*.headers.authorization',
  '*.headers.cookie',
  '*.headers["set-cookie"]',
];

function canResolve(id: string): boolean {
  try {
    createRequire(import.meta.url).resolve(id);
    return true;
  } catch {
    return false;
  }
}

export function buildLogger(destination?: DestinationStream, overrides: LoggerOptions = {}) {
  const options: LoggerOptions = {
    level: env.LOG_LEVEL,
    redact: { paths: redactPaths, censor: '[Redacted]' },
    ...overrides,
  };
  if (!destination && env.NODE_ENV === 'development' && canResolve('pino-pretty')) {
    options.transport = { target: 'pino-pretty', options: { colorize: true } };
  }
  return destination ? pino(options, destination) : pino(options);
}

export const logger = buildLogger();
