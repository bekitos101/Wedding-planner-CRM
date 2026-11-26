import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Dashboard } from '../../core/models/dashboard';
import { BudgetReport, GuestReport } from '../../core/models/reports';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);

  getDashboard(weddingId: string): Observable<Dashboard> {
    return this.http.get<Dashboard>(`/api/weddings/${weddingId}/dashboard`);
  }

  getGuestReport(weddingId: string): Observable<GuestReport> {
    return this.http.get<GuestReport>(`/api/weddings/${weddingId}/reports/guests`);
  }

  getBudgetReport(weddingId: string): Observable<BudgetReport> {
    return this.http.get<BudgetReport>(`/api/weddings/${weddingId}/reports/budget`);
  }
}
