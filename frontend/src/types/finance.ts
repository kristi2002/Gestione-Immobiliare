import type { Paginated } from './property';

export type { Paginated };

// ---------------------------------------------------------------------------
// Pagamenti
// ---------------------------------------------------------------------------
export type PaymentStatus = 'pending' | 'paid' | 'late' | 'cancelled';

export interface Payment {
  id: number;
  tenant_id: number;
  property_id: number;
  contract_id: number | null;
  amount: string;
  due_date: string;
  paid_date: string | null;
  status: PaymentStatus;
  method: string | null;
  notes: string | null;
  tenant_name: string | null;
  tenant_surname: string | null;
  property_address: string | null;
  property_city: string | null;
  created_at: string;
}

export interface PaymentStats {
  paid_month: number;
  pending_month: number;
  late_total: number;
  late_count: number;
  year_paid: number;
}

// ---------------------------------------------------------------------------
// Contratti
// ---------------------------------------------------------------------------
export type ContractStatus = 'draft' | 'sent' | 'signed' | 'expired' | 'cancelled';
export type ContractType = 'locazione' | 'compravendita' | 'preliminare' | 'mandato' | 'altro';

export interface Contract {
  id: number;
  property_id: number;
  tenant_id: number | null;
  client_id: number | null;
  title: string;
  contract_type: ContractType;
  status: ContractStatus | null;
  start_date: string | null;
  end_date: string | null;
  monthly_rent: string | null;
  deposit: string | null;
  document_id: number | null;
  notes: string | null;
  property_address: string | null;
  property_city: string | null;
  tenant_name: string | null;
  tenant_surname: string | null;
  client_name: string | null;
  client_surname: string | null;
  contract_subtype: string | null;
  cedolare_secca: number | boolean;
  registration_number: string | null;
  registration_date: string | null;
  registration_office: string | null;
  imposta_registro_due_date: string | null;
  registration_tax_annual: string | null;
  stamp_duty: string | null;
  istat_update_enabled: number | boolean;
  istat_baseline_index: string | null;
  istat_baseline_month: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Fatture
// ---------------------------------------------------------------------------
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'cancelled';

export interface Invoice {
  id: number;
  invoice_number: string;
  client_id: number | null;
  lead_id: number | null;
  property_id: number | null;
  description: string | null;
  amount: string;
  vat_rate: string | null;
  vat_amount: string | null;
  total: string;
  status: InvoiceStatus;
  issue_date: string | null;
  due_date: string | null;
  paid_date: string | null;
  client_name: string | null;
  client_surname: string | null;
  lead_name: string | null;
  lead_surname: string | null;
}

// ---------------------------------------------------------------------------
// Provvigioni (agent_commissions)
// ---------------------------------------------------------------------------
export type CommissionStatus = 'pending' | 'paid' | 'cancelled';
export type CommissionType = 'vendita' | 'locazione' | 'affitto' | 'gestione' | 'altro';

export interface Commission {
  id: number;
  admin_user_id: number | null;
  contract_id: number | null;
  property_id: number | null;
  client_id: number | null;
  amount: string;
  percentage: string | null;
  commission_type: CommissionType;
  status: CommissionStatus;
  notes: string | null;
  due_date: string | null;
  paid_at: string | null;
  agent_username: string | null;
  property_address: string | null;
  property_city: string | null;
  client_name: string | null;
  client_surname: string | null;
  contract_title: string | null;
  contract_type: string | null;
  created_at: string;
}

export interface CommissionStats {
  pending_total: number;
  paid_total: number;
  total_count: number;
}

/** commissions.php returns items + stats in one envelope. */
export interface CommissionListResponse extends Paginated<Commission> {
  stats: CommissionStats;
}
