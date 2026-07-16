import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface InventoryItem {
  id: number;
  property_id: number;
  item_name: string;
  category: string;
  quantity: number;
  condition_rating: number | null;
  check_in_date: string | null;
  check_out_date: string | null;
  notes: string | null;
  property_address: string | null;
  property_city: string | null;
}

export interface InventoryFormValues {
  property_id: string;
  item_name: string;
  category: string;
  quantity: string;
  condition_rating: string;
  check_in_date: string;
  notes: string;
}

export const inventoryKeys = {
  all: ['inventory'] as const,
  detail: (id: number) => [...inventoryKeys.all, 'detail', id] as const,
};

export function useInventoryItem(id: number | undefined) {
  return useQuery({
    queryKey: inventoryKeys.detail(id ?? 0),
    queryFn: ({ signal }) => api.get<InventoryItem>('inventory.php', { params: { id }, signal }),
    enabled: id != null,
  });
}

export function useCreateInventoryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: InventoryFormValues) => api.post<InventoryItem>('inventory.php', values),
    onSuccess: () => qc.invalidateQueries({ queryKey: inventoryKeys.all }),
  });
}

export function useUpdateInventoryItem(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: InventoryFormValues) => api.put<InventoryItem>('inventory.php', values, { params: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: inventoryKeys.all }),
  });
}
