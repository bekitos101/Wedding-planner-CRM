import type { RouteSpec } from './types.js';

const RANDOM_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const W = '/weddings/:weddingId';

/** Track 3D suppliers, schedule: every route this track mounts under /weddings/:weddingId. */
export const PLANNING_ROUTES: RouteSpec[] = [
  { name: 'list suppliers', method: 'get', pattern: `${W}/suppliers`, path: (c) => `/api/weddings/${c.weddingId}/suppliers`, access: 'member', write: false },
  {
    name: 'create supplier',
    method: 'post',
    pattern: `${W}/suppliers`,
    path: (c) => `/api/weddings/${c.weddingId}/suppliers`,
    body: { name: 'Florist', category: 'Flowers' },
    access: 'owner',
    write: true,
  },
  {
    name: 'update supplier',
    method: 'patch',
    pattern: `${W}/suppliers/:supplierId`,
    path: (c) => `/api/weddings/${c.weddingId}/suppliers/${RANDOM_ID}`,
    body: { name: 'Renamed' },
    access: 'owner',
    write: true,
  },
  {
    name: 'delete supplier',
    method: 'delete',
    pattern: `${W}/suppliers/:supplierId`,
    path: (c) => `/api/weddings/${c.weddingId}/suppliers/${RANDOM_ID}`,
    access: 'owner',
    write: true,
  },
  { name: 'list schedule', method: 'get', pattern: `${W}/schedule`, path: (c) => `/api/weddings/${c.weddingId}/schedule`, access: 'member', write: false },
  {
    name: 'create schedule item',
    method: 'post',
    pattern: `${W}/schedule`,
    path: (c) => `/api/weddings/${c.weddingId}/schedule`,
    body: { title: 'Ceremony', startTime: '2027-06-19T14:00:00Z', endTime: '2027-06-19T15:00:00Z' },
    access: 'owner',
    write: true,
  },
  {
    name: 'update schedule item',
    method: 'patch',
    pattern: `${W}/schedule/:itemId`,
    path: (c) => `/api/weddings/${c.weddingId}/schedule/${RANDOM_ID}`,
    body: { title: 'Renamed' },
    access: 'owner',
    write: true,
  },
  {
    name: 'delete schedule item',
    method: 'delete',
    pattern: `${W}/schedule/:itemId`,
    path: (c) => `/api/weddings/${c.weddingId}/schedule/${RANDOM_ID}`,
    access: 'owner',
    write: true,
  },
];
