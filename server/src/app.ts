import { env } from './config/env.js';
import cookieParser from 'cookie-parser';
import express,{ type Express } from 'express';
import pino, { type Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { logger as defaultLogger } from './lib/logger.js';
import { maskUrl } from './lib/maskUrl.js';
import { createRateLimiter } from './lib/rateLimit.js';
import { createContactRouter } from './routes/contact.js';
import { apiRouter } from './routes/index.js';
import { apiNotFound, errorHandler } from './middleware/errorHandler.js';

export interface AppOptions {
  /** Reverse-proxy hops to trust for req.ip (default: env.TRUST_PROXY). */
  trustProxy?: number;
}

export function createApp(logger: Logger = defaultLogger, options: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  const trustProxy = options.trustProxy ?? env.TRUST_PROXY;
  if (trustProxy > 0) app.set('trust proxy', trustProxy); // hop count, never true
  app.use(
    pinoHttp({
      logger,
      serializers: {
        // Invitation tokens live in the URL path (NFR-06).
        req: (req) => {
          const s = pino.stdSerializers.req(req);
          s.url = maskUrl(s.url) as string;
          return s;
        },
      },
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  // Per-app limiter instance: 5 contact messages per IP per 15 minutes.
  const contactLimiter = createRateLimiter({ max: 5, windowMs: 15 * 60 * 1000, message: 'Too many messages. Please try again later.' });
  app.use('/api', createContactRouter(contactLimiter));
  app.use('/api', apiRouter);
  app.use('/api', apiNotFound);
  app.use(errorHandler);
  return app;
}
