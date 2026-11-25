import { Component, input } from '@angular/core';
import { RsvpStatus } from '../models/guest';
import { TaskPriority, TaskStatus } from '../models/task';

/** One look for task status everywhere (NFR-12). */
@Component({
  selector: 'app-task-status-chip',
  template: `<span class="chip" [class]="cls()">{{ label() }}</span>`,
})
export class TaskStatusChipComponent {
  readonly status = input.required<TaskStatus>();
  protected label = () => ({ TODO: 'To do', IN_PROGRESS: 'In progress', COMPLETED: 'Completed' })[this.status()];
  protected cls = () => ({ TODO: 'chip-neutral', IN_PROGRESS: 'chip-info', COMPLETED: 'chip-success' })[this.status()];
}

@Component({
  selector: 'app-priority-chip',
  template: `<span class="chip" [class]="cls()">{{ label() }}</span>`,
})
export class PriorityChipComponent {
  readonly priority = input.required<TaskPriority>();
  protected label = () => ({ LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' })[this.priority()];
  protected cls = () => ({ LOW: 'chip-neutral', MEDIUM: 'chip-warning', HIGH: 'chip-danger' })[this.priority()];
}

/** One look for RSVP states everywhere (NFR-12). */
@Component({
  selector: 'app-rsvp-chip',
  template: `<span class="chip" [class]="cls()">{{ label() }}</span>`,
})
export class RsvpChipComponent {
  readonly status = input.required<RsvpStatus>();
  protected label = () => ({ PENDING: 'Pending', ACCEPTED: 'Accepted', DECLINED: 'Declined' })[this.status()];
  protected cls = () => ({ PENDING: 'chip-warning', ACCEPTED: 'chip-success', DECLINED: 'chip-danger' })[this.status()];
}
