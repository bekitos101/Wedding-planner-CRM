import { Component, computed, input } from '@angular/core';

export interface BarSegment {
  label: string;
  value: number;
  /** Bar width weight when it differs from the value (e.g. overspend). */
  width?: number;
  /** Text shown in the legend and aria-label (e.g. "12" or "€1,200.00"). */
  display: string;
  /** Tailwind background class from the theme. */
  color: string;
}

/** Simple CSS stacked bar with a visible legend of numbers and an aria-label (never colour alone). */
@Component({
  selector: 'app-stacked-bar',
  template: `
    <div class="mb-1 text-sm font-medium">{{ title() }}</div>
    <div class="flex h-3 w-full overflow-hidden rounded-full bg-stone-100" role="img" [attr.aria-label]="ariaLabel()" data-testid="chart">
      @for (s of segments(); track s.label) {
        @if (w(s) > 0) {
          <span [class]="s.color" [style.width.%]="percent(s)"></span>
        }
      }
    </div>
    <ul class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted" data-testid="legend">
      @for (s of segments(); track s.label) {
        <li class="flex items-center gap-1.5"><span class="inline-block size-2.5 rounded-full" [class]="s.color" aria-hidden="true"></span>{{ s.label }}: <strong class="text-ink">{{ s.display }}</strong></li>
      }
    </ul>
  `,
})
export class StackedBarComponent {
  readonly title = input.required<string>();
  readonly segments = input.required<BarSegment[]>();
  private readonly sum = computed(() => this.segments().reduce((n, s) => n + Math.max(0, s.width ?? s.value), 0));
  protected readonly ariaLabel = computed(
    () => `${this.title()}: ` + this.segments().map((s) => `${s.label} ${s.display}`).join(', '),
  );
  protected percent(s: BarSegment): number {
    return this.sum() > 0 ? (Math.max(0, s.width ?? s.value) / this.sum()) * 100 : 0;
  }
  protected w(s: BarSegment): number {
    return s.width ?? s.value;
  }
}
