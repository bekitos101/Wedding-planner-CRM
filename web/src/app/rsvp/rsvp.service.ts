import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { RsvpStatus, RsvpView } from '../core/models/guest';

/** Public guest endpoints: no login, only what the invitation token allows (NFR-08). */
@Injectable({ providedIn: 'root' })
export class RsvpService {
  private readonly http = inject(HttpClient);
  private url = (token: string) => `/api/rsvp/${encodeURIComponent(token)}`;

  get(token: string): Observable<RsvpView> {
    return this.http.get<RsvpView>(this.url(token));
  }

  submit(token: string, rsvpStatus: Exclude<RsvpStatus, 'PENDING'>, dietaryRequirements: string): Observable<RsvpView> {
    return this.http.post<RsvpView>(this.url(token), { rsvpStatus, dietaryRequirements });
  }
}
