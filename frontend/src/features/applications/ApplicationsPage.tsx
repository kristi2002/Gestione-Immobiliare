import { ClipboardList, Home } from 'lucide-react';
import { ResourceListPage } from '@/features/_shared/ResourceListPage';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Badge } from '@/components/ui/badge';
import type { Column } from '@/components/common/DataTable';
import { formatDate } from '@/lib/format';

interface Application {
  id: number;
  applicant_name: string | null;
  applicant_email: string | null;
  applicant_phone: string | null;
  application_type: string | null;
  status: string;
  property_address: string | null;
  created_at: string;
}

const columns: Column<Application>[] = [
  {
    id: 'applicant',
    header: 'Richiedente',
    cell: (a) => (
      <div className="min-w-0">
        <p className="font-medium text-navy">{a.applicant_name ?? '—'}</p>
        <p className="truncate text-xs text-muted">{a.applicant_email ?? a.applicant_phone ?? ''}</p>
      </div>
    ),
  },
  {
    id: 'property',
    header: 'Immobile',
    cell: (a) => (
      <span className="flex items-center gap-1.5 text-sm text-muted">
        <Home className="size-3.5" />
        {a.property_address ?? '—'}
      </span>
    ),
  },
  {
    id: 'type',
    header: 'Tipo',
    cell: (a) => <Badge variant="secondary">{a.application_type ?? 'Richiesta'}</Badge>,
  },
  { id: 'date', header: 'Data', cell: (a) => formatDate(a.created_at) },
  { id: 'status', header: 'Stato', cell: (a) => <StatusBadge status={a.status} /> },
];

export default function ApplicationsPage() {
  return (
    <ResourceListPage<Application>
      title="Richieste"
      subtitle="Richieste di informazioni e candidature"
      endpoint="property_applications.php"
      columns={columns}
      rowKey={(a) => a.id}
      itemLabel="richieste"
      searchPlaceholder="Cerca per richiedente o immobile…"
      empty={{ icon: ClipboardList, title: 'Nessuna richiesta', description: 'Le richieste dal sito compariranno qui.' }}
    />
  );
}
