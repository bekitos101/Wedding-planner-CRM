import { AfterViewChecked, Directive, ElementRef, inject } from '@angular/core';

/**
 * Applied automatically to every `.field` wrapper. Links the visible `.field-error` message to its
 * input: gives the message an id and sets aria-invalid / aria-describedby while an error is shown.
 */
@Directive({ selector: '.field' })
export class FieldDirective implements AfterViewChecked {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  ngAfterViewChecked(): void {
    const control = this.el.querySelector<HTMLElement>('input:not([type=hidden]), textarea, select');
    if (!control) return;
    const error = this.el.querySelector<HTMLElement>('.field-error');
    if (error && control.id) {
      const id = `${control.id}-error`;
      if (error.id !== id) error.id = id;
      if (control.getAttribute('aria-invalid') !== 'true') control.setAttribute('aria-invalid', 'true');
      if (control.getAttribute('aria-describedby') !== id) control.setAttribute('aria-describedby', id);
    } else {
      if (control.hasAttribute('aria-invalid')) control.removeAttribute('aria-invalid');
      if (control.hasAttribute('aria-describedby')) control.removeAttribute('aria-describedby');
    }
  }
}
