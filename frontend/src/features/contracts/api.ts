import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Contract, Paginated } from '@/types/finance';

export interface ContractFilters {
  search?: string;
  status?: string;
  type?: string;
  page?: number;
}

export const contractKeys = {
  all: ['contracts'] as const,
  list: (f: ContractFilters) => [...contractKeys.all, 'list', f] as const,
};

export function useContracts(filters: ContractFilters) {
  return useQuery({
    queryKey: contractKeys.list(filters),
    queryFn: ({ signal }) =>
      api.get<Paginated<Contract>>('contracts.php', {
        params: {
          search: filters.search || undefined,
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

export interface GenerateResult {
  contract_id: number;
  payments_created: number;
  message: string;
}

/** Generate the rent payment schedule (scadenzario) for a locazione contract. */
export function useGeneratePayments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contractId: number) =>
      api.post<GenerateResult>('contracts.php', undefined, {
        params: { action: 'generate_payments', id: contractId },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] });
    },
  });
}
