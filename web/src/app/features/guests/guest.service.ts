import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Guest, GuestInput, GuestList, RsvpStatus } from '../../core/models/guest';

@Injectable({ providedIn: 'root' })
export class GuestService {
  private readonly http = inject(HttpClient);
  private base = (w: string) => `/api/weddings/${w}/guests`;

  list(weddingId: string, search = '', rsvpStatus: RsvpStatus | '' = ''): Observable<GuestList> {
    let params = new HttpParams();
    if (search.trim()) params = params.set('search', search.trim());
    if (rsvpStatus) params = params.set('rsvpStatus', rsvpStatus);
    return this.http.get<GuestList>(this.base(weddingId), { params });
  }

  create(weddingId: string, body: GuestInput): Observable<Guest> {
    return this.http.post<Guest>(this.base(weddingId), body);
  }

  update(weddingId: string, guestId: string, body: Partial<GuestInput>): Observable<Guest> {
    return this.http.patch<Guest>(`${this.base(weddingId)}/${guestId}`, body);
  }

  remove(weddingId: string, guestId: string): Observable<void> {
    return this.http.delete<void>(`${this.base(weddingId)}/${guestId}`);
  }

  /** Creates the invitation or rotates its link, then emails it. A failed email still returns 200. */
  sendInvitation(weddingId: string, guestId: string): Observable<Guest> {
    return this.http.post<Guest>(`${this.base(weddingId)}/${guestId}/invitation/send`, {});
  }

  revokeInvitation(weddingId: string, guestId: string): Observable<Guest> {
    return this.http.post<Guest>(`${this.base(weddingId)}/${guestId}/invitation/revoke`, {});
  }
}
