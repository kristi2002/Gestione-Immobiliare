import { useMemo } from 'react';
import { TrendingUp, CalendarPlus, Euro, Users } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { formatCurrency, formatNumber } from '@/lib/format';
import type { Lead } from '@/types/people';
import { useBoardLeads, useLeadsList } from '../api';

const ACTIVE: Lead['status'][] = ['new', 'contacted', 'interested', 'negotiating'];

function isThisMonth(dateStr: string): boolean {
  const d = new Date(dateStr.replace(' ', 'T'));
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

export function LeadStatsBar() {
  const { byStatus, counts } = useBoardLeads();
  const { data: lost } = useLeadsList({ status: 'lost' });

  const stats = useMemo(() => {
    const all = Object.values(byStatus).flat();
    const activeLeads = ACTIVE.flatMap((s) => byStatus[s] ?? []);

    const pipelineValue = activeLeads.reduce(
      (sum, l) => sum + (Number(l.budget_max) || Number(l.budget_min) || 0),
      0,
    );
    const converted = counts.converted ?? 0;
    const lostTotal = lost?.total ?? 0;
    const closedTotal = converted + lostTotal;
    const conversion = closedTotal > 0 ? Math.round((converted / closedTotal) * 100) : 0;
    const activeCount = ACTIVE.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
    const newThisMonth = all.filter((l) => isThisMonth(l.created_at)).length;

    return { pipelineValue, conversion, activeCount, newThisMonth };
  }, [byStatus, counts, lost]);

  return (
    <Card>
      <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
        <Stat icon={TrendingUp} label="Tasso Conversione" value={`${stats.conversion}%`} progress={stats.conversion} />
        <Stat icon={CalendarPlus} label="Lead Questo Mese" value={formatNumber(stats.newThisMonth)} />
        <Stat icon={Euro} label="Valore Pipeline" value={formatCurrency(stats.pipelineValue)} />
        <Stat icon={Users} label="Lead in Pipeline" value={formatNumber(stats.activeCount)} />
      </div>
    </Card>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  progress,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  progress?: number;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-eyebrow">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className="mt-1 text-xl font-bold text-navy">{value}</p>
      {progress != null && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, progress)}%` }} />
        </div>
      )}
    </div>
  );
}
