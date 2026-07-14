import { Building2 } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import type { PropertyListItem } from '@/types/property';
import { PropertyCard, PropertyCardSkeleton } from './PropertyCard';

interface Props {
  items: PropertyListItem[] | undefined;
  isLoading: boolean;
}

export function PropertiesGrid({ items, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <PropertyCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="Nessun immobile trovato"
        description="Prova a modificare i filtri di ricerca o aggiungi un nuovo immobile."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((p) => (
        <PropertyCard key={p.id} property={p} />
      ))}
    </div>
  );
}
