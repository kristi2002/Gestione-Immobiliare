import { Building, MapPin } from 'lucide-react';
import { ResourceListPage } from '@/features/_shared/ResourceListPage';
import { Badge } from '@/components/ui/badge';
import type { Column } from '@/components/common/DataTable';
import { formatNumber } from '@/lib/format';

interface BuildingRow {
  id: number;
  name: string;
  address: string | null;
  city: string | null;
  total_units: number | null;
  unit_count: string | number;
  occupancy_count: string | number;
}

const columns: Column<BuildingRow>[] = [
  { id: 'name', header: 'Edificio', cell: (b) => <span className="font-medium text-navy">{b.name}</span> },
  {
    id: 'address',
    header: 'Indirizzo',
    cell: (b) => (
      <span className="flex items-center gap-1.5 text-sm text-muted">
        <MapPin className="size-3.5" />
        {[b.address, b.city].filter(Boolean).join(', ') || '—'}
      </span>
    ),
  },
  {
    id: 'units',
    header: 'Unità',
    align: 'center',
    cell: (b) => formatNumber(Number(b.unit_count) || b.total_units || 0),
  },
  {
    id: 'occupancy',
    header: 'Occupazione',
    align: 'center',
    cell: (b) => {
      const units = Number(b.unit_count) || Number(b.total_units) || 0;
      const occ = Number(b.occupancy_count) || 0;
      const pct = units > 0 ? Math.round((occ / units) * 100) : 0;
      return <Badge variant={pct >= 80 ? 'success' : pct >= 40 ? 'warning' : 'neutral'}>{pct}%</Badge>;
    },
  },
];

export default function BuildingsPage() {
  return (
    <ResourceListPage<BuildingRow>
      title="Edifici"
      subtitle="Stabili e condomini in gestione"
      endpoint="buildings.php"
      columns={columns}
      rowKey={(b) => b.id}
      itemLabel="edifici"
      searchPlaceholder="Cerca per nome o indirizzo…"
      newHref="/index.php?view=buildings"
      newLabel="Nuovo Edificio"
      empty={{ icon: Building, title: 'Nessun edificio', description: 'Aggiungi il primo stabile.' }}
    />
  );
}
