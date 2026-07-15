import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

/** The portals tracked by api/portal_sync.php (ENUM order). */
export const PORTAL_KEYS = [
  'immobiliare',
  'idealista',
  'casa',
  'subito',
  'sito_agenzia',
  'altro',
] as const;
export type PortalKey = (typeof PORTAL_KEYS)[number];

/** Per-portal sync states supported by the backend. */
export type PortalStatus = 'draft' | 'publishing' | 'published' | 'error' | 'removed';

/** One row of `portal_listings` joined with its property (SELECT pl.*, p.address, p.city). */
export interface PortalListing {
  id: number;
  property_id: number;
  portal: PortalKey;
  status: PortalStatus;
  external_id: string | null;
  external_url: string | null;
  last_synced_at: string | null;
  error_message: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  property_address: string | null;
  property_city: string | null;
}

export interface PortalStats {
  total: number;
  published: number;
  errors: number;
  pending: number;
}

/** Shape returned by GET /api/portal_sync.php (paginated + aggregate stats). */
export interface PortalSyncResponse {
  items: PortalListing[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  stats: PortalStats;
}

export function usePortalListings() {
  return useQuery({
    queryKey: ['portal-listings'],
    // Pull a full page (max 100) so per-portal cards + chart are accurate for a
    // single-agency dataset; the table groups these rows by property client-side.
    queryFn: ({ signal }) =>
      api.get<PortalSyncResponse>('portal_sync.php', { params: { limit: 100 }, signal }),
  });
}
