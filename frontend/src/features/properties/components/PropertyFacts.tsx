import { BedDouble, Bath, Ruler, Layers, CalendarDays, Home, Tag } from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/card';
import { formatNumber } from '@/lib/format';
import type { Property } from '@/types/property';
import { cleanFloor, priceDisplay, propertyTypeLabel } from '../utils';

function Fact({ icon: Icon, label, value }: { icon: typeof Home; label: string; value: string | null }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-muted">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-eyebrow">{label}</p>
        <p className="truncate text-sm font-medium text-navy">{value ?? '—'}</p>
      </div>
    </div>
  );
}

export function PropertyFacts({ property }: { property: Property }) {
  const floor = cleanFloor(property.floor);

  return (
    <Card>
      <div className="mb-2 flex items-baseline justify-between">
        <CardTitle>Dettagli</CardTitle>
        <span className="text-xl font-bold text-primary">{priceDisplay(property)}</span>
      </div>
      <div className="grid grid-cols-1 divide-y divide-gray-100 sm:grid-cols-2 sm:gap-x-6 sm:divide-y-0">
        <Fact icon={Tag} label="Contratto" value={property.price_type === 'affitto' ? 'Affitto' : 'Vendita'} />
        <Fact icon={Home} label="Tipologia" value={propertyTypeLabel(property.property_type)} />
        <Fact icon={Ruler} label="Superficie" value={property.sqm ? `${formatNumber(property.sqm)} m²` : null} />
        <Fact icon={BedDouble} label="Locali" value={property.rooms != null ? String(property.rooms) : null} />
        <Fact icon={Bath} label="Bagni" value={property.bathrooms != null ? String(property.bathrooms) : null} />
        <Fact icon={Layers} label="Piano" value={floor} />
        <Fact icon={CalendarDays} label="Anno" value={property.year_built ? String(property.year_built) : null} />
      </div>
    </Card>
  );
}
