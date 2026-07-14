import { Wallet, Home } from 'lucide-react';
import { ResourceListPage } from '@/features/_shared/ResourceListPage';
import { Badge } from '@/components/ui/badge';
import type { Column } from '@/components/common/DataTable';
import { formatCurrencyCents, formatDate } from '@/lib/format';

interface Expense {
  id: number;
  category: string | null;
  description: string | null;
  amount: string;
  expense_date: string | null;
  property_address: string | null;
  supplier_name: string | null;
}

const columns: Column<Expense>[] = [
  {
    id: 'desc',
    header: 'Descrizione',
    cell: (e) => (
      <div className="min-w-0">
        <p className="truncate font-medium text-navy">{e.description ?? '—'}</p>
        {e.supplier_name && <p className="truncate text-xs text-muted">{e.supplier_name}</p>}
      </div>
    ),
  },
  {
    id: 'category',
    header: 'Categoria',
    cell: (e) => (e.category ? <Badge variant="secondary">{e.category}</Badge> : '—'),
  },
  {
    id: 'property',
    header: 'Immobile',
    cell: (e) =>
      e.property_address ? (
        <span className="flex items-center gap-1.5 text-sm text-muted">
          <Home className="size-3.5" />
          {e.property_address}
        </span>
      ) : (
        '—'
      ),
  },
  { id: 'date', header: 'Data', cell: (e) => formatDate(e.expense_date) },
  {
    id: 'amount',
    header: 'Importo',
    align: 'right',
    cell: (e) => <span className="font-semibold text-navy">{formatCurrencyCents(e.amount)}</span>,
  },
];

export default function ExpensesPage() {
  return (
    <ResourceListPage<Expense>
      title="Spese"
      subtitle="Costi di gestione e manutenzione"
      endpoint="expenses.php"
      columns={columns}
      rowKey={(e) => e.id}
      itemLabel="spese"
      searchPlaceholder="Cerca per descrizione o categoria…"
      newHref="/index.php?view=expense_edit"
      newLabel="Nuova Spesa"
      empty={{ icon: Wallet, title: 'Nessuna spesa', description: 'Registra la prima spesa.' }}
    />
  );
}
