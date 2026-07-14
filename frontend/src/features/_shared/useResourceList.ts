import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Paginated } from '@/types/property';

export type ResourceParams = Record<string, string | number | undefined | null>;

/** Generic paginated list query for the standard `{items,total,page,limit,pages}` endpoints. */
export function useResourceList<T>(endpoint: string, params: ResourceParams) {
  const clean: ResourceParams = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') clean[k] = v;
  }
  return useQuery({
    queryKey: [endpoint, clean],
    queryFn: ({ signal }) => api.get<Paginated<T>>(endpoint, { params: clean, signal }),
    placeholderData: keepPreviousData,
  });
}
