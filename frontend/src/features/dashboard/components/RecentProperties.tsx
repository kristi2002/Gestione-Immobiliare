import { Building2, ImageOff } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/common/StatusBadge';
import { DataTable, type Column } from '@/components/common/DataTable';
import { formatCurrency } from '@/lib/format';
import type { RecentProperty } from '@/types/dashboard';

interface Props {
  data: RecentProperty[] | undefined;
  isLoading: boolean;
}

function Thumb({ url }: { url: string | null }) {
  if (!url) {
    return (
      <div className="flex size-11 items-center justify-center rounded-lg bg-slate-100 text-muted">
        <ImageOff className="size-4" />
      </div>
    );
  }
  return <img src={url} alt="" className="size-11 rounded-lg object-cover" loading="lazy" />;
}

const columns: Column<RecentProperty>[] = [
  {
    id: 'thumb',
    header: '',
    cell: (p) => <Thumb url={p.cover_url} />,
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
          <a href="/app/properties">Vedi tutti</a>
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
