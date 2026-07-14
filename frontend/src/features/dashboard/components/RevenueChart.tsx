import { useMemo } from 'react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/format';
import type { MonthlyRevenuePoint } from '@/types/dashboard';

const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

interface Props {
  data: MonthlyRevenuePoint[] | undefined;
  year: number | undefined;
  isLoading: boolean;
}

/** "Andamento Entrate" — monthly paid revenue for the anchor year. */
export function RevenueChart({ data, year, isLoading }: Props) {
  const series = useMemo(() => {
    const byMonth = new Map<number, number>();
    for (const p of data ?? []) {
      const month = Number(p.ym.split('-')[1]) - 1;
      byMonth.set(month, Number(p.revenue));
    }
    return MONTHS.map((label, i) => ({ month: label, revenue: byMonth.get(i) ?? 0 }));
  }, [data]);

  return (
    <Card className="h-full">
      <CardHeader>
        <div>
          <CardTitle>Andamento Entrate</CardTitle>
          <p className="mt-0.5 text-xs text-muted">Incassato mensile</p>
        </div>
        <Badge variant="primary">{year ?? '—'}</Badge>
      </CardHeader>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <ResponsiveContainer width="100%" height={256}>
          <AreaChart data={series} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0B3D91" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#0B3D91" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F8" vertical={false} />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: '#6B7280' }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={48}
              tick={{ fontSize: 12, fill: '#6B7280' }}
              tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))}
            />
            <Tooltip
              cursor={{ stroke: '#4A90D9', strokeWidth: 1 }}
              formatter={(value: number) => [formatCurrency(value), 'Entrate']}
              contentStyle={{
                borderRadius: 12,
                border: '1px solid #E5E7EB',
                boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
                fontSize: 13,
              }}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="#0B3D91"
              strokeWidth={2.5}
              fill="url(#revFill)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
