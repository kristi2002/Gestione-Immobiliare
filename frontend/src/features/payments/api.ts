import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Paginated, Payment, PaymentStats } from '@/types/finance';

export interface PaymentFilters {
  status?: string;
  month?: number | null;
  year?: number | null;
  page?: number;
}

export const paymentKeys = {
  all: ['payments'] as const,
  list: (f: PaymentFilters) => [...paymentKeys.all, 'list', f] as const,
  stats: [...['payments'], 'stats'] as const,
  detail: (id: number) => [...paymentKeys.all, 'detail', id] as const,
};

export interface PaymentFormValues {
  tenant_id: string;
  property_id: string;
  contract_id: string;
  amount: string;
  due_date: string;
  paid_date: string;
  status: string;
  method: string;
  notes: string;
}

export function usePayment(id: number | undefined) {
  return useQuery({
    queryKey: paymentKeys.detail(id ?? 0),
    queryFn: ({ signal }) => api.get<Payment>('payments.php', { params: { id }, signal }),
    enabled: id != null,
  });
}

export function useCreatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: PaymentFormValues) => api.post<Payment>('payments.php', values),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentKeys.all }),
  });
}

export function useUpdatePayment(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: PaymentFormValues) => api.put<Payment>('payments.php', values, { params: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: paymentKeys.all }),
  });
}

export function usePayments(filters: PaymentFilters) {
  return useQuery({
    queryKey: paymentKeys.list(filters),
    queryFn: ({ signal }) =>
      api.get<Paginated<Payment>>('payments.php', {
        params: {
          status: filters.status || undefined,
          month: filters.month ?? undefined,
          year: filters.year ?? undefined,
          page: filters.page ?? 1,
          limit: 50,
        },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

export function usePaymentStats() {
  return useQuery({
    queryKey: paymentKeys.stats,
    queryFn: ({ signal }) => api.get<PaymentStats>('payments.php', { params: { action: 'stats' }, signal }),
  });
}

/** Mark a payment as paid today. updatePayment is a full-row update. */
export function useMarkPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Payment) => {
      const today = new Date().toISOString().slice(0, 10);
      return api.put<Payment>(
        'payments.php',
        {
          tenant_id: p.tenant_id,
          property_id: p.property_id,
          contract_id: p.contract_id ?? '',
          amount: p.amount,
          due_date: p.due_date,
          paid_date: p.paid_date ?? today,
          status: 'paid',
          notes: p.notes ?? '',
          method: 'bonifico',
        },
        { params: { id: p.id } },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: paymentKeys.all });
    },
  });
}
