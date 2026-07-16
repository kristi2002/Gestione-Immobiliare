import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export type MeterType = 'gas' | 'electricity' | 'water' | 'heating';

export interface MeterReading {
  id: number;
  property_id: number;
  meter_type: MeterType;
  reading_value: string;
  reading_date: string;
  notes: string | null;
  property_address: string | null;
}

export interface MeterFormValues {
  property_id: string;
  meter_type: MeterType;
  reading_value: string;
  reading_date: string;
  notes: string;
}

export const meterKeys = {
  all: ['meter_readings'] as const,
  detail: (id: number) => [...meterKeys.all, 'detail', id] as const,
};

export function useMeterReading(id: number | undefined) {
  return useQuery({
    queryKey: meterKeys.detail(id ?? 0),
    queryFn: ({ signal }) => api.get<MeterReading>('meter_readings.php', { params: { id }, signal }),
    enabled: id != null,
  });
}

export function useCreateMeterReading() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: MeterFormValues) => api.post<MeterReading>('meter_readings.php', values),
    onSuccess: () => qc.invalidateQueries({ queryKey: meterKeys.all }),
  });
}

export function useUpdateMeterReading(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: MeterFormValues) => api.put<MeterReading>('meter_readings.php', values, { params: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: meterKeys.all }),
  });
}
