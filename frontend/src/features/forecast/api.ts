import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface ForecastData {
  months: number;
  stats: {
    expected_next_6m: number;
    avg_occupancy_rate: number;
    overdue_total: number;
    top_property_address: string;
  };
  monthly: { month: string; label: string; expected: number; confirmed: number; occupancy_rate: number }[];
  top_properties: { property_id: number; address: string; income_12m: number }[];
  overdue: unknown[];
}

export function useForecast() {
  return useQuery({
    queryKey: ['forecast'],
    queryFn: ({ signal }) => api.get<ForecastData>('forecast.php', { signal }),
  });
}
