import type { SparkPoint } from '@/types/dashboard';

/** Extract a numeric series from spark points for the KPI sparklines. */
export function sparkSeries(points: SparkPoint[], field: 'n' | 'n_sale' | 'n_rent' = 'n'): number[] {
  return points.map((p) => Number(p[field] ?? 0));
}

/** Month-over-month percentage change from the last two points of a series. */
export function trendFromSeries(series: number[]): number {
  if (series.length < 2) return 0;
  const prev = series[series.length - 2];
  const curr = series[series.length - 1];
  if (prev === 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
}
