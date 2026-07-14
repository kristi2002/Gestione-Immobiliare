import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/lib/hooks/useDebounce';
import type { PropertyFilters, PropertySort } from '@/types/property';
import { PROPERTY_TYPE_OPTIONS, PRICE_TYPE_OPTIONS, SORT_OPTIONS, STATUS_OPTIONS } from '../utils';

interface Props {
  filters: PropertyFilters;
  onChange: (patch: Partial<PropertyFilters>) => void;
  onReset: () => void;
  hasActiveFilters: boolean;
}

export function PropertyFilterBar({ filters, onChange, onReset, hasActiveFilters }: Props) {
  const [searchText, setSearchText] = useState(filters.search ?? '');
  const debounced = useDebounce(searchText, 350);

  // Push debounced search up when it settles (skip if unchanged).
  useEffect(() => {
    if (debounced !== (filters.search ?? '')) onChange({ search: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className="rounded-2xl bg-card p-4 shadow-card">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-12">
        {/* Search */}
        <div className="relative xl:col-span-4">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Cerca per indirizzo, città, proprietario…"
            className="pl-11"
          />
        </div>

        <Select
          className="xl:col-span-2"
          value={filters.property_type ?? ''}
          onChange={(e) => onChange({ property_type: e.target.value })}
          options={PROPERTY_TYPE_OPTIONS}
          placeholder="Tutti i tipi"
        />

        <Select
          className="xl:col-span-2"
          value={filters.status ?? ''}
          onChange={(e) => onChange({ status: e.target.value as PropertyFilters['status'] })}
          options={STATUS_OPTIONS}
          placeholder="Tutti gli stati"
        />

        <Select
          className="xl:col-span-2"
          value={filters.price_type ?? ''}
          onChange={(e) => onChange({ price_type: e.target.value as PropertyFilters['price_type'] })}
          options={PRICE_TYPE_OPTIONS}
          placeholder="Vendita e affitto"
        />

        <Select
          className="xl:col-span-2"
          value={filters.sort ?? 'default'}
          onChange={(e) => onChange({ sort: e.target.value as PropertySort })}
          options={SORT_OPTIONS}
        />
      </div>

      {hasActiveFilters && (
        <div className="mt-3 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchText('');
              onReset();
            }}
          >
            <X className="size-4" />
            Azzera filtri
          </Button>
        </div>
      )}
    </div>
  );
}
