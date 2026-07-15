import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Paginated } from '@/types/property';

/** One conversation thread, grouped by phone number (GET ?threads=1). */
export interface WhatsappThread {
  phone: string;
  last_at: string | null;
  last_message: string | null;
  /** PDO SUM() comes back as a numeric string. */
  unread_count: number | string | null;
  contact_name: string | null;
}

/** A single WhatsApp message row (GET ?thread=<phone>). */
export interface WhatsappMessage {
  id: number;
  direction: 'inbound' | 'outbound';
  from_number: string | null;
  to_number: string | null;
  body: string | null;
  media_url: string | null;
  twilio_sid: string | null;
  client_id: number | null;
  tenant_id: number | null;
  is_read: number | boolean;
  received_at: string;
  client_name: string | null;
  client_surname: string | null;
  tenant_name: string | null;
  tenant_surname: string | null;
}

export const whatsappKeys = {
  all: ['whatsapp'] as const,
  threads: ['whatsapp', 'threads'] as const,
  thread: (phone: string) => ['whatsapp', 'thread', phone] as const,
};

/** All conversations (one row per phone number). Non-paginated array. */
export function useWhatsappThreads() {
  return useQuery({
    queryKey: whatsappKeys.threads,
    queryFn: ({ signal }) =>
      api.get<WhatsappThread[]>('whatsapp_inbox.php', { params: { threads: 1 }, signal }),
  });
}

/** Full message thread with one phone number, oldest → newest. */
export function useWhatsappThread(phone: string | null) {
  return useQuery({
    queryKey: whatsappKeys.thread(phone ?? ''),
    queryFn: ({ signal }) =>
      api.get<Paginated<WhatsappMessage>>('whatsapp_inbox.php', {
        params: { thread: phone!, limit: 200 },
        signal,
      }),
    enabled: !!phone,
    placeholderData: keepPreviousData,
  });
}

interface SendPayload {
  phone: string;
  message: string;
}

/** Send an outbound WhatsApp message (Twilio). Sandbox/demo integration. */
export function useSendWhatsapp(phone: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SendPayload) =>
      api.post<{ status: string; external_id: string; message: string }>('whatsapp_send.php', payload),
    onSuccess: () => {
      if (phone) qc.invalidateQueries({ queryKey: whatsappKeys.thread(phone) });
      qc.invalidateQueries({ queryKey: whatsappKeys.threads });
    },
  });
}

/** Mark all inbound messages from a phone number as read. */
export function useMarkThreadRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (phone: string) =>
      api.patch<{ phone: string; marked_read: number }>('whatsapp_inbox.php', undefined, {
        params: { phone },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: whatsappKeys.threads });
    },
  });
}
