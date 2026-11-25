import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SiteFooterComponent } from './site-footer.component';
import { SiteHeaderComponent } from './site-header.component';

/** Header + footer around the public pages (landing, contact, login, register, not found). */
@Component({
  selector: 'app-public-layout',
  imports: [RouterOutlet, SiteHeaderComponent, SiteFooterComponent],
  template: `
    <app-site-header />
    <main id="main" tabindex="-1" class="flex-1 outline-none"><router-outlet /></main>
    <app-site-footer />
  `,
  host: { class: 'flex min-h-screen flex-col' },
})
export class PublicLayoutComponent {}
