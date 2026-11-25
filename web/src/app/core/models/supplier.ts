export interface Supplier {
  id: string;
  name: string;
  category: string;
  contactInfo: string | null;
  quotedPrice: string | null;
  notes: string | null;
  createdAt: string;
}

export interface SupplierInput {
  name: string;
  category: string;
  contactInfo?: string;
  quotedPrice?: string | null;
  notes?: string;
}
