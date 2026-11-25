import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { OrnamentComponent } from '../../core/ui/ornament.component';

interface Feature {
  title: string;
  text: string;
  /** SVG path data, 24x24 stroke icon. */
  icon: string;
}

@Component({
  selector: 'app-landing-page',
  imports: [RouterLink, OrnamentComponent],
  template: `
    <section class="relative isolate overflow-hidden bg-gradient-to-br from-blush via-ivory to-sage-50">
      <app-ornament class="absolute inset-0 -z-10 opacity-60 lg:left-1/3" />
      <div class="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <div class="max-w-2xl">
          <p class="mb-3 text-sm font-medium uppercase tracking-widest text-rose-700">For professional wedding planners</p>
          <h1 class="mb-5 text-4xl leading-tight sm:text-5xl lg:text-6xl">Plan every wedding beautifully &mdash; in one place</h1>
          <p class="mb-8 text-lg text-muted">
            Keep guests, tasks, budgets, suppliers and the wedding-day schedule together for each couple, and give your
            team exactly the access they need.
          </p>
          <div class="flex flex-wrap gap-3">
            <a class="btn btn-primary btn-lg" routerLink="/register">Get started</a>
            <a class="btn btn-secondary btn-lg" routerLink="/login">Log in</a>
          </div>
        </div>
      </div>
    </section>

    <section id="features" class="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <div class="mb-10 max-w-2xl">
        <h2 class="text-3xl">Everything a wedding needs, organised per couple</h2>
        <p class="text-muted">Each wedding is its own project with its own guests, tasks, budget, suppliers and schedule.</p>
      </div>
      <ul class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        @for (f of features; track f.title) {
          <li class="card transition-shadow hover:shadow-lift">
            <span class="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-rose-100 text-rose-700">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path [attr.d]="f.icon" />
              </svg>
            </span>
            <h3 class="mb-1 text-lg font-semibold">{{ f.title }}</h3>
            <p class="text-sm text-muted">{{ f.text }}</p>
          </li>
        }
      </ul>
    </section>

    <section id="how-it-works" class="bg-sage-50">
      <div class="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 class="mb-10 text-3xl">How it works</h2>
        <ol class="grid gap-8 md:grid-cols-3">
          @for (s of steps; track s.title; let i = $index) {
            <li>
              <span class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-sage-700 font-serif text-lg text-white">{{ i + 1 }}</span>
              <h3 class="mb-1 text-lg font-semibold">{{ s.title }}</h3>
              <p class="text-sm text-muted">{{ s.text }}</p>
            </li>
          }
        </ol>
      </div>
    </section>

    <section class="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <div class="rounded-3xl bg-rose-800 px-6 py-12 text-center sm:px-12">
        <h2 class="mb-2 text-3xl text-white">Ready to bring your next wedding together?</h2>
        <p class="mb-6 text-rose-100">Create an account and set up your first wedding in a few minutes.</p>
        <a class="btn btn-lg bg-white text-rose-800 hover:bg-rose-50" routerLink="/register">Get started</a>
      </div>
    </section>
  `,
})
export class LandingPage {
  readonly features: Feature[] = [
    {
      title: 'Guests & RSVP',
      text: 'Keep a record for every guest, email individual invitations and see responses and dietary needs as guests reply through a private link.',
      icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    },
    {
      title: 'Tasks & checklists',
      text: 'Assign tasks with deadlines and priorities, spot what is overdue, and start from a ready-made planning checklist.',
      icon: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h9',
    },
    {
      title: 'Budget & payments',
      text: 'Track expenses, record deposits and instalments by hand, and always see what is paid, outstanding and left in the budget.',
      icon: 'M3 7h18v12H3zM3 7l2-3h14l2 3M16 13h2',
    },
    {
      title: 'Suppliers',
      text: 'Keep supplier contacts, service categories and quoted prices next to the wedding they belong to.',
      icon: 'M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6',
    },
    {
      title: 'Wedding-day schedule',
      text: 'Build the day as a timeline in chronological order and get a warning when two items overlap.',
      icon: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    },
    {
      title: 'Team collaboration',
      text: 'Invite colleagues to view a wedding. Team members update only the status and notes of the tasks assigned to them.',
      icon: 'M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6l8-3zM9 12l2 2 4-4',
    },
  ];

  readonly steps = [
    { title: 'Create a wedding', text: 'Add the couple, date, location, budget and RSVP deadline.' },
    { title: 'Invite your team', text: 'Give registered colleagues read access and assign them tasks.' },
    { title: 'Track guests, tasks and budget', text: 'Follow RSVPs, deadlines and payments from one dashboard per wedding.' },
  ];
}
