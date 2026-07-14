import { Truck, Mail, Phone } from 'lucide-react';
import { ResourceListPage } from '@/features/_shared/ResourceListPage';
import { Rating } from '@/components/common/Rating';
import { Badge } from '@/components/ui/badge';
import type { Column } from '@/components/common/DataTable';

interface Supplier {
  id: number;
  name: string;
  category: string | null;
  phone: string | null;
  email: string | null;
  rating: number | null;
  is_active: number | boolean;
}

const columns: Column<Supplier>[] = [
  { id: 'name', header: 'Fornitore', cell: (s) => <span className="font-medium text-navy">{s.name}</span> },
  { id: 'category', header: 'Categoria', cell: (s) => <span className="capitalize text-muted">{s.category ?? '—'}</span> },
  {
    id: 'contact',
    header: 'Contatti',
    cell: (s) => (
      <div className="space-y-0.5 text-xs text-muted">
        {s.phone && (
          <p className="flex items-center gap-1.5">
            <Phone className="size-3" />
            {s.phone}
          </p>
        )}
        {s.email && (
          <p className="flex items-center gap-1.5">
            <Mail className="size-3" />
            <span className="truncate">{s.email}</span>
          </p>
        )}
        {!s.phone && !s.email && '—'}
      </div>
    ),
  },
  { id: 'rating', header: 'Valutazione', cell: (s) => <Rating value={s.rating} /> },
  {
    id: 'active',
    header: 'Stato',
    cell: (s) =>
      Number(s.is_active) ? <Badge variant="success">Attivo</Badge> : <Badge variant="neutral">Inattivo</Badge>,
  },
];

export default function SuppliersPage() {
  return (
    <ResourceListPage<Supplier>
      title="Fornitori"
      subtitle="Anagrafica fornitori e artigiani"
      endpoint="suppliers.php"
      columns={columns}
      rowKey={(s) => s.id}
      itemLabel="fornitori"
      searchPlaceholder="Cerca per nome o categoria…"
      newHref="/index.php?view=suppliers"
      newLabel="Nuovo Fornitore"
      empty={{ icon: Truck, title: 'Nessun fornitore', description: 'Aggiungi il primo fornitore.' }}
    />
  );
}
