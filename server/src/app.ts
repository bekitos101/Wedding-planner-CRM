import { env } from './config/env.js';
import cookieParser from 'cookie-parser';
import express,{ type Express } from 'express';
import pino, { type Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { logger as defaultLogger } from './lib/logger.js';
import { maskUrl } from './lib/maskUrl.js';
import { createRateLimiter } from './lib/rateLimit.js';
import { createAuthRouter } from './routes/auth.js';
import { createAuthLimiters, type AuthLimitOverrides } from './routes/authLimits.js';
import { createContactRouter } from './routes/contact.js';
import { createMeRouter } from './routes/me.js';
import { apiRouter } from './routes/index.js';
import { apiNotFound, errorHandler } from './middleware/errorHandler.js';
import { csrfGuard, securityHeaders } from './middleware/security.js';

export interface AppOptions {
  /** Reverse-proxy hops to trust for req.ip (default: env.TRUST_PROXY). */
  trustProxy?: number;
  /** Override the login/register/password-change rate limits (tests). */
  authLimits?: AuthLimitOverrides;
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
  app.use(securityHeaders({ production: env.NODE_ENV === 'production' }));
  app.use('/api', csrfGuard(env.APP_BASE_URL));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  // Per-app limiter instance: 5 contact messages per IP per 15 minutes.
  const contactLimiter = createRateLimiter({ max: 5, windowMs: 15 * 60 * 1000, message: 'Too many messages. Please try again later.' });
  app.use('/api', createContactRouter(contactLimiter));
  // Per-app login/register/password-change limiters (brute-force protection, NFR-01/02).
  const authLimiters = createAuthLimiters(options.authLimits);
  app.use('/api', createAuthRouter(authLimiters));
  app.use('/api', createMeRouter(authLimiters.passwordChange));
  app.use('/api', apiRouter);
  app.use('/api', apiNotFound);
  app.use(errorHandler);
  return app;
}
