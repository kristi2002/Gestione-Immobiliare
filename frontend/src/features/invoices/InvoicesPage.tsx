import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Plus, Receipt, Euro, CheckCircle2, Clock } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { ErrorState } from '@/components/common/ErrorState';
import { KpiCard, KpiCardSkeleton } from '@/components/common/KpiCard';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/common/StatusBadge';
import { DataTable, type Column } from '@/components/common/DataTable';
import { formatCurrency, formatCurrencyCents, formatDate, formatNumber } from '@/lib/format';
import type { Invoice } from '@/types/finance';
import { useInvoices, useInvoiceAggregate } from './api';

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Bozza' },
  { value: 'sent', label: 'Inviata' },
  { value: 'paid', label: 'Pagata' },
  { value: 'cancelled', label: 'Annullata' },
];

function recipient(i: Invoice): string {
  const client = [i.client_name, i.client_surname].filter(Boolean).join(' ');
  const lead = [i.lead_name, i.lead_surname].filter(Boolean).join(' ');
  return client || lead || '—';
}

const columns: Column<Invoice>[] = [
  {
    id: 'number',
    header: 'Numero',
    cell: (i) => (
      <div className="min-w-0">
        <p className="font-medium text-navy">{i.invoice_number}</p>
        <p className="truncate text-xs text-muted">{recipient(i)}</p>
      </div>
    ),
  },
  { id: 'issue', header: 'Emissione', cell: (i) => formatDate(i.issue_date) },
  {
    id: 'amount',
    header: 'Imponibile',
    align: 'right',
    cell: (i) => <span className="text-muted">{formatCurrencyCents(i.amount)}</span>,
  },
  {
    id: 'vat',
    header: 'IVA',
    align: 'right',
    cell: (i) => <span className="text-muted">{i.vat_rate ? `${Number(i.vat_rate)}%` : '—'}</span>,
  },
  {
    id: 'total',
    header: 'Totale',
    align: 'right',
    cell: (i) => <span className="font-semibold text-navy">{formatCurrencyCents(i.total)}</span>,
  },
  { id: 'status', header: 'Stato', cell: (i) => <StatusBadge status={i.status} /> },
];

export default function InvoicesPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const { data: agg, isLoading: aggLoading } = useInvoiceAggregate();
  const { data, isLoading, isError, refetch } = useInvoices({ status, page });

  useEffect(() => setPage(1), [status]);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Fatture"
        subtitle="Fatturazione e incassi"
        actions={
          <Button asChild>
            <Link to="/invoices/new">
              <Plus className="size-4" />
              Nuova Fattura
            </Link>
          </Button>
        }
      />

      {aggLoading || !agg ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <KpiCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Fatturato Totale" value={formatCurrency(agg.invoiced)} icon={Euro} accent="primary" />
          <KpiCard label="Incassato" value={formatCurrency(agg.collected)} icon={CheckCircle2} accent="success" />
          <KpiCard label="Da Incassare" value={formatCurrency(agg.outstanding)} icon={Clock} accent="warning" />
          <KpiCard label="N° Fatture" value={formatNumber(agg.count)} icon={Receipt} accent="secondary" />
        </div>
      )}

      <div className="flex flex-wrap gap-3">
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
            rowKey={(i) => i.id}
            skeletonRows={8}
            onRowClick={(i) => navigate(`/invoices/${i.id}/edit`)}
            empty={{ icon: Receipt, title: 'Nessuna fattura', description: 'Prova a modificare i filtri.' }}
          />
        </Card>
      )}

      {data && (
        <Pagination page={data.page} pages={data.pages} total={data.total} onPageChange={setPage} itemLabel="fatture" />
      )}
    </div>
  );
}
