import { Component, ElementRef, HostListener, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationStart, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { NotificationService } from '../services/notification.service';
import { AppNotification } from '../models/notification';
import { NotificationItemComponent } from '../ui/notification-item.component';
import { safeAppLink } from '../services/safe-link';
import { RingsIconComponent } from '../ui/logo.component';

@Component({
  selector: 'app-site-header',
  imports: [RouterLink, RouterLinkActive, RingsIconComponent, NotificationItemComponent],
  template: `
    <header class="sticky top-0 z-30 border-b border-line bg-ivory/85 backdrop-blur">
      <div class="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
        <a routerLink="/" class="flex items-center gap-2 no-underline" aria-label="Wedding Organizer home">
          <app-rings-icon />
          <span class="font-serif text-lg font-semibold text-ink">Wedding Organizer</span>
        </a>

        <nav class="ml-6 hidden items-center gap-1 md:flex" aria-label="Site">
          @if (!auth.isLoggedIn()) {
            <a class="nav-link" routerLink="/" fragment="features">Features</a>
            <a class="nav-link" routerLink="/" fragment="how-it-works">How it works</a>
          }
          <a class="nav-link" routerLink="/contact" routerLinkActive="active">Contact</a>
        </nav>

        @if (auth.isLoggedIn()) {
          <div class="relative ml-auto">
            <button #bellBtn type="button" class="relative inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-line bg-white"
              aria-controls="notif-panel" [attr.aria-expanded]="bellOpen()" [attr.aria-label]="bellLabel()" (click)="toggleBell()">
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9z" /><path d="M10 19a2 2 0 0 0 4 0" />
              </svg>
              @if (store.unreadCount() > 0) {
                <span class="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-rose-700 px-1 text-xs font-semibold leading-5 text-white" data-testid="notif-badge" aria-hidden="true">{{ badge() }}</span>
              }
            </button>
            <span class="sr-only" role="status" aria-live="polite">{{ liveText() }}</span>
            <div id="notif-panel" [hidden]="!bellOpen()"
              class="fixed inset-x-4 top-full z-40 mt-2 rounded-xl border border-line bg-white shadow-lift md:absolute md:inset-x-auto md:right-0 md:w-96">
              <div class="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
                <h2 class="mb-0 text-base">Notifications</h2>
                <button type="button" class="btn btn-secondary btn-sm" [disabled]="store.unreadCount() === 0" (click)="markAll()">Mark all as read</button>
              </div>
              <div class="max-h-96 overflow-y-auto">
                @if (store.loading() && store.items().length === 0) {
                  <p class="m-0 px-3 py-4 text-sm text-muted">Loading notifications...</p>
                } @else if (store.error(); as msg) {
                  <div class="px-3 py-4">
                    <p class="alert alert-danger" role="alert">{{ msg }}</p>
                    <button type="button" class="btn btn-secondary btn-sm" (click)="store.loadList(false)">Try again</button>
                  </div>
                } @else if (store.items().length === 0) {
                  <p class="m-0 px-3 py-6 text-center text-sm text-muted">You're all caught up.</p>
                } @else {
                  <ul class="m-0 list-none divide-y divide-line p-0">
                    @for (n of store.items(); track n.id) {
                      <li><app-notification-item [item]="n" (open)="openItem($event)" /></li>
                    }
                  </ul>
                }
                @if (store.actionError(); as msg) {
                  <p class="alert alert-danger m-3" role="alert">{{ msg }}</p>
                }
              </div>
              <div class="border-t border-line px-3 py-2 text-center">
                <a class="text-sm font-medium" routerLink="/notifications">View all</a>
              </div>
            </div>
          </div>
        }

        <div class="hidden items-center gap-2 md:flex" [class.ml-auto]="!auth.isLoggedIn()">
          @if (auth.currentUser(); as user) {
            <a class="btn btn-secondary btn-sm" routerLink="/weddings">My weddings</a>
            <div class="relative">
              <button #userBtn type="button" class="nav-link inline-flex cursor-pointer items-center gap-1"
                aria-controls="user-menu" [attr.aria-expanded]="userMenu()" (click)="toggleUser()">
                {{ user.name }}
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <ul id="user-menu" [hidden]="!userMenu()" class="absolute right-0 mt-2 w-44 list-none rounded-xl border border-line bg-white p-1 shadow-lift">
                <li><a class="block rounded-lg px-3 py-2 text-sm text-ink no-underline hover:bg-rose-50" routerLink="/notifications">Notifications</a></li>
                <li><a class="block rounded-lg px-3 py-2 text-sm text-ink no-underline hover:bg-rose-50" routerLink="/profile">Profile</a></li>
                <li><button type="button" class="block w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-rose-50" (click)="logout()">Log out</button></li>
              </ul>
            </div>
          } @else {
            <a class="nav-link" routerLink="/login">Log in</a>
            <a class="btn btn-primary btn-sm" routerLink="/register">Get started</a>
          }
        </div>

        <button #menuBtn type="button" class="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-line bg-white md:hidden"
          [class.ml-auto]="!auth.isLoggedIn()"
          aria-controls="mobile-menu" [attr.aria-expanded]="menuOpen()" aria-label="Menu" (click)="toggleMobile()">
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            @if (menuOpen()) {
              <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            } @else {
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            }
          </svg>
        </button>
      </div>

      <div id="mobile-menu" [hidden]="!menuOpen()" class="border-t border-line bg-ivory px-4 pb-4 pt-2 md:hidden">
          <nav class="flex flex-col gap-1" aria-label="Site mobile">
            @if (!auth.isLoggedIn()) {
              <a class="nav-link" routerLink="/" fragment="features">Features</a>
              <a class="nav-link" routerLink="/" fragment="how-it-works">How it works</a>
            }
            <a class="nav-link" routerLink="/contact" routerLinkActive="active">Contact</a>
            @if (auth.currentUser(); as user) {
              <a class="nav-link" routerLink="/weddings">My weddings</a>
              <a class="nav-link" routerLink="/notifications">Notifications</a>
              <a class="nav-link" routerLink="/profile">Profile ({{ user.name }})</a>
              <button type="button" class="nav-link cursor-pointer text-left" (click)="logout()">Log out</button>
            } @else {
              <a class="nav-link" routerLink="/login">Log in</a>
              <a class="btn btn-primary mt-2" routerLink="/register">Get started</a>
            }
          </nav>
      </div>
    </header>
  `,
})
export class SiteHeaderComponent {
  protected readonly auth = inject(AuthService);
  protected readonly store = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly menuOpen = signal(false);
  readonly userMenu = signal(false);
  readonly bellOpen = signal(false);
  private readonly userBtn = viewChild<ElementRef<HTMLElement>>('userBtn');
  private readonly menuBtn = viewChild<ElementRef<HTMLElement>>('menuBtn');
  private readonly bellBtn = viewChild<ElementRef<HTMLElement>>('bellBtn');

  readonly badge = computed(() => (this.store.unreadCount() > 9 ? '9+' : String(this.store.unreadCount())));
  readonly bellLabel = computed(() => {
    const n = this.store.unreadCount();
    return n > 0 ? `Notifications, ${n} unread` : 'Notifications';
  });
  readonly liveText = computed(() => {
    const n = this.store.unreadCount();
    return n > 0 ? `${n} unread ${n === 1 ? 'notification' : 'notifications'}` : 'No unread notifications';
  });

  constructor() {
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationStart),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.closeMenus());
  }

  toggleUser(): void {
    const open = !this.userMenu();
    this.closeMenus();
    this.userMenu.set(open);
  }

  toggleMobile(): void {
    const open = !this.menuOpen();
    this.closeMenus();
    this.menuOpen.set(open);
  }

  toggleBell(): void {
    const open = !this.bellOpen();
    this.closeMenus();
    this.bellOpen.set(open);
    if (open) this.store.loadList(false);
  }

  markAll(): void {
    this.store.markAllRead().subscribe();
  }

  openItem(n: AppNotification): void {
    this.store.markRead(n.id).subscribe(() => {
      this.closeMenus();
      void this.router.navigateByUrl(safeAppLink(n.link));
    });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: Event): void {
    if ((this.userMenu() || this.bellOpen()) && !this.host.nativeElement.contains(e.target as Node)) {
      this.userMenu.set(false);
      this.bellOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.userMenu()) {
      this.userMenu.set(false);
      this.userBtn()?.nativeElement.focus();
    }
    if (this.bellOpen()) {
      this.bellOpen.set(false);
      this.bellBtn()?.nativeElement.focus();
    }
    if (this.menuOpen()) {
      this.menuOpen.set(false);
      this.menuBtn()?.nativeElement.focus();
    }
  }

  private closeMenus(): void {
    this.menuOpen.set(false);
    this.userMenu.set(false);
    this.bellOpen.set(false);
  }

  logout(): void {
    this.closeMenus();
    this.auth.logout().subscribe(() => void this.router.navigateByUrl('/login'));
  }
}
