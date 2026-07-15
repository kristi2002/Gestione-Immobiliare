import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Plus, StickyNote } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { ErrorState } from '@/components/common/ErrorState';
import { EmptyState } from '@/components/common/EmptyState';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, capitalize } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  useScadenzario,
  type ScadenzarioItem,
  type ScadenzarioSeverity,
} from './api';

const YEAR = new Date().getFullYear();

/** Recurring fiscal obligations (renewed periodically) vs one-off contract ends. */
const RECURRING_TYPES = new Set(['registration', 'ape', 'insurance', 'aml']);

type TabKey = 'all' | 'recurring' | 'soon' | 'year';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'Tutti' },
  { key: 'recurring', label: 'Ricorrente' },
  { key: 'soon', label: 'Imminenti (≤30gg)' },
  { key: 'year', label: `Anno ${YEAR}` },
];

/** Severity derived from days_until, falling back to the server classification. */
function severityOf(item: ScadenzarioItem): ScadenzarioSeverity {
  if (item.days_until == null) return item.severity;
  if (item.days_until < 0) return 'overdue';
  if (item.days_until <= 30) return 'soon';
  return 'upcoming';
}

const SEVERITY_BADGE: Record<
  ScadenzarioSeverity,
  { label: string; variant: 'danger' | 'warning' | 'neutral' }
> = {
  overdue: { label: 'Scaduto', variant: 'danger' },
  soon: { label: 'Imminente', variant: 'warning' },
  upcoming: { label: 'Futura', variant: 'neutral' },
};

/** Pill background/text for the calendar date chip. */
const PILL_CLASS: Record<ScadenzarioSeverity, string> = {
  overdue: 'bg-danger/10 text-danger',
  soon: 'bg-warning/10 text-warning',
  upcoming: 'bg-slate-100 text-slate-600',
};

interface MonthGroup {
  key: string;
  label: string;
  items: ScadenzarioItem[];
}

function groupByMonth(items: ScadenzarioItem[]): MonthGroup[] {
  const groups = new Map<string, MonthGroup>();
  for (const item of items) {
    if (!item.date) continue;
    const d = new Date(`${item.date}T00:00:00`);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: capitalize(d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })),
        items: [],
      };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return Array.from(groups.values()).sort((a, b) => a.key.localeCompare(b.key));
}

export default function ScadenzarioPage() {
  const { data, isLoading, isError, refetch } = useScadenzario(365);
  const [tab, setTab] = useState<TabKey>('all');

  const items = data?.items ?? [];
  const stats = data?.stats;

  const monthGroups = useMemo(() => groupByMonth(items), [items]);

  const filtered = useMemo(() => {
    switch (tab) {
      case 'recurring':
        return items.filter((it) => RECURRING_TYPES.has(it.type));
      case 'soon':
        return items.filter((it) => {
          const s = severityOf(it);
          return s === 'soon' || s === 'overdue';
        });
      case 'year':
        return items.filter((it) => it.date?.startsWith(String(YEAR)));
      default:
        return items;
    }
  }, [items, tab]);

  const columns: Column<ScadenzarioItem>[] = [
    {
      id: 'date',
      header: 'Data Scadenza',
      cell: (row) => <span className="font-medium text-navy">{formatDate(row.date)}</span>,
    },
    {
      id: 'label',
      header: 'Descrizione',
      cell: (row) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-navy">{row.label}</div>
          <div className="truncate text-xs text-muted">{row.subject}</div>
        </div>
      ),
    },
    {
      id: 'context',
      header: 'Contesto',
      cell: (row) => <span className="text-muted">{row.context || '—'}</span>,
    },
    {
      id: 'severity',
      header: 'Severità',
      cell: (row) => {
        const b = SEVERITY_BADGE[severityOf(row)];
        return <Badge variant={b.variant}>{b.label}</Badge>;
      },
    },
    {
      id: 'actions',
      header: '',
      align: 'right',
      cell: () => (
        <Button variant="outline" size="sm">
          Completa
        </Button>
      ),
    },
  ];

  const showAlert = !!stats && stats.soon + stats.overdue > 0;

  const headerActions = (
    <>
      <span className="inline-flex items-center rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white">
        {YEAR}
      </span>
      <Button variant="primary" size="sm">
        <Plus className="size-4" />
        Aggiungi Scadenza
      </Button>
    </>
  );

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Scadenzario Fiscale"
        subtitle="Scadenze tributarie e adempimenti fiscali immobiliari"
        actions={headerActions}
      />

      {isError ? (
        <Card>
          <ErrorState onRetry={() => refetch()} />
        </Card>
      ) : isLoading || !data ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-96 w-full rounded-2xl" />
          <Skeleton className="h-96 w-full rounded-2xl" />
        </div>
      ) : (
        <>
          {showAlert && stats && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-5 py-4">
              <AlertTriangle className="size-5 shrink-0 text-warning" />
              <p className="flex-1 text-sm font-medium text-navy">
                {stats.soon + stats.overdue} scadenze fiscali entro 30 giorni — Verifica gli adempimenti
              </p>
              <button
                type="button"
                onClick={() => setTab('soon')}
                className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
              >
                Visualizza
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* LEFT — annual fiscal calendar */}
            <Card>
              <CardHeader>
                <CardTitle>Calendario Fiscale Annuale</CardTitle>
              </CardHeader>
              {monthGroups.length === 0 ? (
                <EmptyState
                  icon={CalendarClock}
                  title="Nessuna scadenza"
                  description="Non ci sono adempimenti fiscali nei prossimi 12 mesi."
                />
              ) : (
                <div className="space-y-5">
                  {monthGroups.map((group) => (
                    <div key={group.key}>
                      <h4 className="mb-2 text-eyebrow">{group.label}</h4>
                      <ul className="space-y-1">
                        {group.items.map((item, i) => {
                          const sev = severityOf(item);
                          const day = item.date ? item.date.slice(8, 10) : '—';
                          return (
                            <li
                              key={`${item.type}-${item.entity_id}-${i}`}
                              className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-[#F8F9FB]"
                            >
                              <span
                                className={cn(
                                  'flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold',
                                  PILL_CLASS[sev],
                                )}
                              >
                                {day}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-navy">{item.label}</div>
                                <div className="truncate text-xs text-muted">{item.subject}</div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* RIGHT — deadline detail + notes */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Dettaglio Scadenze</CardTitle>
                </CardHeader>

                <div className="mb-4 flex flex-wrap gap-1 border-b border-gray-100">
                  {TABS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setTab(t.key)}
                      className={cn(
                        '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                        tab === t.key
                          ? 'border-primary text-primary'
                          : 'border-transparent text-muted hover:text-navy',
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <DataTable
                  columns={columns}
                  data={filtered}
                  rowKey={(row) => `${row.type}-${row.entity_id}-${row.date}`}
                  empty={{
                    icon: CalendarClock,
                    title: 'Nessuna scadenza',
                    description: 'Nessun adempimento per il filtro selezionato.',
                  }}
                />
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <StickyNote className="size-4 text-muted" />
                    Note Fiscalista
                  </CardTitle>
                </CardHeader>
                <div className="space-y-1.5 text-sm text-muted">
                  <p>Ricordarsi di verificare la possibilità di compensazione</p>
                  <p>F24 per IMU e liquidazione IVA.</p>
                </div>
                <div className="mt-4">
                  <Button variant="primary" size="sm">
                    <Plus className="size-4" />
                    Aggiungi Nota
                  </Button>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
