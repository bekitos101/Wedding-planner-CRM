import { Component, input } from '@angular/core';

/** Two interlocked rings. Decorative: the text next to it carries the name. */
@Component({
  selector: 'app-rings-icon',
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="12" cy="18" r="8" stroke="#8f2a47" stroke-width="2.2" />
      <circle cx="21" cy="18" r="8" stroke="#7a9378" stroke-width="2.2" />
      <path d="M16.5 5.5l1.6 2.6-1.6 2.2-1.6-2.2z" fill="#c94f73" />
    </svg>
  `,
  host: { class: 'inline-flex' },
})
export class RingsIconComponent {
  readonly size = input(28);
}
