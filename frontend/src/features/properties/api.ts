import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type {
  Paginated,
  Property,
  PropertyFilters,
  PropertyListItem,
  PropertyMedia,
} from '@/types/property';

export const propertyKeys = {
  all: ['properties'] as const,
  list: (filters: PropertyFilters) => [...propertyKeys.all, 'list', filters] as const,
  detail: (id: number) => [...propertyKeys.all, 'detail', id] as const,
  media: (id: number) => [...propertyKeys.all, 'media', id] as const,
};

/** Translate typed filters into the query params properties.php understands. */
function toParams(filters: PropertyFilters): Record<string, string | number | undefined> {
  return {
    search: filters.search || undefined,
    status: filters.status || undefined,
    property_type: filters.property_type || undefined,
    price_type: filters.price_type || undefined,
    min_price: filters.min_price ?? undefined,
    max_price: filters.max_price ?? undefined,
    min_sqm: filters.min_sqm ?? undefined,
    client_id: filters.client_id ?? undefined,
    sort: filters.sort && filters.sort !== 'default' ? filters.sort : undefined,
    page: filters.page ?? 1,
    limit: filters.limit ?? 24,
  };
}

export function useProperties(filters: PropertyFilters) {
  return useQuery({
    queryKey: propertyKeys.list(filters),
    queryFn: ({ signal }) =>
      api.get<Paginated<PropertyListItem>>('properties.php', { params: toParams(filters), signal }),
    placeholderData: keepPreviousData,
  });
}

export function useProperty(id: number) {
  return useQuery({
    queryKey: propertyKeys.detail(id),
    queryFn: ({ signal }) => api.get<Property>('properties.php', { params: { id }, signal }),
    enabled: Number.isFinite(id) && id > 0,
  });
}

export function usePropertyMedia(id: number) {
  return useQuery({
    queryKey: propertyKeys.media(id),
    queryFn: ({ signal }) =>
      api.get<PropertyMedia[]>('property_media.php', { params: { property_id: id }, signal }),
    enabled: Number.isFinite(id) && id > 0,
  });
}
