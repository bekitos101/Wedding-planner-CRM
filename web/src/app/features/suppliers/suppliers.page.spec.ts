import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Supplier } from '../../core/models/supplier';
import { httpTestProviders, makeWedding } from '../weddings/testing';
import { WeddingContext } from '../weddings/wedding-context.service';
import { SuppliersPage } from './suppliers.page';

const supplier = (over: Partial<Supplier>): Supplier => ({
  id: 's1', name: 'Bloom & Co', category: 'Flowers', contactInfo: '+36 1 234', quotedPrice: '850.00', notes: null,
  createdAt: '2026-01-01T00:00:00.000Z', ...over,
});

describe('SuppliersPage', () => {
  function setup(list: Supplier[], role: 'OWNER' | 'TEAM_MEMBER' = 'OWNER') {
    TestBed.configureTestingModule({ imports: [SuppliersPage], providers: httpTestProviders() });
    TestBed.inject(WeddingContext).set(makeWedding({ role }));
    const ctrl = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(SuppliersPage);
    fixture.detectChanges();
    ctrl.expectOne((r) => r.url === '/api/weddings/w1/suppliers').flush(list);
    fixture.detectChanges();
    return { fixture, ctrl, el: fixture.nativeElement as HTMLElement };
  }

  it('shows the quoted price, or an em dash when null', () => {
    const { el } = setup([supplier({}), supplier({ id: 's2', name: 'DJ Max', category: 'Music', quotedPrice: null })]);
    const quoted = Array.from(el.querySelectorAll('[data-testid=quoted]')).map((e) => e.textContent?.trim());
    expect(quoted).toEqual(['€850.00', '—']);
  });

  it('sends the category filter', () => {
    const { fixture, ctrl } = setup([supplier({})]);
    fixture.componentInstance.category.set('Flowers');
    fixture.componentInstance.load();
    const req = ctrl.expectOne((r) => r.url === '/api/weddings/w1/suppliers');
    expect(req.request.params.get('category')).toBe('Flowers');
    req.flush([]);
  });

  it('hides write actions for team members', () => {
    const { el } = setup([supplier({})], 'TEAM_MEMBER');
    const labels = Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(labels).not.toContain('Add supplier');
    expect(labels).not.toContain('Edit');
    expect(labels).not.toContain('Delete');
  });
});
