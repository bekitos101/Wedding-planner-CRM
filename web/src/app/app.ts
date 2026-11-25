import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `
    <a class="skip-link" href="#main" (click)="skip($event)">Skip to main content</a>
    <router-outlet />
  `,
})
export class App {
  /** In-page focus jump; a plain #main href would be resolved against <base href="/">. */
  skip(event: Event): void {
    event.preventDefault();
    document.getElementById('main')?.focus();
  }
}
