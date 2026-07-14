import { PageHeader } from '@/components/common/PageHeader';
import { ErrorState } from '@/components/common/ErrorState';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/features/auth/useAuth';
import { capitalize, formatDateLong } from '@/lib/format';
import { useDashboardStats } from './api';
import { DashboardKpis } from './components/DashboardKpis';
import { RevenueChart } from './components/RevenueChart';
import { TodayAppointments } from './components/TodayAppointments';
import { RecentProperties } from './components/RecentProperties';

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading, isError, refetch } = useDashboardStats();

  const greeting = `Bentornato, ${capitalize(user.username)} · ${capitalize(formatDateLong(new Date()))}`;

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader title="Dashboard" subtitle={greeting} />

      {isError ? (
        <Card>
          <ErrorState onRetry={() => refetch()} />
        </Card>
      ) : (
        <>
          <DashboardKpis stats={data} isLoading={isLoading} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <RevenueChart data={data?.monthly_revenue} year={data?.chart_year} isLoading={isLoading} />
            </div>
            <div>
              <TodayAppointments data={data?.appointments_today} isLoading={isLoading} />
            </div>
          </div>

          <RecentProperties data={data?.recent_properties} isLoading={isLoading} />
        </>
      )}
    </div>
  );
}
