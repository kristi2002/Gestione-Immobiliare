import { Users, Building2, UserPlus, CheckCircle2 } from 'lucide-react';
import { KpiCard, KpiCardSkeleton } from '@/components/common/KpiCard';
import { formatNumber } from '@/lib/format';
import type { ClientStats } from '@/types/people';

export function ClientKpis({ stats, isLoading }: { stats: ClientStats | undefined; isLoading: boolean }) {
  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Proprietari Totali" value={formatNumber(stats.total)} icon={Users} accent="primary" />
      <KpiCard
        label="Con Immobili Attivi"
        value={formatNumber(stats.with_properties)}
        icon={Building2}
        accent="secondary"
      />
      <KpiCard
        label="Nuovi questo mese"
        value={formatNumber(stats.new_month)}
        icon={UserPlus}
        accent="success"
      />
      <KpiCard label="Attivi" value={formatNumber(stats.active)} icon={CheckCircle2} accent="warning" />
    </div>
  );
}
