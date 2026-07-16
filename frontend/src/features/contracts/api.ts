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
  detail: (id: number) => [...contractKeys.all, 'detail', id] as const,
};

export interface ContractFormValues {
  title: string;
  contract_type: string;
  status: string;
  property_id: string;
  tenant_id: string;
  client_id: string;
  start_date: string;
  end_date: string;
  monthly_rent: string;
  deposit: string;
  notes: string;
  contract_subtype: string;
  cedolare_secca: boolean;
  registration_number: string;
  registration_date: string;
  registration_office: string;
  imposta_registro_due_date: string;
  registration_tax_annual: string;
  stamp_duty: string;
  istat_update_enabled: boolean;
  istat_baseline_index: string;
  istat_baseline_month: string;
}

export function useContract(id: number | undefined) {
  return useQuery({
    queryKey: contractKeys.detail(id ?? 0),
    queryFn: ({ signal }) => api.get<Contract>('contracts.php', { params: { id }, signal }),
    enabled: id != null,
  });
}

export function useCreateContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: ContractFormValues) => api.post<Contract>('contracts.php', values),
    onSuccess: () => qc.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

export function useUpdateContract(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: ContractFormValues) => api.put<Contract>('contracts.php', values, { params: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

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

/** Full contract list for a form's "select a contract" dropdown. */
export function useContractOptions() {
  return useQuery({
    queryKey: [...contractKeys.all, 'options'] as const,
    queryFn: ({ signal }) =>
      api.get<Paginated<Contract>>('contracts.php', { params: { page: 1, limit: 1000 }, signal }),
    staleTime: 5 * 60_000,
    select: (data) => data.items,
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
