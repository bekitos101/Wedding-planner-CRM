import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Wedding } from '../../core/models/wedding';
import { apiErrorInterceptor } from '../../core/http/api-error.interceptor';

export function makeWedding(over: Partial<Wedding> = {}): Wedding {
  return {
    id: 'w1',
    coupleNames: 'Anna & Ben',
    weddingDate: '2027-06-12',
    location: 'Budapest',
    totalBudget: '25000.00',
    rsvpDeadline: '2027-05-01',
    status: 'ACTIVE',
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    owner: { id: 'u1', name: 'Olivia Owner' },
    role: 'OWNER',
    progress: { completed: 3, total: 12, percent: 25 },
    ...over,
  };
}

export const httpTestProviders = () => [
  provideHttpClient(withInterceptors([apiErrorInterceptor])),
  provideHttpClientTesting(),
];
