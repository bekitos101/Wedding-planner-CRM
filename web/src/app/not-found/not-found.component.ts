import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  template: `
    <section class="mx-auto max-w-lg px-4 py-24 text-center">
      <p class="font-serif text-6xl text-rose-300" aria-hidden="true">404</p>
      <h1 class="mt-2">Page not found</h1>
      <p class="mb-6 text-muted">The page you are looking for does not exist.</p>
      <a class="btn btn-primary" routerLink="/">Back to home</a>
    </section>
  `,
})
export class NotFoundComponent {}
