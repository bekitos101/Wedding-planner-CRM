import type { RouteSpec } from './types.js';

const GUEST = '00000000-0000-4000-8000-0000000000a1';
const guestBody = { name: 'Some Guest', email: 'some.guest@test.local' };

/** Track 3A guests, invitations: every route this track mounts under /weddings/:weddingId. */
export const GUEST_ROUTES: RouteSpec[] = [
  { name: 'GET guests', method: 'get', pattern: '/weddings/:weddingId/guests', path: (c) => `/api/weddings/${c.weddingId}/guests`, access: 'member', write: false },
  { name: 'POST guest', method: 'post', pattern: '/weddings/:weddingId/guests', path: (c) => `/api/weddings/${c.weddingId}/guests`, body: guestBody, access: 'owner', write: true },
  { name: 'PATCH guest', method: 'patch', pattern: '/weddings/:weddingId/guests/:guestId', path: (c) => `/api/weddings/${c.weddingId}/guests/${GUEST}`, body: { name: 'New Name' }, access: 'owner', write: true },
  { name: 'DELETE guest', method: 'delete', pattern: '/weddings/:weddingId/guests/:guestId', path: (c) => `/api/weddings/${c.weddingId}/guests/${GUEST}`, access: 'owner', write: true },
  { name: 'POST invitation send', method: 'post', pattern: '/weddings/:weddingId/guests/:guestId/invitation/send', path: (c) => `/api/weddings/${c.weddingId}/guests/${GUEST}/invitation/send`, access: 'owner', write: true },
  { name: 'POST invitation revoke', method: 'post', pattern: '/weddings/:weddingId/guests/:guestId/invitation/revoke', path: (c) => `/api/weddings/${c.weddingId}/guests/${GUEST}/invitation/revoke`, access: 'owner', write: true },
];
