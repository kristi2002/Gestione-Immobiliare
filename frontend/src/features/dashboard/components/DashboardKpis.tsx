import { Building2, Tag, KeyRound, Target } from 'lucide-react';
import { KpiCard, KpiCardSkeleton } from '@/components/common/KpiCard';
import { formatNumber } from '@/lib/format';
import type { DashboardStats } from '@/types/dashboard';
import { sparkSeries, trendFromSeries } from '../utils';

interface Props {
  stats: DashboardStats | undefined;
  isLoading: boolean;
}

export function DashboardKpis({ stats, isLoading }: Props) {
  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const propSpark = sparkSeries(stats.property_spark, 'n');
  const saleSpark = sparkSeries(stats.property_spark, 'n_sale');
  const rentSpark = sparkSeries(stats.property_spark, 'n_rent');
  const leadSpark = sparkSeries(stats.lead_spark, 'n');

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label="Immobili Totali"
        value={formatNumber(stats.total_properties)}
        icon={Building2}
        accent="primary"
        caption="in portafoglio"
        trend={{ value: trendFromSeries(propSpark) }}
        sparkData={propSpark}
      />
      <KpiCard
        label="In Vendita"
        value={formatNumber(stats.properties_for_sale)}
        icon={Tag}
        accent="secondary"
        caption="annunci attivi"
        trend={{ value: trendFromSeries(saleSpark) }}
        sparkData={saleSpark}
      />
      <KpiCard
        label="In Affitto"
        value={formatNumber(stats.properties_for_rent)}
        icon={KeyRound}
        accent="success"
        caption="annunci attivi"
        trend={{ value: trendFromSeries(rentSpark) }}
        sparkData={rentSpark}
      />
      <KpiCard
        label="Leads Attivi"
        value={formatNumber(stats.total_leads)}
        icon={Target}
        accent="warning"
        caption={`+${formatNumber(stats.leads_new_month)} questo mese`}
        trend={{ value: trendFromSeries(leadSpark) }}
        sparkData={leadSpark}
      />
    </div>
  );
}
