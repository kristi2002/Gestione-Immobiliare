import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { CommissionListResponse } from '@/types/finance';

export interface CommissionFilters {
  status?: string;
  type?: string;
  page?: number;
}

export const commissionKeys = {
  all: ['commissions'] as const,
  list: (f: CommissionFilters) => [...commissionKeys.all, 'list', f] as const,
};

export function useCommissions(filters: CommissionFilters) {
  return useQuery({
    queryKey: commissionKeys.list(filters),
    queryFn: ({ signal }) =>
      api.get<CommissionListResponse>('commissions.php', {
        params: {
          status: filters.status || undefined,
          type: filters.type || undefined,
          page: filters.page ?? 1,
          limit: 25,
        },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}
