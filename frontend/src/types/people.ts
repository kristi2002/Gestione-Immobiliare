import type { Paginated } from './property';

export type { Paginated };

// ---------------------------------------------------------------------------
// Proprietari (clients)
// ---------------------------------------------------------------------------
export type ClientStatus = 'active' | 'inactive' | 'archived' | string;

export interface Client {
  id: number;
  name: string;
  surname: string | null;
  codice_fiscale: string | null;
  phone: string | null;
  email: string | null;
  internal_notes: string | null;
  portal_email?: string | null;
  creation_date: string | null;
  status: ClientStatus;
  assigned_agent_id: number | null;
  agent_name: string | null;
  property_count: string | number;
}

export interface ClientStats {
  total: number;
  with_properties: number;
  new_month: number;
  active: number;
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------
export type LeadStatus = 'new' | 'contacted' | 'interested' | 'negotiating' | 'converted' | 'lost';
export type LeadInterest = 'affitto' | 'acquisto' | 'entrambi';

export interface Lead {
  id: number;
  name: string;
  surname: string | null;
  codice_fiscale: string | null;
  phone: string | null;
  email: string | null;
  interest_type: LeadInterest;
  budget_min: string | null;
  budget_max: string | null;
  preferred_city: string | null;
  preferred_type: string | null;
  min_rooms: number | null;
  min_sqm: string | null;
  status: LeadStatus;
  source: string;
  assigned_to: number | null;
  agent_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Inquilini (tenants)
// ---------------------------------------------------------------------------
export type TenantStatus = 'active' | 'inactive' | 'archived' | string;

export interface Tenant {
  id: number;
  name: string;
  surname: string | null;
  email: string | null;
  phone: string | null;
  status: TenantStatus;
  contract_id: number | null;
  property_id: number | null;
  lease_start: string | null;
  lease_end: string | null;
  monthly_rent: string | null;
  property_address: string | null;
  property_city: string | null;
  has_portal_access: number | boolean;
  iban: string | null;
  sdd_mandate_ref: string | null;
  sdd_mandate_date: string | null;
  created_at: string;
}

export interface TenantStats {
  total: number;
  active: number;
  with_contract: number;
  expiring: number;
}

// ---------------------------------------------------------------------------
// Agenti (portfolio)
// ---------------------------------------------------------------------------
export interface AgentPortfolio {
  id: number;
  username: string;
  role: string;
  email: string | null;
  leads_total: number;
  leads_new: number;
  leads_converted: number;
  appointments: number;
  properties: number;
  keys_out: number;
  conversion_rate: number;
}

/** Option shape for the agents dropdown (clients.php / leads.php ?action=agents). */
export interface AgentOption {
  id: number;
  username: string;
}
