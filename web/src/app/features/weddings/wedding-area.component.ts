import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { RoleBadgeComponent } from '../../core/ui/role-badge.component';
import { WeddingContext } from './wedding-context.service';

/** Wedding shell: loads the wedding once and renders its own side navigation (NFR-09). */
@Component({
  selector: 'app-wedding-area',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, RoleBadgeComponent],
  template: `
    @switch (ctx.state()) {
      @case ('notfound') {
        <section class="card max-w-lg">
          <h1>Wedding not found</h1>
          <p class="mb-4 text-muted">Wedding not found or you no longer have access.</p>
          <a class="btn btn-primary" routerLink="/weddings">Back to my weddings</a>
        </section>
      }
      @case ('error') {
        <p class="alert alert-danger" role="alert">{{ ctx.error() }}</p>
        <button type="button" class="btn btn-secondary" (click)="reload()">Try again</button>
      }
      @case ('ready') {
        @if (ctx.wedding(); as w) {
          <div class="flex flex-col gap-4 lg:flex-row lg:gap-8">
            <nav class="flex shrink-0 flex-wrap gap-1 lg:w-44 lg:flex-col" aria-label="Wedding">
              <div class="flex w-full flex-col items-start gap-1.5 px-3 pb-2">
                <strong>{{ w.coupleNames }}</strong>
                <app-role-badge [role]="w.role" />
              </div>
              <a class="nav-link" [routerLink]="['/weddings', w.id]" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Overview</a>
              <a class="nav-link" [routerLink]="['/weddings', w.id, 'guests']" routerLinkActive="active">Guests</a>
              <a class="nav-link" [routerLink]="['/weddings', w.id, 'tasks']" routerLinkActive="active">Tasks</a>
              <a class="nav-link" [routerLink]="['/weddings', w.id, 'budget']" routerLinkActive="active">Budget</a>
              <a class="nav-link" [routerLink]="['/weddings', w.id, 'suppliers']" routerLinkActive="active">Suppliers</a>
              <a class="nav-link" [routerLink]="['/weddings', w.id, 'schedule']" routerLinkActive="active">Schedule</a>
              <a class="nav-link" [routerLink]="['/weddings', w.id, 'reports']" routerLinkActive="active">Reports</a>
              @if (ctx.isOwner()) {
                <a class="nav-link" [routerLink]="['/weddings', w.id, 'team']" routerLinkActive="active">Team</a>
              }
            </nav>
            <div class="min-w-0 flex-1"><router-outlet /></div>
          </div>
        }
      }
      @default {
        <p class="text-muted">Loading wedding...</p>
      }
    }
  `,
})
export class WeddingAreaComponent {
  protected readonly ctx = inject(WeddingContext);
  private readonly route = inject(ActivatedRoute);
  private id = '';

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((p) => {
      this.id = p.get('weddingId')!;
      this.ctx.load(this.id).subscribe();
    });
    inject(DestroyRef).onDestroy(() => this.ctx.clear());
  }

  reload(): void {
    this.ctx.load(this.id, true).subscribe();
  }
}
