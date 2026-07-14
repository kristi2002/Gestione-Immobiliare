import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface PropertiesReport {
  by_status: { status: string; total: number }[];
  by_type: { property_type: string; total: number }[];
  avg_price: { price_type: string; avg_price: string; total: number }[];
}
export interface PaymentsReport {
  year: number;
  months: { month: number; expected: number; collected: number }[];
}
export interface ExpensesReport {
  year: number;
  by_category: { category: string; total: string; count: number }[];
}

function useReport<T>(type: string) {
  return useQuery({
    queryKey: ['reports', type],
    queryFn: ({ signal }) => api.get<T>('reports.php', { params: { type }, signal }),
  });
}

export const usePropertiesReport = () => useReport<PropertiesReport>('properties');
export const usePaymentsReport = () => useReport<PaymentsReport>('payments');
export const useExpensesReport = () => useReport<ExpensesReport>('expenses');
