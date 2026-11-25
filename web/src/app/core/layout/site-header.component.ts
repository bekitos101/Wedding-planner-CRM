import { Component, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationStart, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { RingsIconComponent } from '../ui/logo.component';

@Component({
  selector: 'app-site-header',
  imports: [RouterLink, RouterLinkActive, RingsIconComponent],
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

        <div class="ml-auto hidden items-center gap-2 md:flex">
          @if (auth.currentUser(); as user) {
            <a class="btn btn-secondary btn-sm" routerLink="/weddings">My weddings</a>
            <div class="relative">
              <button #userBtn type="button" class="nav-link inline-flex cursor-pointer items-center gap-1"
                aria-controls="user-menu" [attr.aria-expanded]="userMenu()" (click)="userMenu.set(!userMenu())">
                {{ user.name }}
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <ul id="user-menu" [hidden]="!userMenu()" class="absolute right-0 mt-2 w-44 list-none rounded-xl border border-line bg-white p-1 shadow-lift">
                <li><a class="block rounded-lg px-3 py-2 text-sm text-ink no-underline hover:bg-rose-50" routerLink="/profile">Profile</a></li>
                <li><button type="button" class="block w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-rose-50" (click)="logout()">Log out</button></li>
              </ul>
            </div>
          } @else {
            <a class="nav-link" routerLink="/login">Log in</a>
            <a class="btn btn-primary btn-sm" routerLink="/register">Get started</a>
          }
        </div>

        <button #menuBtn type="button" class="ml-auto inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-line bg-white md:hidden"
          aria-controls="mobile-menu" [attr.aria-expanded]="menuOpen()" aria-label="Menu" (click)="menuOpen.set(!menuOpen())">
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
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly menuOpen = signal(false);
  readonly userMenu = signal(false);
  private readonly userBtn = viewChild<ElementRef<HTMLElement>>('userBtn');
  private readonly menuBtn = viewChild<ElementRef<HTMLElement>>('menuBtn');

  constructor() {
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationStart),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.closeMenus());
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: Event): void {
    if (this.userMenu() && !this.host.nativeElement.contains(e.target as Node)) this.userMenu.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.userMenu()) {
      this.userMenu.set(false);
      this.userBtn()?.nativeElement.focus();
    }
    if (this.menuOpen()) {
      this.menuOpen.set(false);
      this.menuBtn()?.nativeElement.focus();
    }
  }

  private closeMenus(): void {
    this.menuOpen.set(false);
    this.userMenu.set(false);
  }

  logout(): void {
    this.closeMenus();
    this.auth.logout().subscribe(() => void this.router.navigateByUrl('/login'));
  }
}
