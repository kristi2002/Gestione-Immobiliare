import { Star, Home } from 'lucide-react';
import { ResourceListPage } from '@/features/_shared/ResourceListPage';
import { Rating } from '@/components/common/Rating';
import { Badge } from '@/components/ui/badge';
import type { Column } from '@/components/common/DataTable';
import { formatDate } from '@/lib/format';

interface Survey {
  id: number;
  overall_rating: number | null;
  rating_global: number | null;
  submitted_at: string | null;
  tenant_name: string | null;
  tenant_surname: string | null;
  property_address: string | null;
  comment: string | null;
}

const columns: Column<Survey>[] = [
  {
    id: 'tenant',
    header: 'Inquilino',
    cell: (s) => <span className="font-medium text-navy">{[s.tenant_name, s.tenant_surname].filter(Boolean).join(' ') || '—'}</span>,
  },
  {
    id: 'property',
    header: 'Immobile',
    cell: (s) => (
      <span className="flex items-center gap-1.5 text-sm text-muted">
        <Home className="size-3.5" />
        {s.property_address ?? '—'}
      </span>
    ),
  },
  { id: 'rating', header: 'Valutazione', cell: (s) => <Rating value={s.overall_rating ?? s.rating_global} /> },
  {
    id: 'submitted',
    header: 'Stato',
    cell: (s) =>
      s.submitted_at ? <Badge variant="success">Compilato</Badge> : <Badge variant="warning">In attesa</Badge>,
  },
  { id: 'date', header: 'Data', cell: (s) => formatDate(s.submitted_at) },
];

export default function SurveysPage() {
  return (
    <ResourceListPage<Survey>
      title="Sondaggi"
      subtitle="Soddisfazione degli inquilini"
      endpoint="surveys.php"
      columns={columns}
      rowKey={(s) => s.id}
      itemLabel="sondaggi"
      searchable={false}
      empty={{ icon: Star, title: 'Nessun sondaggio', description: 'I sondaggi inviati compariranno qui.' }}
    />
  );
}
