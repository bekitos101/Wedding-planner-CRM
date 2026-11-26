import type { RouteSpec } from './types.js';

/** Phase 4 dashboard and reports: read-only routes under /weddings/:weddingId. */
export const DASHBOARD_ROUTES: RouteSpec[] = [
  { name: 'dashboard', method: 'get', pattern: '/weddings/:weddingId/dashboard', path: (c) => `/api/weddings/${c.weddingId}/dashboard`, access: 'member', write: false },
  { name: 'guest report', method: 'get', pattern: '/weddings/:weddingId/reports/guests', path: (c) => `/api/weddings/${c.weddingId}/reports/guests`, access: 'member', write: false },
  { name: 'budget report', method: 'get', pattern: '/weddings/:weddingId/reports/budget', path: (c) => `/api/weddings/${c.weddingId}/reports/budget`, access: 'member', write: false },
];
