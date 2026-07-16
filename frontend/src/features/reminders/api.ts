import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface Reminder {
  id: number;
  title: string;
  description: string | null;
  reminder_date: string;
  frequency: string;
  status: string;
  client_id: number | null;
  property_id: number | null;
  notify_admin: number | boolean;
  notify_client: number | boolean;
  email_subject: string | null;
  email_body: string | null;
}

export interface ReminderFormValues {
  title: string;
  description: string;
  reminder_date: string;
  frequency: string;
  status: string;
  client_id: string;
  property_id: string;
  notify_admin: boolean;
  notify_client: boolean;
  email_subject: string;
  email_body: string;
}

export const reminderKeys = {
  all: ['reminders'] as const,
  detail: (id: number) => [...reminderKeys.all, 'detail', id] as const,
};

export function useReminder(id: number | undefined) {
  return useQuery({
    queryKey: reminderKeys.detail(id ?? 0),
    queryFn: ({ signal }) => api.get<Reminder>('reminders.php', { params: { id }, signal }),
    enabled: id != null,
  });
}

export function useCreateReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: ReminderFormValues) => api.post<Reminder>('reminders.php', values),
    onSuccess: () => qc.invalidateQueries({ queryKey: reminderKeys.all }),
  });
}

export function useUpdateReminder(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: ReminderFormValues) => api.put<Reminder>('reminders.php', values, { params: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: reminderKeys.all }),
  });
}
