import { Calculator } from 'lucide-react';
import { ResourceListPage } from '@/features/_shared/ResourceListPage';
import { Rating } from '@/components/common/Rating';
import type { Column } from '@/components/common/DataTable';
import { formatCurrency, formatDate } from '@/lib/format';

interface Appraisal {
  id: number;
  property_id: number;
  estimated_value: string | null;
  estimated_rent: string | null;
  condition_rating: number | null;
  appraiser_name: string | null;
  appraisal_date: string | null;
}

const columns: Column<Appraisal>[] = [
  { id: 'property', header: 'Immobile', cell: (a) => <span className="font-medium text-navy">Immobile #{a.property_id}</span> },
  {
    id: 'value',
    header: 'Valore stimato',
    align: 'right',
    cell: (a) => (a.estimated_value ? <span className="font-semibold text-primary">{formatCurrency(a.estimated_value)}</span> : '—'),
  },
  {
    id: 'rent',
    header: 'Canone stimato',
    align: 'right',
    cell: (a) => (a.estimated_rent ? <span className="text-muted">{formatCurrency(a.estimated_rent)} /mese</span> : '—'),
  },
  { id: 'condition', header: 'Condizione', cell: (a) => <Rating value={a.condition_rating} /> },
  { id: 'appraiser', header: 'Perito', cell: (a) => <span className="capitalize text-muted">{a.appraiser_name ?? '—'}</span> },
  { id: 'date', header: 'Data', cell: (a) => formatDate(a.appraisal_date) },
];

export default function ValuationPage() {
  return (
    <ResourceListPage<Appraisal>
      title="Valutazioni OMI"
      subtitle="Perizie e stime di valore degli immobili"
      endpoint="property_appraisals.php"
      columns={columns}
      rowKey={(a) => a.id}
      itemLabel="valutazioni"
      searchable={false}
      newHref="/index.php?view=valuation"
      newLabel="Nuova Valutazione"
      empty={{ icon: Calculator, title: 'Nessuna valutazione', description: 'Aggiungi la prima perizia.' }}
    />
  );
}
