import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface ContactRequest {
  name: string;
  email: string;
  subject?: string;
  message: string;
  /** Honeypot: real visitors never fill this in. */
  contact_hp?: string;
}

export interface ContactResponse {
  message: string;
}

/** POST /api/contact (public). */
@Injectable({ providedIn: 'root' })
export class ContactService {
  private readonly http = inject(HttpClient);

  send(body: ContactRequest): Observable<ContactResponse> {
    return this.http.post<ContactResponse>('/api/contact', body);
  }
}
