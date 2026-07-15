import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface Automation {
  id: number;
  name: string;
  description: string;
  trigger: string;
  actions: string;
  color: string | null;
  active: boolean;
  run_count: number;
}

export interface AutomationStats {
  active_count: number;
  total_runs: number;
  hours_saved: number;
}

export interface AutomationsData {
  items: Automation[];
  stats: AutomationStats;
}

export const automationKeys = {
  all: ['automations'] as const,
};

export function useAutomations() {
  return useQuery({
    queryKey: automationKeys.all,
    queryFn: ({ signal }) => api.get<AutomationsData>('automations.php', { signal }),
  });
}

interface ToggleVars {
  id: number;
  active: boolean;
}

/** Toggle an automation on/off, then refresh the list + stats. */
export function useToggleAutomation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, active }: ToggleVars) =>
      api.put<{ id: number; active: boolean }>('automations.php', { id, active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: automationKeys.all });
    },
  });
}
