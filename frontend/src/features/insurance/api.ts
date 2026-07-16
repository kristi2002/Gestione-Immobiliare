import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface InsurancePolicy {
  id: number;
  property_id: number;
  insurer_name: string;
  policy_number: string;
  policy_type: string;
  premium_annual: string | null;
  start_date: string | null;
  end_date: string;
  notes: string | null;
  property_address: string | null;
}

export interface InsuranceFormValues {
  property_id: string;
  insurer_name: string;
  policy_number: string;
  policy_type: string;
  premium_annual: string;
  start_date: string;
  end_date: string;
  notes: string;
}

export const insuranceKeys = {
  all: ['insurance'] as const,
  detail: (id: number) => [...insuranceKeys.all, 'detail', id] as const,
};

export function useInsurancePolicy(id: number | undefined) {
  return useQuery({
    queryKey: insuranceKeys.detail(id ?? 0),
    queryFn: ({ signal }) => api.get<InsurancePolicy>('insurance.php', { params: { id }, signal }),
    enabled: id != null,
  });
}

export function useCreateInsurancePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: InsuranceFormValues) => api.post<InsurancePolicy>('insurance.php', values),
    onSuccess: () => qc.invalidateQueries({ queryKey: insuranceKeys.all }),
  });
}

export function useUpdateInsurancePolicy(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: InsuranceFormValues) => api.put<InsurancePolicy>('insurance.php', values, { params: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: insuranceKeys.all }),
  });
}
