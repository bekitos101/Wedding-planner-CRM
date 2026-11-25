import { Component } from '@angular/core';

@Component({
  selector: 'app-rsvp-page',
  template: `
    <main class="rsvp-wrap">
      <section class="card">
        <h1>RSVP page</h1>
        <p class="muted">Coming in phase 3.</p>
      </section>
    </main>
  `,
  styles: `
    .rsvp-wrap { min-height: 100vh; display: grid; place-items: center; padding: 1rem; }
    .card { max-width: 28rem; width: 100%; text-align: center; }
  `,
})
export class RsvpPageComponent {}
