import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface Expense {
  id: number;
  category: string;
  amount: string;
  description: string;
  expense_date: string;
  property_id: number | null;
  client_id: number | null;
  supplier_id: number | null;
  receipt_url: string | null;
  notes: string | null;
}

export interface ExpenseFormValues {
  category: string;
  amount: string;
  description: string;
  expense_date: string;
  property_id: string;
  client_id: string;
  supplier_id: string;
  receipt_url: string;
  notes: string;
}

export const expenseKeys = {
  all: ['expenses'] as const,
  detail: (id: number) => [...expenseKeys.all, 'detail', id] as const,
};

export function useExpense(id: number | undefined) {
  return useQuery({
    queryKey: expenseKeys.detail(id ?? 0),
    queryFn: ({ signal }) => api.get<Expense>('expenses.php', { params: { id }, signal }),
    enabled: id != null,
  });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: ExpenseFormValues) => api.post<Expense>('expenses.php', values),
    onSuccess: () => qc.invalidateQueries({ queryKey: expenseKeys.all }),
  });
}

export function useUpdateExpense(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: ExpenseFormValues) => api.put<Expense>('expenses.php', values, { params: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: expenseKeys.all }),
  });
}
