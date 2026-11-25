import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { BudgetSummary, Expense, ExpenseInput, PaymentInput } from '../../core/models/budget';

@Injectable({ providedIn: 'root' })
export class BudgetService {
  private readonly http = inject(HttpClient);
  private base = (w: string) => `/api/weddings/${w}/expenses`;

  summary(weddingId: string): Observable<BudgetSummary> {
    return this.http.get<BudgetSummary>(`/api/weddings/${weddingId}/budget`);
  }

  list(weddingId: string): Observable<Expense[]> {
    return this.http.get<Expense[]>(this.base(weddingId));
  }

  get(weddingId: string, expenseId: string): Observable<Expense> {
    return this.http.get<Expense>(`${this.base(weddingId)}/${expenseId}`);
  }

  create(weddingId: string, body: ExpenseInput): Observable<Expense> {
    return this.http.post<Expense>(this.base(weddingId), body);
  }

  update(weddingId: string, expenseId: string, body: Partial<ExpenseInput>): Observable<Expense> {
    return this.http.patch<Expense>(`${this.base(weddingId)}/${expenseId}`, body);
  }

  remove(weddingId: string, expenseId: string): Observable<void> {
    return this.http.delete<void>(`${this.base(weddingId)}/${expenseId}`);
  }

  addPayment(weddingId: string, expenseId: string, body: PaymentInput): Observable<Expense> {
    return this.http.post<Expense>(`${this.base(weddingId)}/${expenseId}/payments`, body);
  }

  updatePayment(weddingId: string, expenseId: string, paymentId: string, body: Partial<PaymentInput>): Observable<Expense> {
    return this.http.patch<Expense>(`${this.base(weddingId)}/${expenseId}/payments/${paymentId}`, body);
  }

  /** Returns the recalculated expense (BR-08). */
  removePayment(weddingId: string, expenseId: string, paymentId: string): Observable<Expense> {
    return this.http.delete<Expense>(`${this.base(weddingId)}/${expenseId}/payments/${paymentId}`);
  }
}
