import { HttpTestingController } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../core/auth/auth.service';
import { Task } from '../../core/models/task';
import { httpTestProviders, makeWedding } from '../weddings/testing';
import { WeddingContext } from '../weddings/wedding-context.service';
import { TasksPage } from './tasks.page';

const task = (over: Partial<Task>): Task => ({
  id: 't1', title: 'Book florist', description: null, dueDate: '2027-03-01', priority: 'HIGH', status: 'TODO',
  progressNotes: null, assignee: null, isOverdue: false, completedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

const mine = task({ id: 't1', title: 'My task', assignee: { id: 'u2', name: 'Tom Team' } });
const others = task({ id: 't2', title: 'Other task', assignee: { id: 'u1', name: 'Olivia Owner' }, isOverdue: true });

function setup(role: 'OWNER' | 'TEAM_MEMBER', tasks: Task[] = [mine, others]) {
  TestBed.configureTestingModule({
    imports: [TasksPage],
    providers: [
      ...httpTestProviders(),
      { provide: AuthService, useValue: { currentUser: signal({ id: role === 'OWNER' ? 'u1' : 'u2', name: 'x', email: 'x@x.io', createdAt: '' }) } },
    ],
  });
  TestBed.inject(WeddingContext).set(makeWedding({ role }));
  const ctrl = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(TasksPage);
  fixture.detectChanges();
  if (role === 'OWNER') ctrl.expectOne('/api/weddings/w1/members').flush([]);
  ctrl.expectOne((r) => r.url === '/api/weddings/w1/tasks').flush(tasks);
  fixture.detectChanges();
  return { fixture, ctrl, el: fixture.nativeElement as HTMLElement };
}

const buttons = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll('button')).filter((b) => b.textContent?.trim() === text);

describe('TasksPage', () => {
  it('AC-03: member gets an edit form with ONLY status and progress notes, and sends only those', () => {
    const { fixture, ctrl, el } = setup('TEAM_MEMBER');
    expect(buttons(el, 'Update progress').length).toBe(1); // only own task
    expect(buttons(el, 'Edit').length).toBe(0);
    expect(buttons(el, 'Delete').length).toBe(0);
    expect(el.textContent).not.toContain('New task');

    buttons(el, 'Update progress')[0].click();
    fixture.detectChanges();
    expect(el.querySelector('#taskStatus')).not.toBeNull();
    expect(el.querySelector('#taskNotes')).not.toBeNull();
    for (const id of ['#taskTitle', '#taskDue', '#taskPriority', '#taskAssignee', '#taskDescription']) {
      expect(el.querySelector(id)).toBeNull();
    }

    (el.querySelector('#taskStatus') as HTMLSelectElement).value = 'IN_PROGRESS';
    (el.querySelector('#taskStatus') as HTMLSelectElement).dispatchEvent(new Event('change'));
    const notes = el.querySelector('#taskNotes') as HTMLTextAreaElement;
    notes.value = 'Called them';
    notes.dispatchEvent(new Event('input'));
    (el.querySelector('app-task-form form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    const req = ctrl.expectOne('/api/weddings/w1/tasks/t1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'IN_PROGRESS', progressNotes: 'Called them' });
  });

  it('AC-04: member sees no edit on tasks assigned to others', () => {
    const { el } = setup('TEAM_MEMBER', [others]);
    expect(buttons(el, 'Update progress').length).toBe(0);
    expect(el.querySelector('select[aria-label^="Status of"]')).toBeNull();
  });

  it('owner sees edit/delete and the overdue chip', () => {
    const { el } = setup('OWNER');
    expect(buttons(el, 'Edit').length).toBe(2);
    expect(buttons(el, 'Delete').length).toBe(2);
    expect(el.textContent).toContain('Overdue');
    expect(el.textContent).toContain('Apply checklist template');
  });

  it('sends filter params to the API', () => {
    const { fixture, ctrl } = setup('OWNER');
    const page = fixture.componentInstance;
    page.scope.set('me');
    page.status.set('COMPLETED');
    page.overdue.set(true);
    page.load();
    const req = ctrl.expectOne((r) => r.url === '/api/weddings/w1/tasks');
    expect(req.request.params.get('assignee')).toBe('me');
    expect(req.request.params.get('status')).toBe('COMPLETED');
    expect(req.request.params.get('overdue')).toBe('true');
    req.flush([]);
  });

  it('applying a template shows how many tasks were added', () => {
    const { fixture, ctrl, el } = setup('OWNER');
    buttons(el, 'Apply checklist template')[0].click();
    fixture.detectChanges();
    ctrl.expectOne('/api/checklist-templates').flush([
      { id: 'tpl1', name: 'Classic', description: null, items: [
        { id: 'i1', title: 'Book venue', description: null, priority: 'HIGH', daysBeforeWedding: 300 } ] },
    ]);
    fixture.detectChanges();
    expect(el.textContent).toContain('1 tasks');
    buttons(el, 'Apply')[0].click();
    ctrl.expectOne('/api/weddings/w1/checklist-templates/tpl1/apply').flush({ created: [mine, others] }, { status: 201, statusText: 'Created' });
    ctrl.expectOne((r) => r.url === '/api/weddings/w1/tasks').flush([mine, others]);
    fixture.detectChanges();
    expect(el.textContent).toContain('2 tasks added');
  });

  it('FR-15: owner editing only the title sends {title} without status or progressNotes', () => {
    const { fixture, ctrl, el } = setup('OWNER');
    buttons(el, 'Edit')[0].click();
    fixture.detectChanges();
    const title = el.querySelector('#taskTitle') as HTMLInputElement;
    title.value = 'Renamed';
    title.dispatchEvent(new Event('input'));
    (el.querySelector('app-task-form form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    const req = ctrl.expectOne('/api/weddings/w1/tasks/t1');
    expect(req.request.body).toEqual({ title: 'Renamed' });
  });
});
