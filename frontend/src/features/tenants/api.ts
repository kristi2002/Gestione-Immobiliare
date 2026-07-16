import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Paginated, Tenant, TenantStats } from '@/types/people';

export const tenantKeys = {
  all: ['tenants'] as const,
  list: (f: { search?: string; page?: number }) => [...tenantKeys.all, 'list', f] as const,
  stats: [...['tenants'], 'stats'] as const,
  detail: (id: number) => [...tenantKeys.all, 'detail', id] as const,
};

export interface TenantFormValues {
  name: string;
  surname: string;
  email: string;
  phone: string;
  property_id: string;
  lease_start: string;
  lease_end: string;
  monthly_rent: string;
  iban: string;
  sdd_mandate_ref: string;
  sdd_mandate_date: string;
  portal_password: string;
  notes: string;
}

/** Full tenant list for a form's "select a tenant" dropdown — carries
 * property_id/contract_id so payment forms can cascade-fill from it. */
export function useTenantOptions() {
  return useQuery({
    queryKey: [...tenantKeys.all, 'options'] as const,
    queryFn: ({ signal }) => api.get<Paginated<Tenant>>('tenants.php', { params: { page: 1, limit: 1000 }, signal }),
    staleTime: 5 * 60_000,
    select: (data) => data.items,
  });
}

export function useTenant(id: number | undefined) {
  return useQuery({
    queryKey: tenantKeys.detail(id ?? 0),
    queryFn: ({ signal }) => api.get<Tenant>('tenants.php', { params: { id }, signal }),
    enabled: id != null,
  });
}

/** Creating/updating a tenant transparently creates/updates a linked
 * `locazione` contract server-side (see api/tenants.php's
 * createOrUpdateLeaseContract()) — not a separate step here. */
export function useCreateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: TenantFormValues) => api.post<Tenant>('tenants.php', values),
    onSuccess: () => qc.invalidateQueries({ queryKey: tenantKeys.all }),
  });
}

export function useUpdateTenant(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: TenantFormValues) => api.put<Tenant>('tenants.php', values, { params: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: tenantKeys.all }),
  });
}

export function useTenants(filters: { search?: string; page?: number }) {
  return useQuery({
    queryKey: tenantKeys.list(filters),
    queryFn: ({ signal }) =>
      api.get<Paginated<Tenant>>('tenants.php', {
        params: { search: filters.search || undefined, page: filters.page ?? 1, limit: 25 },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useTenantStats() {
  return useQuery({
    queryKey: tenantKeys.stats,
    queryFn: ({ signal }) => api.get<TenantStats>('tenants.php', { params: { action: 'stats' }, signal }),
  });
}
