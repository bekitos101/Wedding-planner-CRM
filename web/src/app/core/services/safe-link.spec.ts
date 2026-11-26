import { safeAppLink } from './safe-link';

describe('safeAppLink', () => {
  it('keeps in-app paths', () => {
    expect(safeAppLink('/weddings/1/tasks')).toBe('/weddings/1/tasks');
  });

  it.each(['//evil.com', '/\\evil.com', 'https://x', ''])('rejects %j', (link) => {
    expect(safeAppLink(link)).toBe('/notifications');
  });
});
