import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { AgentOption, Client, ClientStats, Paginated } from '@/types/people';

export interface ClientFilters {
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export const clientKeys = {
  all: ['clients'] as const,
  list: (f: ClientFilters) => [...clientKeys.all, 'list', f] as const,
  stats: [...['clients'], 'stats'] as const,
  detail: (id: number) => [...clientKeys.all, 'detail', id] as const,
  agents: [...['clients'], 'agents'] as const,
};

export function useClients(filters: ClientFilters) {
  return useQuery({
    queryKey: clientKeys.list(filters),
    queryFn: ({ signal }) =>
      api.get<Paginated<Client>>('clients.php', {
        params: {
          search: filters.search || undefined,
          status: filters.status || undefined,
          page: filters.page ?? 1,
          limit: filters.limit ?? 25,
        },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

/** Full active-client list for a form's "select a proprietario" dropdown. */
export function useClientOptions() {
  return useQuery({
    queryKey: [...clientKeys.all, 'options'] as const,
    queryFn: ({ signal }) =>
      api.get<Paginated<Client>>('clients.php', { params: { status: 'active', page: 1, limit: 1000 }, signal }),
    staleTime: 5 * 60_000,
    select: (data) => data.items,
  });
}

export function useClientStats() {
  return useQuery({
    queryKey: clientKeys.stats,
    queryFn: ({ signal }) => api.get<ClientStats>('clients.php', { params: { action: 'stats' }, signal }),
  });
}

export function useClient(id: number | null) {
  return useQuery({
    queryKey: clientKeys.detail(id ?? 0),
    queryFn: ({ signal }) => api.get<Client>('clients.php', { params: { id: id! }, signal }),
    enabled: !!id && id > 0,
  });
}

export interface ClientFormValues {
  name: string;
  surname: string;
  codice_fiscale: string;
  phone: string;
  email: string;
  status: string;
  assigned_agent_id: string;
  internal_notes: string;
}

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: ClientFormValues) => api.post<Client>('clients.php', values),
    onSuccess: () => qc.invalidateQueries({ queryKey: clientKeys.all }),
  });
}

export function useUpdateClient(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: ClientFormValues) => api.put<Client>('clients.php', values, { params: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: clientKeys.all }),
  });
}

export function useAgents() {
  return useQuery({
    queryKey: clientKeys.agents,
    queryFn: ({ signal }) => api.get<AgentOption[]>('clients.php', { params: { action: 'agents' }, signal }),
    staleTime: 10 * 60_000,
  });
}
