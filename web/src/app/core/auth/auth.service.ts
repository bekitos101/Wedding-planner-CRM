import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { LoginRequest, RegisterRequest, UpdateProfileRequest, User } from '../models/user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly _user = signal<User | null>(null);

  readonly currentUser = this._user.asReadonly();
  readonly isLoggedIn = computed(() => this._user() !== null);

  register(body: RegisterRequest): Observable<User> {
    return this.http.post<User>('/api/auth/register', body).pipe(tap((u) => this._user.set(u)));
  }

  login(body: LoginRequest): Observable<User> {
    return this.http.post<User>('/api/auth/login', body).pipe(tap((u) => this._user.set(u)));
  }

  logout(): Observable<void> {
    return this.http.post<void>('/api/auth/logout', {}).pipe(
      catchError(() => of(undefined)),
      tap(() => this._user.set(null)),
      map(() => undefined),
    );
  }

  /** GET /me. A 401 (or any failure) at startup means "not logged in": yields null, no redirect. */
  loadMe(): Observable<User | null> {
    return this.http.get<User>('/api/me').pipe(
      catchError(() => of(null)),
      tap((u) => this._user.set(u)),
    );
  }

  updateProfile(body: UpdateProfileRequest): Observable<User> {
    return this.http.patch<User>('/api/me', body).pipe(tap((u) => this._user.set(u)));
  }

  /** Clears the local session without calling the server (used on 401). */
  clearSession(): void {
    this._user.set(null);
  }
}
