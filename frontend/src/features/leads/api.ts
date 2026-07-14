import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { AgentOption, Lead, LeadStatus, Paginated } from '@/types/people';
import { KANBAN_COLUMNS } from './config';

export const leadKeys = {
  all: ['leads'] as const,
  byStatus: (status: LeadStatus) => [...leadKeys.all, 'status', status] as const,
  list: (f: Record<string, unknown>) => [...leadKeys.all, 'list', f] as const,
  agents: [...['leads'], 'agents'] as const,
};

const PER_COLUMN = 100;

function fetchByStatus(status: LeadStatus, signal?: AbortSignal) {
  return api.get<Paginated<Lead>>('leads.php', { params: { status, limit: PER_COLUMN }, signal });
}

/** One query per pipeline column, in parallel — powers the Kanban board. */
export function useBoardLeads() {
  const results = useQueries({
    queries: KANBAN_COLUMNS.map((col) => ({
      queryKey: leadKeys.byStatus(col.status),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchByStatus(col.status, signal),
    })),
  });

  const byStatus = {} as Record<LeadStatus, Lead[]>;
  KANBAN_COLUMNS.forEach((col, i) => {
    byStatus[col.status] = results[i].data?.items ?? [];
  });

  return {
    byStatus,
    counts: Object.fromEntries(KANBAN_COLUMNS.map((c, i) => [c.status, results[i].data?.total ?? 0])),
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
    refetch: () => results.forEach((r) => r.refetch()),
  };
}

/** Flat list (for the table view + stats). */
export function useLeadsList(filters: { search?: string; status?: string; page?: number }) {
  return useQuery({
    queryKey: leadKeys.list(filters),
    queryFn: ({ signal }) =>
      api.get<Paginated<Lead>>('leads.php', {
        params: {
          search: filters.search || undefined,
          status: filters.status || undefined,
          page: filters.page ?? 1,
          limit: 50,
        },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useLeadAgents() {
  return useQuery({
    queryKey: leadKeys.agents,
    queryFn: ({ signal }) => api.get<AgentOption[]>('leads.php', { params: { action: 'agents' }, signal }),
    staleTime: 10 * 60_000,
  });
}

/** Map a lead to the full body updateLead() expects (it is not a partial PATCH). */
function leadToBody(lead: Lead, status: LeadStatus) {
  return {
    name: lead.name,
    surname: lead.surname ?? '',
    codice_fiscale: lead.codice_fiscale ?? '',
    phone: lead.phone ?? '',
    email: lead.email ?? '',
    interest_type: lead.interest_type,
    budget_min: lead.budget_min ?? '',
    budget_max: lead.budget_max ?? '',
    preferred_city: lead.preferred_city ?? '',
    preferred_type: lead.preferred_type ?? '',
    min_rooms: lead.min_rooms ?? '',
    min_sqm: lead.min_sqm ?? '',
    status,
    source: lead.source,
    assigned_to: lead.assigned_to ?? '',
    notes: lead.notes ?? '',
  };
}

interface MoveVars {
  lead: Lead;
  toStatus: LeadStatus;
}

/** Move a lead between pipeline stages, optimistically updating both columns. */
export function useMoveLead() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ lead, toStatus }: MoveVars) =>
      api.put<Lead>('leads.php', leadToBody(lead, toStatus), { params: { id: lead.id } }),

    onMutate: async ({ lead, toStatus }: MoveVars) => {
      const from = lead.status;
      if (from === toStatus) return;

      await Promise.all([
        qc.cancelQueries({ queryKey: leadKeys.byStatus(from) }),
        qc.cancelQueries({ queryKey: leadKeys.byStatus(toStatus) }),
      ]);

      const prevFrom = qc.getQueryData<Paginated<Lead>>(leadKeys.byStatus(from));
      const prevTo = qc.getQueryData<Paginated<Lead>>(leadKeys.byStatus(toStatus));

      qc.setQueryData<Paginated<Lead>>(leadKeys.byStatus(from), (old) =>
        old ? { ...old, items: old.items.filter((l) => l.id !== lead.id), total: Math.max(0, old.total - 1) } : old,
      );
      qc.setQueryData<Paginated<Lead>>(leadKeys.byStatus(toStatus), (old) =>
        old ? { ...old, items: [{ ...lead, status: toStatus }, ...old.items], total: old.total + 1 } : old,
      );

      return { prevFrom, prevTo, from, toStatus };
    },

    onError: (_err, _vars, ctx) => {
      if (!ctx) return;
      qc.setQueryData(leadKeys.byStatus(ctx.from), ctx.prevFrom);
      qc.setQueryData(leadKeys.byStatus(ctx.toStatus), ctx.prevTo);
    },

    onSettled: (_data, _err, vars, ctx) => {
      qc.invalidateQueries({ queryKey: leadKeys.byStatus(vars.toStatus) });
      if (ctx?.from) qc.invalidateQueries({ queryKey: leadKeys.byStatus(ctx.from) });
    },
  });
}
