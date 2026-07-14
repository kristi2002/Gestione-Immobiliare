/** Shapes returned by api/get_dashboard_stats.php. */

export type PriceType = 'vendita' | 'affitto';
export type PropertyStatus = 'available' | 'rented' | 'sold' | 'reserved' | 'archived';

export interface MonthlyRevenuePoint {
  ym: string; // "2026-07"
  revenue: string; // paid amount (comes as string from PDO)
  expected: string;
}

export interface SparkPoint {
  ym: string;
  n: string;
  n_sale?: string;
  n_rent?: string;
}

export interface RecentProperty {
  id: number;
  address: string;
  city: string | null;
  price: string | null;
  price_type: PriceType | null;
  property_type: string | null;
  status: PropertyStatus;
  cover_url: string | null;
}

export interface AppointmentToday {
  id: number;
  appointment_date: string;
  duration_minutes: number | null;
  status: string;
  notes: string | null;
  property_address: string | null;
  property_type: string | null;
  person_name: string | null;
  agent_name: string | null;
}

export interface RecentPayment {
  amount: string;
  status: string;
  due_date: string | null;
  paid_date: string | null;
  tenant_name: string | null;
  tenant_surname: string | null;
  property_address: string | null;
  price_type: PriceType | null;
}

export interface DashboardStats {
  total_clients: number;
  total_properties: number;
  available_properties: number;
  rented_properties: number;
  sold_properties: number;
  active_tenants: number;
  total_leads: number;
  properties_for_sale: number;
  properties_for_rent: number;
  properties_new_month: number;
  leads_new_month: number;
  expiring_reminders: number;
  overdue_reminders: number;
  monthly_revenue: MonthlyRevenuePoint[];
  chart_year: number;
  pending_this_month: number;
  recent_payments: RecentPayment[];
  recent_properties: RecentProperty[];
  appointments_today: AppointmentToday[];
  property_spark: SparkPoint[];
  lead_spark: SparkPoint[];
}
