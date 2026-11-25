import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ScheduleInput, ScheduleItem, ScheduleSaveResult } from '../../core/models/schedule';

@Injectable({ providedIn: 'root' })
export class ScheduleService {
  private readonly http = inject(HttpClient);
  private base = (w: string) => `/api/weddings/${w}/schedule`;

  list(weddingId: string): Observable<ScheduleItem[]> {
    return this.http.get<ScheduleItem[]>(this.base(weddingId));
  }

  create(weddingId: string, body: ScheduleInput): Observable<ScheduleSaveResult> {
    return this.http.post<ScheduleSaveResult>(this.base(weddingId), body);
  }

  update(weddingId: string, itemId: string, body: Partial<ScheduleInput>): Observable<ScheduleSaveResult> {
    return this.http.patch<ScheduleSaveResult>(`${this.base(weddingId)}/${itemId}`, body);
  }

  remove(weddingId: string, itemId: string): Observable<void> {
    return this.http.delete<void>(`${this.base(weddingId)}/${itemId}`);
  }
}
