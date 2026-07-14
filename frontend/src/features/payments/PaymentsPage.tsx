import { useState } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { ErrorState } from '@/components/common/ErrorState';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { usePayments, usePaymentStats } from './api';
import { PaymentKpis } from './components/PaymentKpis';
import { PaymentsTable } from './components/PaymentsTable';
import { UpcomingRentsRail } from './components/UpcomingRentsRail';

const STATUS_OPTIONS = [
  { value: 'pending', label: 'In attesa' },
  { value: 'paid', label: 'Pagato' },
  { value: 'late', label: 'In ritardo' },
  { value: 'cancelled', label: 'Annullato' },
];

const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const MONTH_OPTIONS = MONTHS.map((label, i) => ({ value: String(i + 1), label }));

export default function PaymentsPage() {
  const [status, setStatus] = useState('');
  const [month, setMonth] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  const { data: stats, isLoading: statsLoading } = usePaymentStats();
  const { data, isLoading, isError, refetch } = usePayments({ status, month, page });

  const patch = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Pagamenti"
        subtitle="Registro incassi, canoni e transazioni"
        actions={
          <Button asChild>
            <a href="/index.php?view=payment_edit">
              <Plus className="size-4" />
              Registra Pagamento
            </a>
          </Button>
        }
      />

      <PaymentKpis stats={stats} isLoading={statsLoading} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Registro */}
        <div className="space-y-4 xl:col-span-2">
          <div className="flex flex-wrap gap-3">
            <Select
              className="w-44"
              value={month != null ? String(month) : ''}
              onChange={(e) => patch(setMonth)(e.target.value ? Number(e.target.value) : null)}
              options={MONTH_OPTIONS}
              placeholder="Tutti i mesi"
            />
            <Select
              className="w-44"
              value={status}
              onChange={(e) => patch(setStatus)(e.target.value)}
              options={STATUS_OPTIONS}
              placeholder="Tutti gli stati"
            />
          </div>

          {isError ? (
            <Card>
              <ErrorState onRetry={() => refetch()} />
            </Card>
          ) : (
            <PaymentsTable items={data?.items} isLoading={isLoading} />
          )}

          {data && (
            <Pagination page={data.page} pages={data.pages} total={data.total} onPageChange={setPage} itemLabel="pagamenti" />
          )}
        </div>

        {/* Rail */}
        <div className="xl:col-span-1">
          <UpcomingRentsRail />
        </div>
      </div>
    </div>
  );
}
