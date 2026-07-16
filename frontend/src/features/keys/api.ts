import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export type KeyStatus = 'in_office' | 'out' | 'lost';

export interface PropertyKey {
  id: number;
  property_id: number;
  holder_id: number | null;
  holder_name: string | null;
  status: KeyStatus;
  location: string | null;
  handed_at: string | null;
  returned_at: string | null;
  notes: string | null;
  address: string | null;
  city: string | null;
  holder_username: string | null;
}

export interface KeyFormValues {
  property_id: string;
  holder_id: string;
  holder_name: string;
  status: KeyStatus;
  location: string;
  handed_at: string;
  returned_at: string;
  notes: string;
}

export const keyKeys = {
  all: ['property_keys'] as const,
  detail: (id: number) => [...keyKeys.all, 'detail', id] as const,
};

export function useKey(id: number | undefined) {
  return useQuery({
    queryKey: keyKeys.detail(id ?? 0),
    queryFn: ({ signal }) => api.get<PropertyKey>('property_keys.php', { params: { id }, signal }),
    enabled: id != null,
  });
}

export function useCreateKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: KeyFormValues) => api.post<PropertyKey>('property_keys.php', values),
    onSuccess: () => qc.invalidateQueries({ queryKey: keyKeys.all }),
  });
}

export function useUpdateKey(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: KeyFormValues) => api.put<PropertyKey>('property_keys.php', values, { params: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keyKeys.all }),
  });
}
