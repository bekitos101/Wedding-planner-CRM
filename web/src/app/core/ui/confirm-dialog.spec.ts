import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfirmDialogComponent } from './confirm-dialog.component';

@Component({
  imports: [ConfirmDialogComponent],
  template: `
    <button id="opener" type="button" (click)="open.set(true)">Open</button>
    @if (open()) {
      <app-confirm-dialog title="Sure?" message="Really?" [busy]="busy()" (confirmed)="confirmed = confirmed + 1"
        (cancelled)="cancelled = cancelled + 1; open.set(false)" />
    }
  `,
})
class HostComponent {
  open = signal(false);
  busy = signal(false);
  confirmed = 0;
  cancelled = 0;
}

describe('ConfirmDialogComponent', () => {
  function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    const opener = fixture.nativeElement.querySelector('#opener') as HTMLButtonElement;
    opener.focus();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    return { fixture, opener };
  }

  const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

  it('is a labelled dialog and focuses Cancel initially', () => {
    const { fixture } = setup();
    const el = fixture.nativeElement as HTMLElement;
    const dialog = el.querySelector('[role=dialog]')!;
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
    fixture.nativeElement.remove();
  });

  it('Esc emits cancelled and focus returns to the opener', () => {
    const { fixture, opener } = setup();
    esc();
    fixture.detectChanges();
    expect(fixture.componentInstance.cancelled).toBe(1);
    expect(fixture.nativeElement.querySelector('[role=dialog]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    fixture.nativeElement.remove();
  });

  it('Esc and backdrop clicks do nothing while busy', () => {
    const { fixture } = setup();
    fixture.componentInstance.busy.set(true);
    fixture.detectChanges();
    esc();
    (fixture.nativeElement.querySelector('.fixed') as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.cancelled).toBe(0);
    fixture.nativeElement.remove();
  });
});
