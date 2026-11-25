import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { WeddingContext } from './wedding-context.service';
import { WeddingOverviewPage } from './wedding-overview.page';
import { ownerGuard } from './wedding.guards';
import { httpTestProviders, makeWedding } from './testing';
import { TeamPage } from './team.page';

describe('wedding area', () => {
  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'weddings/:weddingId/team', canActivate: [ownerGuard], component: TeamPage },
          { path: 'weddings/:weddingId', component: WeddingOverviewPage },
        ]),
        ...httpTestProviders(),
      ],
    });
    return TestBed.inject(HttpTestingController);
  }

  it('team page guard redirects TEAM_MEMBER to the overview', async () => {
    const ctrl = configure();
    const router = TestBed.inject(Router);
    const nav = router.navigateByUrl('/weddings/w1/team');
    await Promise.resolve();
    await new Promise((r) => setTimeout(r));
    ctrl.expectOne('/api/weddings/w1').flush(makeWedding({ role: 'TEAM_MEMBER' }));
    await nav;
    expect(router.url).toBe('/weddings/w1');
  });

  it('team page guard lets the owner in', async () => {
    const ctrl = configure();
    const router = TestBed.inject(Router);
    const nav = router.navigateByUrl('/weddings/w1/team');
    await new Promise((r) => setTimeout(r));
    ctrl.expectOne('/api/weddings/w1').flush(makeWedding());
    await nav;
    expect(router.url).toBe('/weddings/w1/team');
  });

  describe('overview owner actions', () => {
    function render(w: ReturnType<typeof makeWedding>) {
      TestBed.configureTestingModule({
        imports: [WeddingOverviewPage],
        providers: [provideRouter([]), ...httpTestProviders()],
      });
      TestBed.inject(WeddingContext).set(w);
      const fixture = TestBed.createComponent(WeddingOverviewPage);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    it('shows Edit and Archive to the owner', () => {
      const text = render(makeWedding()).textContent!;
      expect(text).toContain('Edit');
      expect(text).toContain('Archive');
      expect(text).toContain('€25,000.00');
    });

    it('hides Edit and Archive from a team member', () => {
      const el = render(makeWedding({ role: 'TEAM_MEMBER' }));
      expect(el.textContent).not.toContain('Edit');
      expect(el.querySelector('.btn-danger')).toBeNull();
    });

    it('hides actions and shows the read-only banner for archived weddings', () => {
      const el = render(makeWedding({ status: 'ARCHIVED' }));
      expect(el.textContent).toContain('Archived — read-only');
      expect(el.querySelector('.btn-danger')).toBeNull();
    });
  });

  it('a late response for wedding A does not overwrite wedding B', () => {
    const ctrl = configure();
    const ctx = TestBed.inject(WeddingContext);
    ctx.load('A').subscribe();
    ctx.load('B').subscribe();
    ctrl.expectOne('/api/weddings/B').flush(makeWedding({ id: 'B', coupleNames: 'Bea & Bob' }));
    ctrl.expectOne('/api/weddings/A').flush(makeWedding({ id: 'A', coupleNames: 'Amy & Al' }));
    expect(ctx.wedding()?.id).toBe('B');
    expect(ctx.state()).toBe('ready');
  });

  it('a late 404 for wedding A does not hide wedding B', () => {
    const ctrl = configure();
    const ctx = TestBed.inject(WeddingContext);
    ctx.load('A').subscribe();
    ctx.load('B').subscribe();
    ctrl.expectOne('/api/weddings/B').flush(makeWedding({ id: 'B' }));
    ctrl.expectOne('/api/weddings/A').flush(
      { error: { code: 'NOT_FOUND', message: 'Wedding not found.' } },
      { status: 404, statusText: 'Not Found' },
    );
    expect(ctx.wedding()?.id).toBe('B');
    expect(ctx.state()).toBe('ready');
  });

  it('context marks a 404 as not found', () => {
    const ctrl = configure();
    const ctx = TestBed.inject(WeddingContext);
    ctx.load('nope').subscribe();
    ctrl.expectOne('/api/weddings/nope').flush(
      { error: { code: 'NOT_FOUND', message: 'Wedding not found.' } },
      { status: 404, statusText: 'Not Found' },
    );
    expect(ctx.state()).toBe('notfound');
  });
});
