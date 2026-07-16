import { ShieldCheck, Home } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ResourceListPage } from '@/features/_shared/ResourceListPage';
import type { Column } from '@/components/common/DataTable';
import { formatCurrency, formatDate } from '@/lib/format';

interface InsurancePolicy {
  id: number;
  insurer_name: string | null;
  policy_number: string | null;
  policy_type: string | null;
  premium_annual: string | null;
  end_date: string | null;
  property_address: string | null;
}

const columns: Column<InsurancePolicy>[] = [
  {
    id: 'insurer',
    header: 'Assicuratore',
    cell: (p) => (
      <div className="min-w-0">
        <p className="font-medium text-navy">{p.insurer_name ?? '—'}</p>
        {p.policy_number && <p className="truncate text-xs text-muted">{p.policy_number}</p>}
      </div>
    ),
  },
  { id: 'type', header: 'Tipo', cell: (p) => <span className="capitalize text-muted">{p.policy_type ?? '—'}</span> },
  {
    id: 'property',
    header: 'Immobile',
    cell: (p) => (
      <span className="flex items-center gap-1.5 text-sm text-muted">
        <Home className="size-3.5" />
        {p.property_address ?? '—'}
      </span>
    ),
  },
  {
    id: 'premium',
    header: 'Premio/anno',
    align: 'right',
    cell: (p) => (p.premium_annual ? <span className="font-semibold">{formatCurrency(p.premium_annual)}</span> : '—'),
  },
  { id: 'end', header: 'Scadenza', cell: (p) => formatDate(p.end_date) },
];

export default function InsurancePage() {
  const navigate = useNavigate();
  return (
    <ResourceListPage<InsurancePolicy>
      title="Assicurazioni"
      subtitle="Polizze assicurative degli immobili"
      endpoint="insurance.php"
      columns={columns}
      rowKey={(p) => p.id}
      itemLabel="polizze"
      searchPlaceholder="Cerca per assicuratore o immobile…"
      newTo="/insurance/new"
      newLabel="Nuova Polizza"
      onRowClick={(p) => navigate(`/insurance/${p.id}/edit`)}
      empty={{ icon: ShieldCheck, title: 'Nessuna polizza', description: 'Aggiungi la prima polizza.' }}
    />
  );
}
