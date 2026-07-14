import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { AgentPortfolio } from '@/types/people';

export const agentKeys = {
  all: ['agents'] as const,
  portfolio: [...['agents'], 'portfolio'] as const,
};

export function useAgentPortfolio() {
  return useQuery({
    queryKey: agentKeys.portfolio,
    queryFn: ({ signal }) => api.get<AgentPortfolio[]>('agent_portfolio.php', { signal }),
  });
}
