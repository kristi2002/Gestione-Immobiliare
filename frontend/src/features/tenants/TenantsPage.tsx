import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Plus, Search, KeyRound, UserCheck, FileText, CalendarClock, Home, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { ErrorState } from '@/components/common/ErrorState';
import { KpiCard, KpiCardSkeleton } from '@/components/common/KpiCard';
import { DataTable, type Column } from '@/components/common/DataTable';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { formatCurrencyCents, formatDate, formatNumber, initials } from '@/lib/format';
import type { Tenant } from '@/types/people';
import { useTenants, useTenantStats } from './api';

const columns: Column<Tenant>[] = [
  {
    id: 'name',
    header: 'Inquilino',
    cell: (t) => (
      <div className="flex items-center gap-3">
        <Avatar className="size-9">
          <AvatarFallback>{initials(`${t.name} ${t.surname ?? ''}`)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate font-medium text-navy">{[t.name, t.surname].filter(Boolean).join(' ')}</p>
          {t.email && <p className="truncate text-xs text-muted">{t.email}</p>}
        </div>
      </div>
    ),
  },
  {
    id: 'property',
    header: 'Immobile',
    cell: (t) =>
      t.property_address ? (
        <div className="flex items-center gap-1.5 text-sm text-navy">
          <Home className="size-3.5 text-muted" />
          <span className="truncate">{t.property_address}</span>
        </div>
      ) : (
        <span className="text-xs text-muted">Nessun contratto</span>
      ),
  },
  {
    id: 'rent',
    header: 'Canone',
    align: 'right',
    cell: (t) => (t.monthly_rent ? <span className="font-semibold">{formatCurrencyCents(t.monthly_rent)}</span> : '—'),
  },
  {
    id: 'lease',
    header: 'Scadenza',
    cell: (t) => (t.lease_end ? formatDate(t.lease_end) : '—'),
  },
  {
    id: 'portal',
    header: 'Portale',
    align: 'center',
    cell: (t) =>
      Number(t.has_portal_access) ? (
        <Badge variant="success">Attivo</Badge>
      ) : (
        <span className="text-xs text-muted">—</span>
      ),
  },
  { id: 'status', header: 'Stato', cell: (t) => <StatusBadge status={t.status} /> },
];

export default function TenantsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search, 350);

  const { data: stats, isLoading: statsLoading } = useTenantStats();
  const { data, isLoading, isError, refetch } = useTenants({ search: debounced, page });

  useEffect(() => setPage(1), [debounced]);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Inquilini"
        subtitle="Gestione inquilini e contratti di locazione"
        actions={
          <Button asChild>
            <Link to="/tenants/new">
              <Plus className="size-4" />
              Nuovo Inquilino
            </Link>
          </Button>
        }
      />

      {statsLoading || !stats ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <KpiCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Inquilini Totali" value={formatNumber(stats.total)} icon={KeyRound} accent="primary" />
          <KpiCard label="Attivi" value={formatNumber(stats.active)} icon={UserCheck} accent="success" />
          <KpiCard label="Con Contratto" value={formatNumber(stats.with_contract)} icon={FileText} accent="secondary" />
          <KpiCard
            label="In Scadenza (90gg)"
            value={formatNumber(stats.expiring)}
            icon={CalendarClock}
            accent="warning"
          />
        </div>
      )}

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cerca per nome, email, immobile…"
          className="pl-11"
        />
      </div>

      {isError ? (
        <Card>
          <ErrorState onRetry={() => refetch()} />
        </Card>
      ) : (
        <Card className="p-2">
          <DataTable
            columns={columns}
            data={data?.items}
            isLoading={isLoading}
            rowKey={(t) => t.id}
            skeletonRows={8}
            onRowClick={(t) => navigate(`/tenants/${t.id}/edit`)}
            empty={{ icon: CheckCircle2, title: 'Nessun inquilino trovato', description: 'Prova a modificare la ricerca.' }}
          />
        </Card>
      )}

      {data && (
        <Pagination page={data.page} pages={data.pages} total={data.total} onPageChange={setPage} itemLabel="inquilini" />
      )}
    </div>
  );
}
