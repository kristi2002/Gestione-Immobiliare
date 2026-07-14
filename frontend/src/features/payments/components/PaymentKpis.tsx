import { TrendingUp, Clock, AlertCircle, CalendarClock } from 'lucide-react';
import { KpiCard, KpiCardSkeleton } from '@/components/common/KpiCard';
import { formatCurrency, formatNumber } from '@/lib/format';
import type { PaymentStats } from '@/types/finance';

export function PaymentKpis({ stats, isLoading }: { stats: PaymentStats | undefined; isLoading: boolean }) {
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
      <KpiCard label="Incassato (mese)" value={formatCurrency(stats.paid_month)} icon={TrendingUp} accent="success" />
      <KpiCard label="In Attesa (mese)" value={formatCurrency(stats.pending_month)} icon={Clock} accent="warning" />
      <KpiCard label="Morosità" value={formatCurrency(stats.late_total)} icon={AlertCircle} accent="warning" />
      <KpiCard
        label="Pagamenti in Ritardo"
        value={formatNumber(stats.late_count)}
        icon={CalendarClock}
        accent="primary"
      />
    </div>
  );
}
