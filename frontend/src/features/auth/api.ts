import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { MeResponse } from '@/types/auth';

export const authKeys = {
  me: ['auth', 'me'] as const,
};

/** Bootstraps session identity. A 401 (logged out) is thrown, not retried. */
export function useMeQuery() {
  return useQuery({
    queryKey: authKeys.me,
    queryFn: ({ signal }) => api.get<MeResponse>('me.php', { signal }),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
