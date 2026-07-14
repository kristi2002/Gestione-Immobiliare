import { keepPreviousData, useQuery } from '@tanstack/react-query';
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
};

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
