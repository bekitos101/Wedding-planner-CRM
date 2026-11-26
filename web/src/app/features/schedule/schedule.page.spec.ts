import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ScheduleItem } from '../../core/models/schedule';
import { httpTestProviders, makeWedding } from '../weddings/testing';
import { WeddingContext } from '../weddings/wedding-context.service';
import { isoToLocalInput, localInputToIso } from './schedule-time';
import { SchedulePage } from './schedule.page';

const item = (over: Partial<ScheduleItem>): ScheduleItem => ({
  id: 's1', title: 'Ceremony', startTime: '2027-06-12T12:00:00.000Z', endTime: '2027-06-12T13:00:00.000Z',
  location: 'Garden', notes: null, overlapsWith: [], ...over,
});

function setup(items: ScheduleItem[]) {
  TestBed.configureTestingModule({ imports: [SchedulePage], providers: httpTestProviders() });
  TestBed.inject(WeddingContext).set(makeWedding());
  const ctrl = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(SchedulePage);
  fixture.detectChanges();
  ctrl.expectOne('/api/weddings/w1/schedule').flush(items);
  fixture.detectChanges();
  return { fixture, ctrl, el: fixture.nativeElement as HTMLElement };
}

describe('schedule time helpers', () => {
  it('converts a datetime-local value to an ISO string with an explicit zone and back', () => {
    const iso = localInputToIso('2027-06-19T14:00');
    expect(iso).toMatch(/Z$|[+-]\d\d:\d\d$/);
    expect(new Date(iso).getTime()).toBe(new Date('2027-06-19T14:00').getTime());
    expect(isoToLocalInput(iso)).toBe('2027-06-19T14:00');
  });
});

describe('SchedulePage', () => {
  it('AC-10: shows overlapping items with a chip, highlight and the overlapped titles', () => {
    const { el } = setup([
      item({ id: 's1', title: 'Ceremony', overlapsWith: ['s2'] }),
      item({ id: 's2', title: 'Photos', startTime: '2027-06-12T12:30:00.000Z', endTime: '2027-06-12T14:00:00.000Z', overlapsWith: ['s1'] }),
      item({ id: 's3', title: 'Dinner', startTime: '2027-06-12T16:00:00.000Z', endTime: '2027-06-12T18:00:00.000Z' }),
    ]);
    const rows = Array.from(el.querySelectorAll('[data-testid=schedule-item]'));
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toContain('Overlaps');
    expect(rows[0].textContent).toContain('“Photos”');
    expect(rows[0].className).toContain('highlight');
    expect(rows[2].textContent).not.toContain('Overlaps');
  });

  it('AC-10: items are displayed chronologically, grouped by day, in the order the API returns them', () => {
    const { el } = setup([
      item({ id: 'a', title: 'Rehearsal', startTime: '2027-06-11T16:00:00.000Z', endTime: '2027-06-11T17:00:00.000Z' }),
      item({ id: 'b', title: 'Ceremony', startTime: '2027-06-12T12:00:00.000Z', endTime: '2027-06-12T13:00:00.000Z' }),
      item({ id: 'c', title: 'Photos', startTime: '2027-06-12T13:30:00.000Z', endTime: '2027-06-12T14:30:00.000Z' }),
      item({ id: 'd', title: 'Dinner', startTime: '2027-06-12T17:00:00.000Z', endTime: '2027-06-12T19:00:00.000Z' }),
    ]);
    const titles = Array.from(el.querySelectorAll('[data-testid=schedule-item] .font-medium:not(.tabular-nums)')).map((n) => n.textContent?.trim());
    expect(titles).toEqual(['Rehearsal', 'Ceremony', 'Photos', 'Dinner']);
    expect(el.querySelectorAll('section h2').length).toBe(2);
    expect(el.querySelectorAll('[data-testid=schedule-item]')[0].closest('section')?.querySelectorAll('[data-testid=schedule-item]').length).toBe(1);
  });

  it('BR-12: shows returned warnings as a dismissible alert after saving', () => {
    const { fixture, ctrl, el } = setup([item({})]);
    fixture.componentInstance.onSaved({
      item: item({ id: 's2', title: 'Photos' }),
      warnings: [{ type: 'OVERLAP', itemId: 's1', title: 'Ceremony', startTime: '', endTime: '', message: 'Overlaps with "Ceremony".' }],
    });
    ctrl.expectOne('/api/weddings/w1/schedule').flush([item({})]);
    fixture.detectChanges();
    const alert = el.querySelector('[data-testid=warnings]');
    expect(alert?.textContent).toContain('Saved. Overlaps with "Ceremony".');
    (alert!.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid=warnings]')).toBeNull();
  });

  it('form posts ISO times and blocks start >= end on the client', () => {
    const { fixture, ctrl, el } = setup([]);
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Add item') as HTMLButtonElement).click();
    fixture.detectChanges();
    const form = fixture.nativeElement.querySelector('app-schedule-form') as HTMLElement;
    expect(form).not.toBeNull();
    const set = (id: string, v: string) => {
      const input = el.querySelector(id) as HTMLInputElement;
      input.value = v;
      input.dispatchEvent(new Event('input'));
    };
    set('#schTitle', 'Toast');
    set('#schStart', '2027-06-12T18:00');
    set('#schEnd', '2027-06-12T17:00');
    (form.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    ctrl.expectNone('/api/weddings/w1/schedule');
    expect(form.querySelector('.field-error')?.textContent).toContain('End time must be after start time.');

    set('#schEnd', '2027-06-12T19:00');
    (form.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    const req = ctrl.expectOne((r) => r.method === 'POST' && r.url === '/api/weddings/w1/schedule');
    expect(req.request.body.startTime).toBe(new Date('2027-06-12T18:00').toISOString());
    expect(req.request.body.endTime).toBe(new Date('2027-06-12T19:00').toISOString());
  });
});
