import { Building2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/common/StatusBadge';
import { DataTable, type Column } from '@/components/common/DataTable';
import { ImageWithFallback } from '@/components/common/ImageWithFallback';
import { formatCurrency } from '@/lib/format';
import type { RecentProperty } from '@/types/dashboard';

interface Props {
  data: RecentProperty[] | undefined;
  isLoading: boolean;
}

const columns: Column<RecentProperty>[] = [
  {
    id: 'thumb',
    header: '',
    cell: (p) => (
      <ImageWithFallback
        src={p.cover_url}
        alt={p.address}
        className="size-11 rounded-lg object-cover"
        fallbackClassName="size-11 rounded-lg"
      />
    ),
    className: 'w-14',
  },
  {
    id: 'address',
    header: 'Indirizzo',
    cell: (p) => (
      <div>
        <p className="font-medium text-navy">{p.address}</p>
        {p.city && <p className="text-xs text-muted">{p.city}</p>}
      </div>
    ),
  },
  {
    id: 'price',
    header: 'Prezzo',
    align: 'right',
    cell: (p) => <span className="font-semibold">{p.price ? formatCurrency(p.price) : '—'}</span>,
  },
  {
    id: 'type',
    header: 'Tipo',
    cell: (p) => <span className="capitalize text-muted">{p.property_type ?? '—'}</span>,
  },
  {
    id: 'status',
    header: 'Stato',
    cell: (p) => <StatusBadge status={p.status} />,
  },
];

/** "Immobili Recenti" table. */
export function RecentProperties({ data, isLoading }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Immobili Recenti</CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/properties">Vedi tutti</Link>
        </Button>
      </CardHeader>

      <DataTable
        columns={columns}
        data={data}
        isLoading={isLoading}
        rowKey={(p) => p.id}
        skeletonRows={5}
        empty={{
          icon: Building2,
          title: 'Nessun immobile',
          description: 'Gli immobili aggiunti di recente compariranno qui.',
        }}
      />
    </Card>
  );
}
