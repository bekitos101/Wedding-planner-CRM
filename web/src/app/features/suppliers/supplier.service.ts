import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Supplier, SupplierInput } from '../../core/models/supplier';

@Injectable({ providedIn: 'root' })
export class SupplierService {
  private readonly http = inject(HttpClient);
  private base = (w: string) => `/api/weddings/${w}/suppliers`;

  list(weddingId: string, search = '', category = ''): Observable<Supplier[]> {
    let params = new HttpParams();
    if (search.trim()) params = params.set('search', search.trim());
    if (category) params = params.set('category', category);
    return this.http.get<Supplier[]>(this.base(weddingId), { params });
  }

  create(weddingId: string, body: SupplierInput): Observable<Supplier> {
    return this.http.post<Supplier>(this.base(weddingId), body);
  }

  update(weddingId: string, supplierId: string, body: Partial<SupplierInput>): Observable<Supplier> {
    return this.http.patch<Supplier>(`${this.base(weddingId)}/${supplierId}`, body);
  }

  remove(weddingId: string, supplierId: string): Observable<void> {
    return this.http.delete<void>(`${this.base(weddingId)}/${supplierId}`);
  }
}
