import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { DashboardStats } from '@/types/dashboard';

export const dashboardKeys = {
  stats: ['dashboard', 'stats'] as const,
};

export function useDashboardStats() {
  return useQuery({
    queryKey: dashboardKeys.stats,
    queryFn: ({ signal }) => api.get<DashboardStats>('get_dashboard_stats.php', { signal }),
  });
}
