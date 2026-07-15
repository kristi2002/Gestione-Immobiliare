import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export type MaintenanceStatus = 'todo' | 'in_progress' | 'done';
export type MaintenancePriority = 'urgent' | 'normal';

export interface MaintenanceItem {
  id: number;
  title: string;
  property_address: string | null;
  tenant_name: string | null;
  supplier_name: string | null;
  status: MaintenanceStatus;
  priority: MaintenancePriority;
  reported_date: string | null;
  eta_date: string | null;
  started_date: string | null;
  completed_date: string | null;
  cost: number | string | null;
  rating: number | string | null;
  progress: number | string | null;
}

export interface TopSupplier {
  name: string;
  count: number;
}

export interface MaintenanceStats {
  open: number;
  in_progress: number;
  completed_month: number;
  avg_cost: number;
  total_open_cost: number;
  top_supplier: TopSupplier | null;
}

export interface MaintenanceResponse {
  items: MaintenanceItem[];
  stats: MaintenanceStats;
}

export const maintenanceKeys = {
  all: ['maintenance'] as const,
};

/** Interventi, guasti e manutenzione programmata (single non-paginated payload). */
export function useMaintenance() {
  return useQuery({
    queryKey: maintenanceKeys.all,
    queryFn: ({ signal }) => api.get<MaintenanceResponse>('maintenance.php', { signal }),
  });
}
