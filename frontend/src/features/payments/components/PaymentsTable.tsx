import { useNavigate } from 'react-router-dom';
import { Banknote, Check, Home } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/common/StatusBadge';
import { DataTable, type Column } from '@/components/common/DataTable';
import { formatCurrencyCents, formatDate } from '@/lib/format';
import type { Payment } from '@/types/finance';
import { PAYMENT_METHOD_LABEL } from '@/features/finance-labels';
import { useMarkPaid } from '../api';

function tenantName(p: Payment): string {
  return [p.tenant_name, p.tenant_surname].filter(Boolean).join(' ') || '—';
}

export function PaymentsTable({ items, isLoading }: { items: Payment[] | undefined; isLoading: boolean }) {
  const navigate = useNavigate();
  const markPaid = useMarkPaid();

  const columns: Column<Payment>[] = [
    { id: 'due', header: 'Scadenza', cell: (p) => <span className="font-medium">{formatDate(p.due_date)}</span> },
    {
      id: 'tenant',
      header: 'Inquilino',
      cell: (p) => <span className="font-medium text-navy">{tenantName(p)}</span>,
    },
    {
      id: 'property',
      header: 'Immobile',
      cell: (p) =>
        p.property_address ? (
          <span className="flex items-center gap-1.5 text-sm text-muted">
            <Home className="size-3.5" />
            <span className="truncate">{p.property_address}</span>
          </span>
        ) : (
          '—'
        ),
    },
    {
      id: 'method',
      header: 'Metodo',
      cell: (p) => <span className="text-muted">{PAYMENT_METHOD_LABEL[p.method ?? 'bonifico'] ?? '—'}</span>,
    },
    {
      id: 'amount',
      header: 'Importo',
      align: 'right',
      cell: (p) => <span className="font-semibold text-navy">{formatCurrencyCents(p.amount)}</span>,
    },
    { id: 'status', header: 'Stato', cell: (p) => <StatusBadge status={p.status} /> },
    {
      id: 'actions',
      header: '',
      align: 'right',
      cell: (p) =>
        p.status === 'paid' || p.status === 'cancelled' ? null : (
          <Button
            variant="outline"
            size="sm"
            disabled={markPaid.isPending}
            onClick={(e) => {
              e.stopPropagation();
              markPaid.mutate(p);
            }}
          >
            <Check className="size-4" />
            Segna pagato
          </Button>
        ),
    },
  ];

  return (
    <Card className="p-2">
      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        rowKey={(p) => p.id}
        skeletonRows={8}
        onRowClick={(p) => navigate(`/payments/${p.id}/edit`)}
        empty={{ icon: Banknote, title: 'Nessun pagamento', description: 'Nessun pagamento per i filtri selezionati.' }}
      />
    </Card>
  );
}
