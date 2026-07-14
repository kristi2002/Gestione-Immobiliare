import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface SettingsData {
  branding: {
    agency_name: string;
    agency_tagline: string;
    agency_phone: string;
    agency_address: string;
    logo_path: string;
    primary_color: string;
    sidebar_color: string;
  };
  mail: Record<string, string>;
  whatsapp: Record<string, string>;
  backup: Record<string, string>;
  meta: Record<string, string>;
  fatturazione: Record<string, string>;
  twofa: { enabled: boolean | string };
}

export const settingsKeys = { all: ['settings'] as const };

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.all,
    queryFn: ({ signal }) => api.get<SettingsData>('settings.php', { signal }),
  });
}

/** Save one settings section. Payload = { section, ...fields }. */
export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown> & { section: string }) => api.put('settings.php', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.all }),
  });
}

/** A setting stored as 'true'/'false'/'1' string is truthy. */
export function isEnabled(v: unknown): boolean {
  return v === true || v === 'true' || v === '1' || v === 1;
}
