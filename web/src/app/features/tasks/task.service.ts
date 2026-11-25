import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ChecklistTemplate, Task, TaskFilters, TaskInput, TaskMemberPatch } from '../../core/models/task';

@Injectable({ providedIn: 'root' })
export class TaskService {
  private readonly http = inject(HttpClient);
  private base = (w: string) => `/api/weddings/${w}/tasks`;

  list(weddingId: string, filters: TaskFilters = {}): Observable<Task[]> {
    let params = new HttpParams();
    if (filters.assignee) params = params.set('assignee', filters.assignee);
    if (filters.status) params = params.set('status', filters.status);
    if (filters.overdue) params = params.set('overdue', 'true');
    return this.http.get<Task[]>(this.base(weddingId), { params });
  }

  create(weddingId: string, body: TaskInput): Observable<Task> {
    return this.http.post<Task>(this.base(weddingId), body);
  }

  /** Owner: any field. Team member: only status / progressNotes (BR-03). */
  update(weddingId: string, taskId: string, body: Partial<TaskInput> | TaskMemberPatch): Observable<Task> {
    return this.http.patch<Task>(`${this.base(weddingId)}/${taskId}`, body);
  }

  remove(weddingId: string, taskId: string): Observable<void> {
    return this.http.delete<void>(`${this.base(weddingId)}/${taskId}`);
  }

  templates(): Observable<ChecklistTemplate[]> {
    return this.http.get<ChecklistTemplate[]>('/api/checklist-templates');
  }

  applyTemplate(weddingId: string, templateId: string): Observable<{ created: Task[] }> {
    return this.http.post<{ created: Task[] }>(
      `/api/weddings/${weddingId}/checklist-templates/${templateId}/apply`,
      {},
    );
  }
}
