import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { ErrorState } from '@/components/common/ErrorState';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useUiStore } from '@/store/ui';
import type { PropertyFilters } from '@/types/property';
import { useProperties } from './api';
import { PropertyFilterBar } from './components/PropertyFilterBar';
import { PropertiesGrid } from './components/PropertiesGrid';
import { PropertiesTable } from './components/PropertiesTable';
import { ViewToggle } from './components/ViewToggle';

const PAGE_SIZE = 24;
const INITIAL: PropertyFilters = { page: 1, limit: PAGE_SIZE, sort: 'default' };

export default function PropertiesPage() {
  const [filters, setFilters] = useState<PropertyFilters>(INITIAL);
  const view = useUiStore((s) => s.propertyView);
  const { data, isLoading, isError, isFetching, refetch } = useProperties(filters);

  // Any filter change resets to page 1; page changes preserve filters.
  const patch = (p: Partial<PropertyFilters>) => setFilters((f) => ({ ...f, ...p, page: 1 }));
  const setPage = (page: number) => setFilters((f) => ({ ...f, page }));
  const reset = () => setFilters(INITIAL);

  const hasActiveFilters = useMemo(
    () =>
      Boolean(
        filters.search ||
          filters.status ||
          filters.property_type ||
          filters.price_type ||
          (filters.sort && filters.sort !== 'default'),
      ),
    [filters],
  );

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Immobili"
        subtitle="Gestione del portafoglio immobiliare"
        actions={
          <>
            <ViewToggle />
            <Button asChild>
              <a href="/index.php?view=property_edit">
                <Plus className="size-4" />
                Aggiungi Immobile
              </a>
            </Button>
          </>
        }
      />

      <PropertyFilterBar
        filters={filters}
        onChange={patch}
        onReset={reset}
        hasActiveFilters={hasActiveFilters}
      />

      {!isError && (
        <div className="flex items-center gap-3">
          <Badge variant="primary">
            {isLoading ? 'Caricamento…' : `${(data?.total ?? 0).toLocaleString('it-IT')} immobili trovati`}
          </Badge>
          {isFetching && !isLoading && <span className="text-xs text-muted">Aggiornamento…</span>}
        </div>
      )}

      {isError ? (
        <Card>
          <ErrorState onRetry={() => refetch()} />
        </Card>
      ) : view === 'grid' ? (
        <PropertiesGrid items={data?.items} isLoading={isLoading} />
      ) : (
        <PropertiesTable items={data?.items} isLoading={isLoading} />
      )}

      {data && (
        <Pagination
          page={data.page}
          pages={data.pages}
          total={data.total}
          onPageChange={setPage}
          itemLabel="immobili"
        />
      )}
    </div>
  );
}
