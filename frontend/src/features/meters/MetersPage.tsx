import { Gauge, Home } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ResourceListPage } from '@/features/_shared/ResourceListPage';
import { Badge } from '@/components/ui/badge';
import type { Column } from '@/components/common/DataTable';
import { formatDate, formatNumber } from '@/lib/format';

interface MeterReading {
  id: number;
  meter_type: string;
  reading_value: string | null;
  reading_date: string | null;
  consumption: string | null;
  property_address: string | null;
}

const TYPE_LABEL: Record<string, { label: string; variant: 'warning' | 'primary' | 'secondary' | 'neutral' }> = {
  electricity: { label: 'Luce', variant: 'warning' },
  luce: { label: 'Luce', variant: 'warning' },
  gas: { label: 'Gas', variant: 'primary' },
  water: { label: 'Acqua', variant: 'secondary' },
  acqua: { label: 'Acqua', variant: 'secondary' },
};

const columns: Column<MeterReading>[] = [
  {
    id: 'property',
    header: 'Immobile',
    cell: (m) => (
      <span className="flex items-center gap-1.5 font-medium text-navy">
        <Home className="size-3.5 text-muted" />
        {m.property_address ?? '—'}
      </span>
    ),
  },
  {
    id: 'type',
    header: 'Utenza',
    cell: (m) => {
      const t = TYPE_LABEL[m.meter_type] ?? { label: m.meter_type, variant: 'neutral' as const };
      return <Badge variant={t.variant}>{t.label}</Badge>;
    },
  },
  { id: 'value', header: 'Lettura', align: 'right', cell: (m) => (m.reading_value ? formatNumber(m.reading_value) : '—') },
  {
    id: 'consumption',
    header: 'Consumo',
    align: 'right',
    cell: (m) => <span className="text-muted">{m.consumption ? formatNumber(m.consumption) : '—'}</span>,
  },
  { id: 'date', header: 'Data', cell: (m) => formatDate(m.reading_date) },
];

export default function MetersPage() {
  const navigate = useNavigate();
  return (
    <ResourceListPage<MeterReading>
      title="Contatori"
      subtitle="Letture e consumi delle utenze"
      endpoint="meter_readings.php"
      columns={columns}
      rowKey={(m) => m.id}
      itemLabel="letture"
      searchPlaceholder="Cerca per immobile…"
      newTo="/meters/new"
      newLabel="Nuova Lettura"
      onRowClick={(m) => navigate(`/meters/${m.id}/edit`)}
      empty={{ icon: Gauge, title: 'Nessuna lettura', description: 'Registra la prima lettura.' }}
    />
  );
}
