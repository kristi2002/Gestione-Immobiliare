import {
  AlertCircle,
  CheckCircle2,
  Euro,
  Plus,
  RefreshCw,
  Wrench,
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { KpiCard, KpiCardSkeleton } from '@/components/common/KpiCard';
import { ErrorState } from '@/components/common/ErrorState';
import { Rating } from '@/components/common/Rating';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate, initials } from '@/lib/format';
import {
  useMaintenance,
  type MaintenanceItem,
  type MaintenanceStatus,
} from './api';

interface ColumnDef {
  status: MaintenanceStatus;
  label: string;
  headerClass: string;
}

const COLUMNS: ColumnDef[] = [
  { status: 'todo', label: 'Da Fare', headerClass: 'bg-danger' },
  { status: 'in_progress', label: 'In Corso', headerClass: 'bg-primary' },
  { status: 'done', label: 'Completati', headerClass: 'bg-success' },
];

function clampPct(value: number | string | null | undefined): number {
  const n = value == null ? 0 : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/* ── Card ──────────────────────────────────────────────────────────────── */

function MaintenanceCard({ item }: { item: MaintenanceItem }) {
  const urgent = item.priority === 'urgent';

  const header = (
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-start gap-2">
        {item.status === 'done' && (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
        )}
        <p className="text-sm font-semibold leading-snug text-navy">{item.title}</p>
      </div>
      {item.status !== 'done' && <Wrench className="size-4 shrink-0 text-slate-300" />}
    </div>
  );

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      {header}

      {item.status === 'todo' && (
        <>
          {item.property_address && (
            <p className="mt-1.5 text-xs text-muted">{item.property_address}</p>
          )}
          {item.tenant_name && (
            <p className="mt-0.5 text-xs text-muted">Tenant: {item.tenant_name}</p>
          )}
          <div className="mt-3 flex items-center justify-between gap-2">
            <Badge variant={urgent ? 'danger' : 'neutral'}>
              {urgent ? 'URGENTE' : 'Normale'}
            </Badge>
            {item.reported_date && (
              <span className="text-xs text-muted">
                Segnalato: {formatDate(item.reported_date)}
              </span>
            )}
          </div>
        </>
      )}

      {item.status === 'in_progress' && (
        <>
          {item.supplier_name && (
            <p className="mt-1.5 text-xs text-muted">
              Fornitore: <span className="text-secondary">{item.supplier_name}</span>
            </p>
          )}
          <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
            <span>{item.started_date ? `Iniziato: ${formatDate(item.started_date)}` : '—'}</span>
            {item.eta_date && <span>ETA: {formatDate(item.eta_date)}</span>}
          </div>
          <div className="mt-3 flex items-center gap-2">
            {item.supplier_name && (
              <Avatar className="size-6 shrink-0">
                <AvatarFallback className="text-[10px]">
                  {initials(item.supplier_name)}
                </AvatarFallback>
              </Avatar>
            )}
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${clampPct(item.progress)}%` }}
              />
            </div>
          </div>
        </>
      )}

      {item.status === 'done' && (
        <>
          {item.completed_date && (
            <p className="mt-1.5 text-xs text-muted">
              Completato: {formatDate(item.completed_date)}
            </p>
          )}
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-muted">
              Costo: <span className="font-semibold text-success">{formatCurrency(item.cost)}</span>
            </span>
            {item.supplier_name && (
              <span className="truncate text-xs text-muted">{item.supplier_name}</span>
            )}
          </div>
          <div className="mt-2">
            <Rating value={item.rating} />
          </div>
        </>
      )}
    </div>
  );
}

/* ── Column ────────────────────────────────────────────────────────────── */

function Column({ column, items }: { column: ColumnDef; items: MaintenanceItem[] }) {
  return (
    <div className="flex min-w-[260px] flex-1 flex-col">
      <div
        className={cn(
          'flex items-center justify-between rounded-xl px-4 py-2.5 text-white',
          column.headerClass,
        )}
      >
        <span className="text-sm font-semibold">{column.label}</span>
        <span className="flex min-w-6 items-center justify-center rounded-full bg-white/25 px-1.5 text-xs font-semibold">
          {items.length}
        </span>
      </div>

      <div className="mt-3 flex-1 space-y-3">
        {items.length === 0 ? (
          <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-gray-200 text-xs text-muted">
            Nessun intervento
          </div>
        ) : (
          items.map((item) => <MaintenanceCard key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
}

function ColumnSkeleton({ column }: { column: ColumnDef }) {
  return (
    <div className="flex min-w-[260px] flex-1 flex-col">
      <div className={cn('rounded-xl px-4 py-2.5', column.headerClass)}>
        <span className="text-sm font-semibold text-white">{column.label}</span>
      </div>
      <div className="mt-3 space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function MaintenancePage() {
  const { data, isLoading, isError, refetch } = useMaintenance();

  const header = (
    <PageHeader
      title="Manutenzione"
      subtitle="Gestione interventi, guasti e manutenzione programmata"
      actions={
        <Button asChild>
          <a href="/index.php?view=maintenance_edit">
            <Plus className="size-4" />
            Nuova Richiesta
          </a>
        </Button>
      }
    />
  );

  if (isError) {
    return (
      <div className="animate-fade-in space-y-6">
        {header}
        <Card>
          <ErrorState
            onRetry={refetch}
            message="Impossibile caricare gli interventi di manutenzione."
          />
        </Card>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="animate-fade-in space-y-6">
        {header}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <KpiCardSkeleton key={i} />
          ))}
        </div>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {COLUMNS.map((c) => (
            <ColumnSkeleton key={c.status} column={c} />
          ))}
        </div>
      </div>
    );
  }

  const { items, stats } = data;
  const hasUrgentOpen = items.some((i) => i.priority === 'urgent' && i.status !== 'done');
  const byStatus = (status: MaintenanceStatus) => items.filter((i) => i.status === status);

  return (
    <div className="animate-fade-in space-y-6">
      {header}

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <div className="relative">
          <KpiCard label="Interventi Aperti" value={stats.open} icon={AlertCircle} accent="warning" />
          {hasUrgentOpen && (
            <Badge variant="danger" className="absolute bottom-5 left-6">
              URGENTE
            </Badge>
          )}
        </div>
        <KpiCard label="In Corso" value={stats.in_progress} icon={RefreshCw} accent="primary" />
        <KpiCard
          label="Completati (mese)"
          value={stats.completed_month}
          icon={CheckCircle2}
          accent="success"
        />
        <KpiCard
          label="Costo Medio Intervento"
          value={formatCurrency(stats.avg_cost)}
          icon={Euro}
          accent="secondary"
        />
      </div>

      {/* Kanban board */}
      <div className="flex gap-4 overflow-x-auto pb-2">
        {COLUMNS.map((column) => (
          <Column key={column.status} column={column} items={byStatus(column.status)} />
        ))}
      </div>

      {/* Footer summary */}
      <div className="flex flex-wrap items-center gap-x-10 gap-y-2 border-t border-border pt-4 text-sm text-muted">
        <span>
          Costo totale interventi aperti:{' '}
          <span className="font-semibold text-navy">{formatCurrency(stats.total_open_cost)}</span>
        </span>
        {stats.top_supplier && (
          <span>
            Fornitore più attivo:{' '}
            <span className="font-semibold text-navy">{stats.top_supplier.name}</span> (
            {stats.top_supplier.count} interventi)
          </span>
        )}
      </div>
    </div>
  );
}
