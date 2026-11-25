import cookieParser from 'cookie-parser';
import express,{ type Express } from 'express';
import pino, { type Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { logger as defaultLogger } from './lib/logger.js';
import { maskUrl } from './lib/maskUrl.js';
import { apiRouter } from './routes/index.js';
import { apiNotFound, errorHandler } from './middleware/errorHandler.js';

export function createApp(logger: Logger = defaultLogger): Express {
  const app = express();
  app.disable('x-powered-by');
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
  app.use('/api', apiRouter);
  app.use('/api', apiNotFound);
  app.use(errorHandler);
  return app;
}
