import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  template: `
    <main class="center-page">
      <section class="card">
        <h1>Page not found</h1>
        <p class="muted">The page you are looking for does not exist.</p>
        <a routerLink="/">Back to home</a>
      </section>
    </main>
  `,
  styles: `.center-page { min-height: 100vh; display: grid; place-items: center; padding: 1rem; text-align: center; }`,
})
export class NotFoundComponent {}
