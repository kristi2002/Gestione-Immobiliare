import { useNavigate } from 'react-router-dom';
import { Building2, Eye } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/common/StatusBadge';
import { DataTable, type Column } from '@/components/common/DataTable';
import { ImageWithFallback } from '@/components/common/ImageWithFallback';
import { formatNumber } from '@/lib/format';
import type { PropertyListItem } from '@/types/property';
import { priceDisplay, propertyTypeLabel } from '../utils';

interface Props {
  items: PropertyListItem[] | undefined;
  isLoading: boolean;
}

const columns: Column<PropertyListItem>[] = [
  {
    id: 'thumb',
    header: '',
    cell: (p) => (
      <ImageWithFallback
        src={p.cover_url}
        alt={p.address}
        className="size-12 rounded-lg object-cover"
        fallbackClassName="size-12 rounded-lg"
      />
    ),
    className: 'w-16',
  },
  {
    id: 'address',
    header: 'Indirizzo',
    cell: (p) => (
      <div>
        <p className="font-medium text-navy">{p.address}</p>
        <p className="text-xs text-muted">{[p.city, p.province].filter(Boolean).join(', ') || '—'}</p>
      </div>
    ),
  },
  { id: 'type', header: 'Tipo', cell: (p) => <span className="text-muted">{propertyTypeLabel(p.property_type)}</span> },
  { id: 'sqm', header: 'Superficie', align: 'right', cell: (p) => (p.sqm ? `${formatNumber(p.sqm)} m²` : '—') },
  { id: 'price', header: 'Prezzo', align: 'right', cell: (p) => <span className="font-semibold">{priceDisplay(p)}</span> },
  {
    id: 'owner',
    header: 'Proprietario',
    cell: (p) => (
      <span className="text-muted">
        {[p.client_name, p.client_surname].filter(Boolean).join(' ') || '—'}
      </span>
    ),
  },
  { id: 'status', header: 'Stato', cell: (p) => <StatusBadge status={p.status} /> },
  {
    id: 'actions',
    header: '',
    align: 'right',
    cell: (p) => (
      <Button variant="ghost" size="icon" asChild onClick={(e) => e.stopPropagation()}>
        <a href={`/properties/${p.id}`} aria-label="Apri scheda">
          <Eye className="size-4" />
        </a>
      </Button>
    ),
  },
];

export function PropertiesTable({ items, isLoading }: Props) {
  const navigate = useNavigate();

  return (
    <Card className="p-0">
      <div className="p-2">
        <DataTable
          columns={columns}
          data={items}
          isLoading={isLoading}
          rowKey={(p) => p.id}
          onRowClick={(p) => navigate(`/properties/${p.id}`)}
          skeletonRows={8}
          empty={{
            icon: Building2,
            title: 'Nessun immobile trovato',
            description: 'Prova a modificare i filtri di ricerca.',
          }}
        />
      </div>
    </Card>
  );
}
