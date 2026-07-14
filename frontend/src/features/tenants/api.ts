import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Paginated, Tenant, TenantStats } from '@/types/people';

export const tenantKeys = {
  all: ['tenants'] as const,
  list: (f: { search?: string; page?: number }) => [...tenantKeys.all, 'list', f] as const,
  stats: [...['tenants'], 'stats'] as const,
};

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
