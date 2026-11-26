import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AppNotification } from '../../core/models/notification';
import { NotificationService } from '../../core/services/notification.service';
import { NotificationItemComponent } from '../../core/ui/notification-item.component';
import { safeAppLink } from '../../core/services/safe-link';

@Component({
  selector: 'app-notifications-page',
  imports: [NotificationItemComponent],
  template: `
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <h1 class="mb-0 mr-auto">Notifications</h1>
      <button type="button" class="btn btn-secondary" [disabled]="store.unreadCount() === 0" (click)="markAll()">
        Mark all as read
      </button>
    </div>

    <div class="mb-5 flex gap-1 border-b border-line" role="group" aria-label="Show notifications">
      <button type="button" class="-mb-px cursor-pointer border-b-2 px-4 py-2 text-sm font-medium"
        [class]="!unreadOnly() ? 'border-rose-700 text-rose-800' : 'border-transparent text-muted hover:text-ink'"
        [attr.aria-pressed]="!unreadOnly()" (click)="select(false)">All</button>
      <button type="button" class="-mb-px cursor-pointer border-b-2 px-4 py-2 text-sm font-medium"
        [class]="unreadOnly() ? 'border-rose-700 text-rose-800' : 'border-transparent text-muted hover:text-ink'"
        [attr.aria-pressed]="unreadOnly()" (click)="select(true)">Unread</button>
    </div>

    @if (store.actionError(); as msg) {
      <p class="alert alert-danger" role="alert">{{ msg }}</p>
    }

    @if (store.loading()) {
      <p class="text-muted">Loading notifications...</p>
    } @else if (store.error(); as msg) {
      <p class="alert alert-danger" role="alert">{{ msg }}</p>
      <button type="button" class="btn btn-secondary" (click)="load()">Try again</button>
    } @else if (visibleItems().length === 0) {
      <section class="card py-10 text-center">
        <p class="mb-0 text-muted">
          @if (unreadOnly()) { You have no unread notifications. } @else { You're all caught up. }
        </p>
      </section>
    } @else {
      <ul class="card list-none divide-y divide-line p-0">
        @for (n of visibleItems(); track n.id) {
          <li>
            <app-notification-item [item]="n" [showMarkRead]="true" (open)="open($event)" (markRead)="store.markRead($event.id)" />
          </li>
        }
      </ul>
    }
  `,
})
export class NotificationsPage {
  protected readonly store = inject(NotificationService);
  private readonly router = inject(Router);

  readonly unreadOnly = signal(false);
  readonly visibleItems = computed(() =>
    this.unreadOnly() ? this.store.items().filter((n) => !n.readAt) : this.store.items(),
  );

  constructor() {
    this.load();
  }

  select(unreadOnly: boolean): void {
    if (unreadOnly === this.unreadOnly()) return;
    this.unreadOnly.set(unreadOnly);
    this.load();
  }

  load(): void {
    this.store.loadList(this.unreadOnly());
  }

  markAll(): void {
    this.store.markAllRead().subscribe();
  }

  open(n: AppNotification): void {
    this.store.markRead(n.id).subscribe(() => void this.router.navigateByUrl(safeAppLink(n.link)));
  }
}
