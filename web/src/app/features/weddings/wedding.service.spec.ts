import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MoneyPipe } from '../../core/pipes/money.pipe';
import { MemberService } from './member.service';
import { WeddingService } from './wedding.service';
import { httpTestProviders } from './testing';

describe('WeddingService', () => {
  let ctrl: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: httpTestProviders() });
    ctrl = TestBed.inject(HttpTestingController);
  });

  it('list passes the status param', () => {
    TestBed.inject(WeddingService).list('archived').subscribe();
    const req = ctrl.expectOne((r) => r.url === '/api/weddings');
    expect(req.request.params.get('status')).toBe('archived');
    req.flush([]);
  });

  it('archive posts to the archive endpoint', () => {
    TestBed.inject(WeddingService).archive('w1').subscribe();
    expect(ctrl.expectOne('/api/weddings/w1/archive').request.method).toBe('POST');
  });

  it('members: add posts the email, revoke deletes by userId', () => {
    const svc = TestBed.inject(MemberService);
    svc.add('w1', 'a@b.com').subscribe();
    expect(ctrl.expectOne('/api/weddings/w1/members').request.body).toEqual({ email: 'a@b.com' });
    svc.revoke('w1', 'u9').subscribe();
    expect(ctrl.expectOne('/api/weddings/w1/members/u9').request.method).toBe('DELETE');
  });
});

describe('MoneyPipe', () => {
  it('formats EUR in en-GB style', () => {
    expect(new MoneyPipe().transform('25000.00')).toBe('€25,000.00');
  });
});
