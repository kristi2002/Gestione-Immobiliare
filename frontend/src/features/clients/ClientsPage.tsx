import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { ErrorState } from '@/components/common/ErrorState';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/lib/hooks/useDebounce';
import type { Client } from '@/types/people';
import { useClients, useClientStats } from './api';
import { ClientKpis } from './components/ClientKpis';
import { ClientsTable } from './components/ClientsTable';
import { ClientDetailPanel } from './components/ClientDetailPanel';

export default function ClientsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const debouncedSearch = useDebounce(search, 350);

  const { data: stats, isLoading: statsLoading } = useClientStats();
  const { data, isLoading, isError, refetch } = useClients({ search: debouncedSearch, page, limit: 25 });

  useEffect(() => setPage(1), [debouncedSearch]);

  // Auto-select the first proprietario so the detail rail is never empty on load.
  useEffect(() => {
    if (selectedId == null && data?.items.length) setSelectedId(data.items[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const onSelect = (client: Client) => setSelectedId(client.id);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Proprietari"
        subtitle="Gestione proprietari immobiliari"
        actions={
          <Button asChild>
            <Link to="/clients/new">
              <Plus className="size-4" />
              Nuovo Proprietario
            </Link>
          </Button>
        }
      />

      <ClientKpis stats={stats} isLoading={statsLoading} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* List */}
        <div className="space-y-4 xl:col-span-2">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca per nome, email, codice fiscale…"
              className="pl-11"
            />
          </div>

          {isError ? (
            <Card>
              <ErrorState onRetry={() => refetch()} />
            </Card>
          ) : (
            <ClientsTable
              items={data?.items}
              isLoading={isLoading}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          )}

          {data && (
            <Pagination
              page={data.page}
              pages={data.pages}
              total={data.total}
              onPageChange={setPage}
              itemLabel="proprietari"
            />
          )}
        </div>

        {/* Detail rail */}
        <div className="xl:col-span-1">
          <ClientDetailPanel clientId={selectedId} />
        </div>
      </div>
    </div>
  );
}
