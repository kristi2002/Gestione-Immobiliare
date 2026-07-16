import { Link } from 'react-router-dom';
import { BedDouble, Bath, Ruler, Layers, Eye, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ImageWithFallback } from '@/components/common/ImageWithFallback';
import { formatNumber } from '@/lib/format';
import type { PropertyListItem } from '@/types/property';
import { cleanFloor, priceDisplay, propertyTypeLabel } from '../utils';

const NEW_DAYS = 14;

function isNew(createdAt: string): boolean {
  const created = new Date(createdAt.replace(' ', 'T')).getTime();
  if (Number.isNaN(created)) return false;
  return (Date.now() - created) / 86_400_000 <= NEW_DAYS;
}

function Stat({ icon: Icon, value }: { icon: typeof BedDouble; value: string | number | null }) {
  if (value == null || value === '' || value === 0) return null;
  return (
    <span className="flex items-center gap-1 text-xs text-muted">
      <Icon className="size-3.5" />
      {value}
    </span>
  );
}

export function PropertyCard({ property }: { property: PropertyListItem }) {
  const floor = cleanFloor(property.floor);

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl bg-card shadow-card transition-shadow hover:shadow-card-hover">
      {/* Cover */}
      <div className="relative aspect-[16/10] overflow-hidden bg-slate-100">
        <ImageWithFallback
          src={property.cover_url}
          alt={property.address}
          className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          fallbackClassName="size-full"
        />
        <div className="absolute left-3 top-3">
          <StatusBadge status={property.status} />
        </div>
        {isNew(property.created_at) && (
          <div className="absolute right-3 top-3">
            <Badge variant="warning" className="bg-warning text-white">Nuovo</Badge>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col p-4">
        <h3 className="truncate font-semibold text-navy" title={property.address}>
          {property.address}
        </h3>
        <p className="mt-0.5 truncate text-xs text-muted">
          {[property.city, propertyTypeLabel(property.property_type)].filter(Boolean).join(' · ')}
        </p>

        <p className="mt-3 text-lg font-bold text-primary">{priceDisplay(property)}</p>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Stat icon={BedDouble} value={property.rooms} />
          <Stat icon={Bath} value={property.bathrooms} />
          <Stat icon={Ruler} value={property.sqm ? `${formatNumber(property.sqm)} m²` : null} />
          <Stat icon={Layers} value={floor ? `Piano ${floor}` : null} />
        </div>

        <div className="mt-4 flex items-center gap-2 border-t border-gray-100 pt-3">
          <Button variant="outline" size="sm" className="flex-1" asChild>
            <Link to={`/properties/${property.id}`}>
              <Eye className="size-4" />
              Scheda
            </Link>
          </Button>
          <Button variant="ghost" size="sm" className="flex-1" asChild>
            <Link to={`/properties/${property.id}/edit`}>
              <Pencil className="size-4" />
              Modifica
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}

export function PropertyCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-card">
      <Skeleton className="aspect-[16/10] w-full rounded-none" />
      <div className="space-y-3 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-full" />
      </div>
    </div>
  );
}
