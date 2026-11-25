import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Wedding, WeddingInput, WeddingListStatus } from '../../core/models/wedding';

@Injectable({ providedIn: 'root' })
export class WeddingService {
  private readonly http = inject(HttpClient);

  list(status: WeddingListStatus = 'active'): Observable<Wedding[]> {
    return this.http.get<Wedding[]>('/api/weddings', { params: new HttpParams().set('status', status) });
  }

  get(id: string): Observable<Wedding> {
    return this.http.get<Wedding>(`/api/weddings/${id}`);
  }

  create(body: WeddingInput): Observable<Wedding> {
    return this.http.post<Wedding>('/api/weddings', body);
  }

  update(id: string, body: Partial<WeddingInput>): Observable<Wedding> {
    return this.http.patch<Wedding>(`/api/weddings/${id}`, body);
  }

  archive(id: string): Observable<Wedding> {
    return this.http.post<Wedding>(`/api/weddings/${id}/archive`, {});
  }
}
