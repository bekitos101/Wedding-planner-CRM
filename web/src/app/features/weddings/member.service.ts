import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Member } from '../../core/models/wedding';

@Injectable({ providedIn: 'root' })
export class MemberService {
  private readonly http = inject(HttpClient);

  list(weddingId: string): Observable<Member[]> {
    return this.http.get<Member[]>(`/api/weddings/${weddingId}/members`);
  }

  /** 201 for a new member, 200 when a revoked member is re-activated. */
  add(weddingId: string, email: string): Observable<Member> {
    return this.http.post<Member>(`/api/weddings/${weddingId}/members`, { email });
  }

  revoke(weddingId: string, userId: string): Observable<void> {
    return this.http.delete<void>(`/api/weddings/${weddingId}/members/${userId}`);
  }
}
