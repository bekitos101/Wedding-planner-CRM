import type { RequestHandler } from 'express';
import { forbidden } from '../lib/errors.js';

/**
 * Baseline response headers for a JSON API (NFR-07). No new dependency: these are static.
 * HSTS is only sent in production, where the API is served over HTTPS.
 */
export function securityHeaders(opts: { production: boolean }): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (opts.production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defence in depth (the auth cookie is also SameSite): state-changing requests are rejected
 * when the browser says they are cross-site (Sec-Fetch-Site) or when an Origin header is present
 * and is neither the configured frontend origin (APP_BASE_URL) nor the origin the request was
 * addressed to (Host header; covers direct calls to :3000 and the dev proxy, which keeps Host and
 * Origin as the browser sent them). Requests without Origin (curl, supertest, server-to-server)
 * are not browser CSRF vectors and pass.
 */
export function csrfGuard(appBaseUrl: string): RequestHandler {
  const allowedOrigin = new URL(appBaseUrl).origin;
  return (req, _res, next) => {
    if (!STATE_CHANGING.has(req.method)) return next();
    if (req.headers['sec-fetch-site'] === 'cross-site') return next(forbidden('Cross-site request blocked.'));
    const origin = req.headers.origin;
    if (typeof origin === 'string' && origin !== allowedOrigin) {
      let sameHost = false;
      try {
        sameHost = new URL(origin).host === req.headers.host;
      } catch {
        /* malformed or "null" origin: not allowed */
      }
      if (!sameHost) return next(forbidden('Cross-site request blocked.'));
    }
    next();
  };
}
