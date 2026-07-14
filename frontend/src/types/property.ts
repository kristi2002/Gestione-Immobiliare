import type { PriceType, PropertyStatus } from './dashboard';

export type { PriceType, PropertyStatus };

export type PropertyType = 'appartamento' | 'ufficio' | 'villa' | 'negozio' | string;

/** Row shape from GET /api/properties.php (list). */
export interface PropertyListItem {
  id: number;
  client_id: number;
  address: string;
  city: string | null;
  cap: string | null;
  province: string | null;
  sqm: string | null;
  rooms: number | null;
  bathrooms: number | null;
  floor: string | null;
  year_built: number | null;
  property_type: PropertyType | null;
  status: PropertyStatus;
  price: string | null;
  price_type: PriceType | null;
  cover_media_id: number | null;
  cover_url: string | null;
  client_name: string | null;
  client_surname: string | null;
  media_count: string | number;
  photo_count: string | number;
  monthly_rent: string | null;
  created_at: string;
}

export interface PriceHistoryEntry {
  old_price: string | null;
  new_price: string | null;
  old_price_type: PriceType | null;
  new_price_type: PriceType | null;
  changed_at: string;
  changed_by_name: string | null;
}

/** Full shape from GET /api/properties.php?id={id}. Superset of the list row. */
export interface Property extends PropertyListItem {
  description: string | null;
  additional_features: string | null;
  internal_notes: string | null;
  latitude: string | null;
  longitude: string | null;
  price_history: PriceHistoryEntry[];
}

export interface PropertyMedia {
  id: number;
  property_id: number;
  media_type: 'photo' | 'floor_plan' | 'house_map' | 'document' | string;
  file_path: string;
  original_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  sort_order: number;
  url: string;
  is_cover: boolean;
  created_at: string;
}

export type PropertySort = 'default' | 'recent' | 'price_asc' | 'price_desc' | 'sqm_desc';

export interface PropertyFilters {
  search?: string;
  status?: PropertyStatus | '';
  property_type?: PropertyType | '';
  price_type?: PriceType | '';
  min_price?: number | null;
  max_price?: number | null;
  min_sqm?: number | null;
  client_id?: number | null;
  sort?: PropertySort;
  page?: number;
  limit?: number;
}

/** Paginated list envelope (after api client unwraps { success, data }). */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}
