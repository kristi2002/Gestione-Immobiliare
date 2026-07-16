import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface Appointment {
  id: number;
  property_id: number;
  lead_id: number | null;
  client_id: number | null;
  agent_id: number | null;
  appointment_date: string;
  duration_minutes: number;
  status: string;
  notes: string | null;
}

export interface AppointmentFormValues {
  property_id: string;
  lead_id: string;
  client_id: string;
  agent_id: string;
  appointment_date: string;
  duration_minutes: string;
  status: string;
  notes: string;
}

export const appointmentKeys = {
  all: ['appointments'] as const,
  detail: (id: number) => [...appointmentKeys.all, 'detail', id] as const,
};

export function useAppointment(id: number | undefined) {
  return useQuery({
    queryKey: appointmentKeys.detail(id ?? 0),
    queryFn: ({ signal }) => api.get<Appointment>('appointments.php', { params: { id }, signal }),
    enabled: id != null,
  });
}

export function useCreateAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: AppointmentFormValues) => api.post<Appointment>('appointments.php', values),
    onSuccess: () => qc.invalidateQueries({ queryKey: appointmentKeys.all }),
  });
}

export function useUpdateAppointment(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: AppointmentFormValues) => api.put<Appointment>('appointments.php', values, { params: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: appointmentKeys.all }),
  });
}
