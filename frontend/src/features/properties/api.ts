import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

export interface PropertyFormValues {
  client_id: string;
  status: string;
  address: string;
  city: string;
  cap: string;
  province: string;
  reference_code: string;
  floor: string;
  total_floors: string;
  exposure: string;
  property_type: string;
  condition_state: string;
  year_built: string;
  sqm: string;
  locali: string;
  rooms: string;
  bathrooms: string;
  balconies: string;
  terraces: string;
  parking_spaces: string;
  garden: string;
  energy_class: string;
  heating: string;
  furnished: string;
  elevator: string;
  price: string;
  price_type: string;
  condo_fees: string;
  latitude: string;
  longitude: string;
  cadastral_comune: string;
  cadastral_category: string;
  cadastral_class: string;
  cadastral_foglio: string;
  cadastral_particella: string;
  cadastral_subalterno: string;
  cadastral_zone: string;
  cadastral_rendita: string;
  ape_number: string;
  ape_issue_date: string;
  ape_expiry_date: string;
  ipe_value: string;
  description: string;
  additional_features: string;
  internal_notes: string;
}

export function useCreateProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: PropertyFormValues) => api.post<Property>('properties.php', values),
    onSuccess: () => qc.invalidateQueries({ queryKey: propertyKeys.all }),
  });
}

export function useUpdateProperty(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: PropertyFormValues) => api.put<Property>('properties.php', values, { params: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: propertyKeys.all }),
  });
}

/** Full property list for a form's "select a property" dropdown — every
 * entity that references a property (keys, meters, inventory, insurance,
 * reminders, appointments, expenses, documents, contracts…) reuses this. */
export function usePropertyOptions() {
  return useQuery({
    queryKey: [...propertyKeys.all, 'options'] as const,
    queryFn: ({ signal }) =>
      api.get<Paginated<PropertyListItem>>('properties.php', { params: { page: 1, limit: 1000 }, signal }),
    staleTime: 5 * 60_000,
    select: (data) => data.items,
  });
}
