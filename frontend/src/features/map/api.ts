import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Paginated, PropertyListItem } from '@/types/property';

export const mapKeys = {
  all: ['map'] as const,
  properties: (limit: number) => [...mapKeys.all, 'properties', limit] as const,
};

/** Fetch the portfolio for the map (a generous page — client-side filtered). */
export function useMapProperties(limit = 200) {
  return useQuery({
    queryKey: mapKeys.properties(limit),
    queryFn: ({ signal }) =>
      api.get<Paginated<PropertyListItem>>('properties.php', {
        params: { limit },
        signal,
      }),
  });
}
