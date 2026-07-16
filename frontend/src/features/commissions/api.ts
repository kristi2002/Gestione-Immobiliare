import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Commission, CommissionListResponse } from '@/types/finance';

export interface CommissionFilters {
  status?: string;
  type?: string;
  page?: number;
}

export const commissionKeys = {
  all: ['commissions'] as const,
  list: (f: CommissionFilters) => [...commissionKeys.all, 'list', f] as const,
  detail: (id: number) => [...commissionKeys.all, 'detail', id] as const,
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

export interface CommissionFormValues {
  admin_user_id: string;
  commission_type: string;
  amount: string;
  percentage: string;
  due_date: string;
  contract_id: string;
  notes: string;
}

export function useCommission(id: number | undefined) {
  return useQuery({
    queryKey: commissionKeys.detail(id ?? 0),
    queryFn: ({ signal }) => api.get<Commission>('commissions.php', { params: { id }, signal }),
    enabled: id != null,
  });
}

export function useCreateCommission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: CommissionFormValues) => api.post<Commission>('commissions.php', values),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissionKeys.all }),
  });
}

export function useUpdateCommission(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: CommissionFormValues) => api.put<Commission>('commissions.php', values, { params: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: commissionKeys.all }),
  });
}
