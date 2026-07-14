import { useEffect, useState } from 'react';
import { Plus, Search, ScrollText, Home } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { ErrorState } from '@/components/common/ErrorState';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/common/StatusBadge';
import { DataTable, type Column } from '@/components/common/DataTable';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { formatCurrencyCents, formatDate } from '@/lib/format';
import type { Contract } from '@/types/finance';
import { contractTypeLabel } from '@/features/finance-labels';
import { useContracts } from './api';
import { GenerateScheduleButton } from './components/GenerateScheduleButton';

const TYPE_OPTIONS = [
  { value: 'locazione', label: 'Locazione' },
  { value: 'compravendita', label: 'Compravendita' },
  { value: 'preliminare', label: 'Preliminare' },
  { value: 'mandato', label: 'Mandato' },
  { value: 'altro', label: 'Altro' },
];

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Bozza' },
  { value: 'sent', label: 'Inviato' },
  { value: 'signed', label: 'Firmato' },
  { value: 'expired', label: 'Scaduto' },
  { value: 'cancelled', label: 'Annullato' },
];

function parties(c: Contract): string {
  const tenant = [c.tenant_name, c.tenant_surname].filter(Boolean).join(' ');
  const client = [c.client_name, c.client_surname].filter(Boolean).join(' ');
  return tenant || client || '—';
}

const columns: Column<Contract>[] = [
  {
    id: 'title',
    header: 'Contratto',
    cell: (c) => (
      <div className="min-w-0">
        <p className="truncate font-medium text-navy">{c.title}</p>
        <p className="truncate text-xs text-muted">{parties(c)}</p>
      </div>
    ),
  },
  {
    id: 'property',
    header: 'Immobile',
    cell: (c) =>
      c.property_address ? (
        <span className="flex items-center gap-1.5 text-sm text-muted">
          <Home className="size-3.5" />
          <span className="truncate">{c.property_address}</span>
        </span>
      ) : (
        '—'
      ),
  },
  { id: 'type', header: 'Tipo', cell: (c) => <span className="text-muted">{contractTypeLabel(c.contract_type)}</span> },
  {
    id: 'rent',
    header: 'Canone',
    align: 'right',
    cell: (c) => (c.monthly_rent ? <span className="font-semibold">{formatCurrencyCents(c.monthly_rent)}</span> : '—'),
  },
  {
    id: 'period',
    header: 'Periodo',
    cell: (c) => (
      <span className="whitespace-nowrap text-xs text-muted">
        {formatDate(c.start_date)} → {formatDate(c.end_date)}
      </span>
    ),
  },
  { id: 'status', header: 'Stato', cell: (c) => <StatusBadge status={c.status ?? 'signed'} /> },
  { id: 'actions', header: '', align: 'right', cell: (c) => <GenerateScheduleButton contract={c} /> },
];

export default function ContractsPage() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search, 350);

  const { data, isLoading, isError, refetch } = useContracts({ search: debounced, type, status, page });

  useEffect(() => setPage(1), [debounced, type, status]);

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Contratti"
        subtitle="Locazioni, compravendite e mandati"
        actions={
          <Button asChild>
            <a href="/index.php?view=contract_edit">
              <Plus className="size-4" />
              Nuovo Contratto
            </a>
          </Button>
        }
      />

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca per immobile, inquilino, proprietario…"
            className="pl-11"
          />
        </div>
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
            empty={{ icon: ScrollText, title: 'Nessun contratto', description: 'Prova a modificare i filtri.' }}
          />
        </Card>
      )}

      {data && (
        <Pagination page={data.page} pages={data.pages} total={data.total} onPageChange={setPage} itemLabel="contratti" />
      )}
    </div>
  );
}
