import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface Building {
  id: number;
  name: string;
  city: string;
  address: string;
  total_units: number | null;
  notes: string | null;
  unit_count: string | number;
  occupancy_count: string | number;
}

export interface BuildingFormValues {
  name: string;
  city: string;
  address: string;
  total_units: string;
  notes: string;
}

export const buildingKeys = {
  all: ['buildings'] as const,
  detail: (id: number) => [...buildingKeys.all, 'detail', id] as const,
};

export function useBuilding(id: number | undefined) {
  return useQuery({
    queryKey: buildingKeys.detail(id ?? 0),
    queryFn: ({ signal }) => api.get<Building>('buildings.php', { params: { id }, signal }),
    enabled: id != null,
  });
}

export function useCreateBuilding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: BuildingFormValues) => api.post<Building>('buildings.php', values),
    onSuccess: () => qc.invalidateQueries({ queryKey: buildingKeys.all }),
  });
}

export function useUpdateBuilding(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: BuildingFormValues) => api.put<Building>('buildings.php', values, { params: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: buildingKeys.all }),
  });
}
