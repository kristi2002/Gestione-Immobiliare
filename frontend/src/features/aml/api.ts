import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export type AmlSubjectType = 'persona_fisica' | 'persona_giuridica';
export type AmlVerificationType = 'ordinaria' | 'semplificata' | 'rafforzata';
export type AmlRiskLevel = 'basso' | 'medio' | 'alto';
export type AmlOperationType = 'vendita' | 'locazione' | 'mediazione' | 'altro';
export type AmlStatus = 'da_completare' | 'completata' | 'sospesa';

/** A single Adeguata Verifica (D.Lgs. 231/2007) record. */
export interface AmlRecord {
  id: number;
  subject_name: string;
  subject_type: AmlSubjectType;
  codice_fiscale: string | null;
  partita_iva: string | null;
  client_id: number | null;
  lead_id: number | null;
  property_id: number | null;
  verification_type: AmlVerificationType;
  risk_level: AmlRiskLevel;
  operation_type: AmlOperationType;
  operation_value: number | string | null;
  id_document_type: string | null;
  id_document_number: string | null;
  id_document_expiry: string | null;
  beneficial_owner: string | null;
  is_pep: number;
  purpose: string | null;
  verification_date: string | null;
  retention_until: string | null;
  status: AmlStatus;
  notes: string | null;
  created_by: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  /** Joined helpers from the API. */
  client_name?: string | null;
  property_address?: string | null;
}

export interface AmlStats {
  total: number;
  pending: number;
  high_risk: number;
  expiring: number;
}

/** Envelope returned by GET /api/aml.php (list). */
export interface AmlListResponse {
  items: AmlRecord[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  stats: AmlStats;
}

export interface AmlFilters {
  search?: string;
  status?: string;
  risk_level?: string;
  expiring?: boolean;
  page?: number;
  limit?: number;
}

export const amlKeys = {
  all: ['aml'] as const,
  list: (f: AmlFilters) => [...amlKeys.all, 'list', f] as const,
  completed: [...['aml'], 'completed'] as const,
  expiring: [...['aml'], 'expiring'] as const,
};

/** Main registry list — paginated, filtered. Response carries GLOBAL stats. */
export function useAmlList(filters: AmlFilters) {
  return useQuery({
    queryKey: amlKeys.list(filters),
    queryFn: ({ signal }) =>
      api.get<AmlListResponse>('aml.php', {
        params: {
          search: filters.search || undefined,
          status: filters.status || undefined,
          risk_level: filters.risk_level || undefined,
          expiring: filters.expiring ? 1 : undefined,
          page: filters.page ?? 1,
          limit: filters.limit ?? 25,
        },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

/** Count of completed (`completata`) schede — read from the paginated `total`. */
export function useAmlCompletedCount() {
  return useQuery({
    queryKey: amlKeys.completed,
    queryFn: ({ signal }) =>
      api.get<AmlListResponse>('aml.php', {
        params: { status: 'completata', page: 1, limit: 1 },
        signal,
      }),
    select: (d) => d.total,
    staleTime: 5 * 60_000,
  });
}

/** Records approaching the end of their retention window (next 180 days). */
export function useAmlExpiring() {
  return useQuery({
    queryKey: amlKeys.expiring,
    queryFn: ({ signal }) =>
      api.get<AmlListResponse>('aml.php', {
        params: { expiring: 1, page: 1, limit: 50 },
        signal,
      }),
    select: (d) => d.items,
    staleTime: 5 * 60_000,
  });
}
