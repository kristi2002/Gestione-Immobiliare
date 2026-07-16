import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Invoice, Paginated } from '@/types/finance';

export interface InvoiceFilters {
  status?: string;
  year?: number | null;
  page?: number;
}

export const invoiceKeys = {
  all: ['invoices'] as const,
  list: (f: InvoiceFilters) => [...invoiceKeys.all, 'list', f] as const,
  detail: (id: number) => [...invoiceKeys.all, 'detail', id] as const,
};

export interface InvoiceFormValues {
  client_id: string;
  lead_id: string;
  description: string;
  amount: string;
  vat_rate: string;
  status: string;
  issue_date: string;
  due_date: string;
  paid_date: string;
  notes: string;
}

export function useInvoice(id: number | undefined) {
  return useQuery({
    queryKey: invoiceKeys.detail(id ?? 0),
    queryFn: ({ signal }) => api.get<Invoice>('invoices.php', { params: { id }, signal }),
    enabled: id != null,
  });
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: InvoiceFormValues) => api.post<Invoice>('invoices.php', values),
    onSuccess: () => qc.invalidateQueries({ queryKey: invoiceKeys.all }),
  });
}

export function useUpdateInvoice(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: InvoiceFormValues) => api.put<Invoice>('invoices.php', values, { params: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: invoiceKeys.all }),
  });
}

/** Full set (capped) for computing header KPIs — no stats endpoint exists. */
export function useInvoiceAggregate() {
  return useQuery({
    queryKey: [...invoiceKeys.all, 'aggregate'],
    queryFn: ({ signal }) => api.get<Paginated<Invoice>>('invoices.php', { params: { limit: 500 }, signal }),
    select: (data) => {
      const items = data.items;
      const sum = (pred: (i: Invoice) => boolean) =>
        items.filter(pred).reduce((s, i) => s + Number(i.total), 0);
      return {
        count: data.total,
        invoiced: sum(() => true),
        collected: sum((i) => i.status === 'paid'),
        outstanding: sum((i) => i.status === 'sent' || i.status === 'draft'),
      };
    },
  });
}

export function useInvoices(filters: InvoiceFilters) {
  return useQuery({
    queryKey: invoiceKeys.list(filters),
    queryFn: ({ signal }) =>
      api.get<Paginated<Invoice>>('invoices.php', {
        params: {
          status: filters.status || undefined,
          year: filters.year ?? undefined,
          page: filters.page ?? 1,
          limit: 25,
        },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}
