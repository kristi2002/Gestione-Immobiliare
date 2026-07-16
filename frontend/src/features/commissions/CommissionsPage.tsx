import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Plus, Briefcase, Clock, CheckCircle2, Hash } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { ErrorState } from '@/components/common/ErrorState';
import { KpiCard, KpiCardSkeleton } from '@/components/common/KpiCard';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { StatusBadge } from '@/components/common/StatusBadge';
import { DataTable, type Column } from '@/components/common/DataTable';
import { formatCurrency, formatCurrencyCents, formatNumber, initials } from '@/lib/format';
import type { Commission } from '@/types/finance';
import { COMMISSION_TYPE_LABEL } from '@/features/finance-labels';
import { useCommissions } from './api';

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Da pagare' },
  { value: 'paid', label: 'Pagata' },
  { value: 'cancelled', label: 'Annullata' },
];

const TYPE_OPTIONS = [
  { value: 'vendita', label: 'Vendita' },
  { value: 'locazione', label: 'Locazione' },
  { value: 'affitto', label: 'Affitto' },
  { value: 'gestione', label: 'Gestione' },
  { value: 'altro', label: 'Altro' },
];

const columns: Column<Commission>[] = [
  {
    id: 'agent',
    header: 'Agente',
    cell: (c) => (
      <div className="flex items-center gap-3">
        <Avatar className="size-9">
          <AvatarFallback>{initials(c.agent_username ?? '?')}</AvatarFallback>
        </Avatar>
        <span className="font-medium capitalize text-navy">{c.agent_username ?? '—'}</span>
      </div>
    ),
  },
  {
    id: 'ref',
    header: 'Riferimento',
    cell: (c) => (
      <div className="min-w-0">
        <p className="truncate text-sm text-navy">{c.property_address ?? c.contract_title ?? '—'}</p>
        {(c.client_name || c.client_surname) && (
          <p className="truncate text-xs text-muted">{[c.client_name, c.client_surname].filter(Boolean).join(' ')}</p>
        )}
      </div>
    ),
  },
  {
    id: 'type',
    header: 'Tipo',
    cell: (c) => <span className="text-muted">{COMMISSION_TYPE_LABEL[c.commission_type] ?? c.commission_type}</span>,
  },
  {
    id: 'pct',
    header: '%',
    align: 'right',
    cell: (c) => <span className="text-muted">{c.percentage ? `${Number(c.percentage)}%` : '—'}</span>,
  },
  {
    id: 'amount',
    header: 'Importo',
    align: 'right',
    cell: (c) => <span className="font-semibold text-navy">{formatCurrencyCents(c.amount)}</span>,
  },
  { id: 'status', header: 'Stato', cell: (c) => <StatusBadge status={c.status} /> },
];

export default function CommissionsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useCommissions({ status, type, page });
  const stats = data?.stats;

  useEffect(() => setPage(1), [status, type]);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Provvigioni"
        subtitle="Compensi e provvigioni degli agenti"
        actions={
          <Button asChild>
            <Link to="/commissions/new">
              <Plus className="size-4" />
              Nuova Provvigione
            </Link>
          </Button>
        }
      />

      {isLoading && !stats ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <KpiCardSkeleton key={i} />
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <KpiCard label="Da Pagare" value={formatCurrency(stats.pending_total)} icon={Clock} accent="warning" />
          <KpiCard label="Pagate" value={formatCurrency(stats.paid_total)} icon={CheckCircle2} accent="success" />
          <KpiCard label="N° Provvigioni" value={formatNumber(stats.total_count)} icon={Hash} accent="primary" />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Select className="w-48" value={type} onChange={(e) => setType(e.target.value)} options={TYPE_OPTIONS} placeholder="Tutti i tipi" />
        <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_OPTIONS} placeholder="Tutti gli stati" />
      </div>

      {isError ? (
        <Card>
          <ErrorState onRetry={() => refetch()} />
        </Card>
      ) : (
        <Card className="p-2">
          <DataTable
            columns={columns}
            data={data?.items}
            isLoading={isLoading}
            rowKey={(c) => c.id}
            skeletonRows={8}
            onRowClick={(c) => navigate(`/commissions/${c.id}/edit`)}
            empty={{ icon: Briefcase, title: 'Nessuna provvigione', description: 'Prova a modificare i filtri.' }}
          />
        </Card>
      )}

      {data && (
        <Pagination page={data.page} pages={data.pages} total={data.total} onPageChange={setPage} itemLabel="provvigioni" />
      )}
    </div>
  );
}
