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
  /** Partial key matching every filter combination for a status — used to
   * invalidate/update the board's cache without needing to know which
   * filters are currently active. */
  byStatusPrefix: (status: LeadStatus) => [...leadKeys.all, 'status', status] as const,
  byStatus: (status: LeadStatus, f: LeadBoardFilters) => [...leadKeys.byStatusPrefix(status), f] as const,
  list: (f: Record<string, unknown>) => [...leadKeys.all, 'list', f] as const,
  detail: (id: number) => [...leadKeys.all, 'detail', id] as const,
  agents: [...['leads'], 'agents'] as const,
};

const PER_COLUMN = 100;

export interface LeadBoardFilters {
  search?: string;
  interest_type?: string;
}

function fetchByStatus(status: LeadStatus, filters: LeadBoardFilters, signal?: AbortSignal) {
  return api.get<Paginated<Lead>>('leads.php', {
    params: {
      status,
      search: filters.search || undefined,
      interest_type: filters.interest_type || undefined,
      limit: PER_COLUMN,
    },
    signal,
  });
}

/**
 * One query per pipeline column, in parallel — powers the Kanban board.
 * Search + interest filter apply across all columns; status doesn't (the
 * columns already partition by status), matching the legacy PHP toolbar.
 */
export function useBoardLeads(filters: LeadBoardFilters = {}) {
  const results = useQueries({
    queries: KANBAN_COLUMNS.map((col) => ({
      queryKey: leadKeys.byStatus(col.status, filters),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchByStatus(col.status, filters, signal),
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
export function useLeadsList(filters: { search?: string; status?: string; interest_type?: string; page?: number }) {
  return useQuery({
    queryKey: leadKeys.list(filters),
    queryFn: ({ signal }) =>
      api.get<Paginated<Lead>>('leads.php', {
        params: {
          search: filters.search || undefined,
          status: filters.status || undefined,
          interest_type: filters.interest_type || undefined,
          page: filters.page ?? 1,
          limit: 50,
        },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

/** Full lead list for a form's "select a lead" dropdown. */
export function useLeadOptions() {
  return useQuery({
    queryKey: [...leadKeys.all, 'options'] as const,
    queryFn: ({ signal }) => api.get<Paginated<Lead>>('leads.php', { params: { page: 1, limit: 1000 }, signal }),
    staleTime: 5 * 60_000,
    select: (data) => data.items,
  });
}

export function useLeadAgents() {
  return useQuery({
    queryKey: leadKeys.agents,
    queryFn: ({ signal }) => api.get<AgentOption[]>('leads.php', { params: { action: 'agents' }, signal }),
    staleTime: 10 * 60_000,
  });
}

export function useLead(id: number | undefined) {
  return useQuery({
    queryKey: leadKeys.detail(id ?? 0),
    queryFn: ({ signal }) => api.get<Lead>('leads.php', { params: { id }, signal }),
    enabled: id != null,
  });
}

/** Body shape for create/update — matches validateLeadInput() in api/leads.php. */
export interface LeadFormValues {
  name: string;
  surname: string;
  codice_fiscale: string;
  phone: string;
  email: string;
  interest_type: string;
  budget_min: string;
  budget_max: string;
  preferred_city: string;
  preferred_type: string;
  min_rooms: string;
  min_sqm: string;
  status: string;
  source: string;
  assigned_to: string;
  notes: string;
}

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: LeadFormValues) => api.post<Lead>('leads.php', values),
    onSuccess: () => qc.invalidateQueries({ queryKey: leadKeys.all }),
  });
}

export function useUpdateLead(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: LeadFormValues) => api.put<Lead>('leads.php', values, { params: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: leadKeys.all }),
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

      // Partial-key matching: the board may have several cached queries per
      // status (one per active search/interest filter combination) — update
      // and roll back all of them, not just one specific filter's entry.
      await Promise.all([
        qc.cancelQueries({ queryKey: leadKeys.byStatusPrefix(from) }),
        qc.cancelQueries({ queryKey: leadKeys.byStatusPrefix(toStatus) }),
      ]);

      const prevFrom = qc.getQueriesData<Paginated<Lead>>({ queryKey: leadKeys.byStatusPrefix(from) });
      const prevTo = qc.getQueriesData<Paginated<Lead>>({ queryKey: leadKeys.byStatusPrefix(toStatus) });

      qc.setQueriesData<Paginated<Lead>>({ queryKey: leadKeys.byStatusPrefix(from) }, (old) =>
        old ? { ...old, items: old.items.filter((l) => l.id !== lead.id), total: Math.max(0, old.total - 1) } : old,
      );
      qc.setQueriesData<Paginated<Lead>>({ queryKey: leadKeys.byStatusPrefix(toStatus) }, (old) =>
        old ? { ...old, items: [{ ...lead, status: toStatus }, ...old.items], total: old.total + 1 } : old,
      );

      return { prevFrom, prevTo, from, toStatus };
    },

    onError: (_err, _vars, ctx) => {
      if (!ctx) return;
      ctx.prevFrom.forEach(([key, data]) => qc.setQueryData(key, data));
      ctx.prevTo.forEach(([key, data]) => qc.setQueryData(key, data));
    },

    onSettled: (_data, _err, vars, ctx) => {
      qc.invalidateQueries({ queryKey: leadKeys.byStatusPrefix(vars.toStatus) });
      if (ctx?.from) qc.invalidateQueries({ queryKey: leadKeys.byStatusPrefix(ctx.from) });
    },
  });
}
