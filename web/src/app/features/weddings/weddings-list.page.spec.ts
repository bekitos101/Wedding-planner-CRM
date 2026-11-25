import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { WeddingsListPage } from './weddings-list.page';
import { httpTestProviders, makeWedding } from './testing';

describe('WeddingsListPage', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [WeddingsListPage],
      providers: [provideRouter([]), ...httpTestProviders()],
    });
    const ctrl = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(WeddingsListPage);
    fixture.detectChanges();
    ctrl.expectOne('/api/health').flush({ status: 'ok', db: 'ok' });
    return { fixture, ctrl, el: fixture.nativeElement as HTMLElement };
  }

  const listReq = (ctrl: HttpTestingController) => ctrl.expectOne((r) => r.url === '/api/weddings');

  it('renders role badge and progress for each wedding', () => {
    const { fixture, ctrl, el } = setup();
    listReq(ctrl).flush([
      makeWedding(),
      makeWedding({ id: 'w2', coupleNames: 'Cleo & Dan', role: 'TEAM_MEMBER' }),
    ]);
    fixture.detectChanges();
    const text = el.textContent!;
    expect(text).toContain('Anna & Ben');
    expect(text).toContain('Owner');
    expect(text).toContain('Team member');
    expect(text).toContain('3 of 12 tasks done');
    expect(el.querySelectorAll('.card').length).toBe(2);
  });

  it('shows an empty state with a call to action', () => {
    const { fixture, ctrl, el } = setup();
    listReq(ctrl).flush([]);
    fixture.detectChanges();
    expect(el.textContent).toContain('Create your first wedding');
  });

  it('shows the server message when loading fails', () => {
    const { fixture, ctrl, el } = setup();
    listReq(ctrl).flush(
      { error: { code: 'INTERNAL_ERROR', message: 'Something broke.' } },
      { status: 500, statusText: 'Server Error' },
    );
    fixture.detectChanges();
    expect(el.querySelector('.alert-danger')?.textContent).toContain('Something broke.');
  });

  it('requests archived weddings when the Archived tab is selected', () => {
    const { fixture, ctrl } = setup();
    listReq(ctrl).flush([]);
    fixture.componentInstance.select('archived');
    expect(listReq(ctrl).request.params.get('status')).toBe('archived');
  });
});
