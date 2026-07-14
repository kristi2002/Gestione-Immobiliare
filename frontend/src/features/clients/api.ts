import { keepPreviousData, useQuery } from '@tanstack/react-query';
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

export function useAgents() {
  return useQuery({
    queryKey: clientKeys.agents,
    queryFn: ({ signal }) => api.get<AgentOption[]>('clients.php', { params: { action: 'agents' }, signal }),
    staleTime: 10 * 60_000,
  });
}
