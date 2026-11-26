import { Component, input, output } from '@angular/core';
import { AppNotification } from '../models/notification';
import { RelativeTimePipe } from '../pipes/relative-time.pipe';

/** One notification row, shared by the header panel and the /notifications page (NFR-12). */
@Component({
  selector: 'app-notification-item',
  imports: [RelativeTimePipe],
  template: `
    <div class="flex items-start gap-2 px-3 py-2.5" [class.bg-rose-50]="!item().readAt">
      <span class="mt-2 h-2 w-2 shrink-0 rounded-full" [class]="item().readAt ? 'bg-transparent' : 'bg-rose-600'" aria-hidden="true"></span>
      <button type="button" class="min-w-0 flex-1 cursor-pointer text-left" (click)="open.emit(item())">
        <span class="block text-sm text-ink" [class.font-semibold]="!item().readAt" [class.font-medium]="item().readAt">
          {{ item().title }}
          @if (!item().readAt) { <span class="sr-only">(unread)</span> }
        </span>
        <span class="block text-sm text-muted">{{ item().message }}</span>
        <span class="mt-0.5 block text-xs text-muted">
          {{ item().wedding.coupleNames }} &middot; {{ item().createdAt | relativeTime }}
        </span>
      </button>
      @if (showMarkRead() && !item().readAt) {
        <button type="button" class="btn btn-secondary btn-sm shrink-0" (click)="markRead.emit(item())">
          Mark read<span class="sr-only">: {{ item().title }}</span>
        </button>
      }
    </div>
  `,
})
export class NotificationItemComponent {
  readonly item = input.required<AppNotification>();
  readonly showMarkRead = input(false);
  readonly open = output<AppNotification>();
  readonly markRead = output<AppNotification>();
}
