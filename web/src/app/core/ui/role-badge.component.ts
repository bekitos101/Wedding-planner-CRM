import { Component, input } from '@angular/core';
import { WeddingRole } from '../models/wedding';

/** Same role chip on every screen (NFR-11, NFR-12). */
@Component({
  selector: 'app-role-badge',
  template: `<span class="chip" [class.chip-owner]="role() === 'OWNER'" [class.chip-neutral]="role() !== 'OWNER'">{{
    role() === 'OWNER' ? 'Owner' : 'Team member'
  }}</span>`,
})
export class RoleBadgeComponent {
  readonly role = input.required<WeddingRole>();
}
