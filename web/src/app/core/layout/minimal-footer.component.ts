import { Component } from '@angular/core';

/** Footer for the guest RSVP page: copyright only, no planner links (FR-30). */
@Component({
  selector: 'app-minimal-footer',
  template: `
    <footer class="mt-auto border-t border-line bg-blush/60">
      <p class="mx-auto max-w-3xl px-4 py-4 text-center text-sm text-muted">
        &copy; {{ currentYear }} Wedding Organizer. All rights reserved.
      </p>
    </footer>
  `,
})
export class MinimalFooterComponent {
  protected readonly currentYear = new Date().getFullYear();
}
