import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { TrendingUp, Percent, AlertCircle, Building2, Trophy } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { ErrorState } from '@/components/common/ErrorState';
import { KpiCard, KpiCardSkeleton } from '@/components/common/KpiCard';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { formatCurrency } from '@/lib/format';
import { useForecast } from './api';

export default function ForecastPage() {
  const { data, isLoading, isError, refetch } = useForecast();

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader title="Previsioni" subtitle="Proiezione incassi e occupazione" />

      {isError ? (
        <Card>
          <ErrorState onRetry={() => refetch()} />
        </Card>
      ) : isLoading || !data?.stats ? (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <KpiCardSkeleton key={i} />
            ))}
          </div>
          <Skeleton className="h-80 w-full rounded-2xl" />
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <KpiCard
              label="Previsione 6 mesi"
              value={formatCurrency(data.stats.expected_next_6m)}
              icon={TrendingUp}
              accent="primary"
            />
            <KpiCard
              label="Occupazione media"
              value={`${data.stats.avg_occupancy_rate}%`}
              icon={Percent}
              accent="success"
            />
            <KpiCard
              label="Insoluti totali"
              value={formatCurrency(data.stats.overdue_total)}
              icon={AlertCircle}
              accent="warning"
            />
          </div>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Proiezione incassi</CardTitle>
                <p className="mt-0.5 text-xs text-muted">Attesi vs confermati · prossimi {data.months} mesi</p>
              </div>
            </CardHeader>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.monthly} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F8" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#6B7280' }} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tick={{ fontSize: 12, fill: '#6B7280' }}
                  tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                />
                <Tooltip
                  formatter={(v: number, name) => [formatCurrency(v), name === 'expected' ? 'Attesi' : 'Confermati']}
                  contentStyle={{ borderRadius: 12, border: '1px solid #E5E7EB', fontSize: 13 }}
                />
                <Legend
                  formatter={(v) => (v === 'expected' ? 'Attesi' : 'Confermati')}
                  iconType="circle"
                  wrapperStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="expected" fill="#4A90D9" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="confirmed" fill="#0B3D91" radius={[6, 6, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="size-4 text-warning" />
                Immobili più redditizi (12 mesi)
              </CardTitle>
            </CardHeader>
            {data.top_properties.length === 0 ? (
              <EmptyState icon={Building2} title="Nessun dato" />
            ) : (
              <ul className="divide-y divide-gray-100">
                {data.top_properties.slice(0, 6).map((p, i) => (
                  <li key={p.property_id} className="flex items-center gap-3 py-3">
                    <span className="flex size-7 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-navy">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-navy">{p.address}</span>
                    <span className="shrink-0 font-semibold text-primary">{formatCurrency(p.income_12m)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
