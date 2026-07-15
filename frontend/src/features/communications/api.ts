import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Paginated } from '@/types/property';

export type CommDirection = 'sent' | 'received';
export type CommChannel = 'email' | 'whatsapp';

/** One conversation row from GET /api/communications.php?summary=1 (one per proprietario). */
export interface CommunicationSummary {
  id: number;
  name: string;
  surname: string | null;
  email: string | null;
  phone: string | null;
  message_count: number | string;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_direction: CommDirection | null;
}

/** A single message from the communications table (thread / single-message endpoints). */
export interface CommunicationMessage {
  id: number;
  client_id: number;
  direction: CommDirection;
  channel: CommChannel;
  subject: string | null;
  body: string;
  from_email: string | null;
  to_email: string | null;
  status: string;
  external_id: string | null;
  created_at: string;
  client_name?: string;
  client_surname?: string;
  client_email?: string;
}

export interface ThreadClient {
  id: number;
  name: string;
  surname: string | null;
  email: string | null;
  phone: string | null;
}

/** GET /api/communications.php?client_id={id} */
export interface CommunicationThread {
  client: ThreadClient;
  messages: CommunicationMessage[];
}

export interface SendMessagePayload {
  client_id: number;
  body: string;
  subject?: string | null;
  direction?: CommDirection;
  channel?: CommChannel;
}

export const communicationKeys = {
  all: ['communications'] as const,
  summary: (search: string) => [...communicationKeys.all, 'summary', search] as const,
  thread: (clientId: number) => [...communicationKeys.all, 'thread', clientId] as const,
};

/** All conversations (last-message preview per proprietario). Fetched wide, filtered client-side. */
export function useCommunicationsSummary(search: string) {
  return useQuery({
    queryKey: communicationKeys.summary(search),
    queryFn: ({ signal }) =>
      api.get<Paginated<CommunicationSummary>>('communications.php', {
        params: { summary: 1, limit: 100, search: search || undefined },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

/** Full thread for one proprietario. */
export function useCommunicationThread(clientId: number | null) {
  return useQuery({
    queryKey: communicationKeys.thread(clientId ?? 0),
    queryFn: ({ signal }) =>
      api.get<CommunicationThread>('communications.php', {
        params: { client_id: clientId! },
        signal,
      }),
    enabled: !!clientId && clientId > 0,
  });
}

/** Send (and log) a message. Triggers a real email/WhatsApp send on the backend. */
export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SendMessagePayload) =>
      api.post<CommunicationMessage>('communications.php', {
        direction: 'sent',
        channel: 'email',
        ...payload,
      }),
    onSuccess: (msg) => {
      qc.invalidateQueries({ queryKey: communicationKeys.thread(msg.client_id) });
      qc.invalidateQueries({ queryKey: communicationKeys.all });
    },
  });
}
