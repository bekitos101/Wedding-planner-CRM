import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SiteFooterComponent } from '../core/layout/site-footer.component';
import { SiteHeaderComponent } from '../core/layout/site-header.component';

/** Planner app shell: shared header, side navigation, footer. */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, SiteHeaderComponent, SiteFooterComponent],
  template: `
    <app-site-header />
    <div class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6 md:flex-row md:gap-8">
      <nav class="flex shrink-0 gap-1 md:w-44 md:flex-col" aria-label="Main">
        <a routerLink="/weddings" routerLinkActive="active" class="nav-link">Weddings</a>
        <a routerLink="/profile" routerLinkActive="active" class="nav-link">Profile</a>
      </nav>
      <main id="main" tabindex="-1" class="min-w-0 flex-1 outline-none"><router-outlet /></main>
    </div>
    <app-site-footer />
  `,
  host: { class: 'flex min-h-screen flex-col' },
})
export class ShellComponent {}
