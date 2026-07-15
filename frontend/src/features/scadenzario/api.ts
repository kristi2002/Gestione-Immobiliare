import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export type ScadenzarioType =
  | 'contract_expiry'
  | 'registration'
  | 'ape'
  | 'insurance'
  | 'aml';

export type ScadenzarioSeverity = 'overdue' | 'soon' | 'upcoming';

export interface ScadenzarioItem {
  type: ScadenzarioType;
  label: string;
  subject: string;
  context: string | null;
  date: string | null;
  days_until: number | null;
  severity: ScadenzarioSeverity;
  view: string;
  entity_id: number;
}

export interface ScadenzarioStats {
  overdue: number;
  soon: number;
  upcoming: number;
  total: number;
}

export interface ScadenzarioData {
  items: ScadenzarioItem[];
  stats: ScadenzarioStats;
  horizon: number;
}

export function useScadenzario(horizon = 365) {
  return useQuery({
    queryKey: ['scadenzario', horizon],
    queryFn: ({ signal }) =>
      api.get<ScadenzarioData>('scadenzario.php', { params: { horizon }, signal }),
  });
}
