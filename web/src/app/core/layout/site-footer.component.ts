import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { RingsIconComponent } from '../ui/logo.component';

@Component({
  selector: 'app-site-footer',
  imports: [RouterLink, RingsIconComponent],
  template: `
    <footer class="mt-auto border-t border-line bg-blush/60">
      <div class="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-4">
        <div>
          <div class="flex items-center gap-2">
            <app-rings-icon [size]="24" />
            <span class="font-serif text-lg font-semibold">Wedding Organizer</span>
          </div>
          <p class="mt-2 max-w-xs text-sm text-muted">Calm, organised planning for professional wedding planners.</p>
        </div>
        @if (!auth.isLoggedIn()) {
          <nav aria-label="Product">
            <h2 class="mb-2 font-sans text-sm font-semibold text-ink">Product</h2>
            <ul class="space-y-1 text-sm">
              <li><a routerLink="/" fragment="features">Features</a></li>
              <li><a routerLink="/" fragment="how-it-works">How it works</a></li>
            </ul>
          </nav>
        }
        <nav aria-label="Company">
          <h2 class="mb-2 font-sans text-sm font-semibold text-ink">Company</h2>
          <ul class="space-y-1 text-sm">
            <li><a routerLink="/contact">Contact</a></li>
          </ul>
        </nav>
        <nav aria-label="Account">
          <h2 class="mb-2 font-sans text-sm font-semibold text-ink">Account</h2>
          <ul class="space-y-1 text-sm">
            @if (auth.isLoggedIn()) {
              <li><a routerLink="/weddings">My weddings</a></li>
            } @else {
              <li><a routerLink="/login">Log in</a></li>
              <li><a routerLink="/register">Sign up</a></li>
            }
          </ul>
        </nav>
      </div>
      <div class="border-t border-line">
        <p class="mx-auto max-w-6xl px-4 py-4 text-sm text-muted sm:px-6">
          &copy; {{ currentYear }} Wedding Organizer. All rights reserved.
        </p>
      </div>
    </footer>
  `,
})
export class SiteFooterComponent {
  protected readonly auth = inject(AuthService);
  protected readonly currentYear = new Date().getFullYear();
}
