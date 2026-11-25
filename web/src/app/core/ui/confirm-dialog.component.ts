import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, input, output, viewChild } from '@angular/core';

let nextId = 0;

/**
 * Accessible confirm dialog: role="dialog", focus moves to Cancel on open, Tab stays inside,
 * Esc cancels, and focus returns to the opener on close.
 */
@Component({
  selector: 'app-confirm-dialog',
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4" (click)="onBackdrop($event)">
      <div #dialog class="card w-full max-w-md shadow-lift" role="dialog" aria-modal="true"
        [attr.aria-labelledby]="titleId" [attr.aria-describedby]="descId">
        <h2 [id]="titleId">{{ title() }}</h2>
        <p [id]="descId" class="mb-5 text-muted">{{ message() }}</p>
        <div class="flex justify-end gap-2">
          <button #cancel type="button" class="btn btn-secondary" (click)="cancelled.emit()">Cancel</button>
          <button type="button" class="btn btn-danger" [disabled]="busy()" (click)="confirmed.emit()">
            {{ busy() ? 'Working...' : confirmLabel() }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class ConfirmDialogComponent implements AfterViewInit, OnDestroy {
  readonly title = input.required<string>();
  readonly message = input.required<string>();
  readonly confirmLabel = input('Confirm');
  readonly busy = input(false);
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  protected readonly titleId = `dlg-title-${nextId}`;
  protected readonly descId = `dlg-desc-${nextId++}`;

  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');
  private readonly cancelBtn = viewChild.required<ElementRef<HTMLButtonElement>>('cancel');
  private opener: HTMLElement | null = null;

  ngAfterViewInit(): void {
    this.opener = document.activeElement as HTMLElement | null;
    this.cancelBtn().nativeElement.focus();
  }

  ngOnDestroy(): void {
    this.opener?.focus?.();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!this.busy()) this.cancelled.emit();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = Array.from(this.dialog().nativeElement.querySelectorAll<HTMLElement>('button:not([disabled])'));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (!this.dialog().nativeElement.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }

  protected onBackdrop(e: MouseEvent): void {
    if (e.target === e.currentTarget && !this.busy()) this.cancelled.emit();
  }
}
