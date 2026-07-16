import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface Supplier {
  id: number;
  name: string;
  category: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  rating: number | null;
  notes: string | null;
  is_active: number;
}

export interface SupplierFormValues {
  name: string;
  category: string;
  phone: string;
  email: string;
  address: string;
  rating: string;
  notes: string;
}

export const supplierKeys = {
  all: ['suppliers'] as const,
  detail: (id: number) => [...supplierKeys.all, 'detail', id] as const,
};

export function useSupplier(id: number | undefined) {
  return useQuery({
    queryKey: supplierKeys.detail(id ?? 0),
    queryFn: ({ signal }) => api.get<Supplier>('suppliers.php', { params: { id }, signal }),
    enabled: id != null,
  });
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: SupplierFormValues) => api.post<Supplier>('suppliers.php', values),
    onSuccess: () => qc.invalidateQueries({ queryKey: supplierKeys.all }),
  });
}

/** Full supplier list for a form's "select a supplier" dropdown. */
export function useSupplierOptions() {
  return useQuery({
    queryKey: [...supplierKeys.all, 'options'] as const,
    queryFn: ({ signal }) => api.get<{ items: Supplier[] }>('suppliers.php', { params: { page: 1, limit: 1000 }, signal }),
    staleTime: 5 * 60_000,
    select: (data) => data.items,
  });
}

export function useUpdateSupplier(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: SupplierFormValues) => api.put<Supplier>('suppliers.php', values, { params: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: supplierKeys.all }),
  });
}
