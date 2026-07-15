import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Building2,
  Eye,
  Globe2,
  MessageCircle,
  Plus,
  BarChart3,
  Megaphone,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { ErrorState } from '@/components/common/ErrorState';
import { EmptyState } from '@/components/common/EmptyState';
import { DataTable, type Column } from '@/components/common/DataTable';
import { ImageWithFallback } from '@/components/common/ImageWithFallback';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDate, formatNumber } from '@/lib/format';
import {
  PORTAL_KEYS,
  usePortalListings,
  type PortalKey,
  type PortalListing,
  type PortalStatus,
} from './api';

// --- Portal presentation metadata -------------------------------------------

const PORTAL_META: Record<PortalKey, { label: string; icon: LucideIcon }> = {
  immobiliare: { label: 'Immobiliare.it', icon: Building2 },
  idealista: { label: 'Idealista', icon: Globe2 },
  casa: { label: 'Casa.it', icon: Building2 },
  subito: { label: 'Subito.it', icon: Globe2 },
  sito_agenzia: { label: 'Sito Agenzia', icon: Globe2 },
  altro: { label: 'Altro', icon: Globe2 },
};

const STATUS_META: Record<PortalStatus, { label: string; variant: NonNullable<BadgeProps['variant']> }> = {
  published: { label: 'Pubblicato', variant: 'success' },
  publishing: { label: 'In corso', variant: 'warning' },
  draft: { label: 'Bozza', variant: 'neutral' },
  error: { label: 'Errore', variant: 'danger' },
  removed: { label: 'Rimosso', variant: 'neutral' },
};

// --- Grouped-by-property view model -----------------------------------------

interface PropertyGroup {
  propertyId: number;
  address: string;
  city: string | null;
  listings: PortalListing[];
  /** Most recent successful publish/sync timestamp across portals. */
  publishedAt: string | null;
  /** Representative overall status for the property. */
  status: PortalStatus;
  isDraft: boolean;
}

const STATUS_RANK: PortalStatus[] = ['published', 'publishing', 'error', 'draft', 'removed'];

function groupByProperty(items: PortalListing[]): PropertyGroup[] {
  const map = new Map<number, PortalListing[]>();
  for (const it of items) {
    const list = map.get(it.property_id) ?? [];
    list.push(it);
    map.set(it.property_id, list);
  }

  return Array.from(map.values()).map((listings) => {
    const first = listings[0];
    const status =
      STATUS_RANK.find((s) => listings.some((l) => l.status === s)) ?? 'draft';
    const publishedAt =
      listings
        .map((l) => l.last_synced_at ?? l.created_at)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;

    return {
      propertyId: first.property_id,
      address: first.property_address ?? `Immobile #${first.property_id}`,
      city: first.property_city ?? null,
      listings,
      publishedAt,
      status,
      isDraft: listings.every((l) => l.status === 'draft'),
    };
  });
}

// --- Tabs --------------------------------------------------------------------

type TabKey = 'all' | 'expiring' | 'draft';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'Tutti' },
  { key: 'expiring', label: 'In Scadenza' },
  { key: 'draft', label: 'Bozze' },
];

export default function PortalsPage() {
  const { data, isLoading, isError, refetch } = usePortalListings();
  const [tab, setTab] = useState<TabKey>('all');

  const items = data?.items ?? [];
  const groups = useMemo(() => groupByProperty(items), [items]);

  /** Published-listing count per portal — drives connection cards + chart. */
  const portalCounts = useMemo(() => {
    const counts = Object.fromEntries(PORTAL_KEYS.map((k) => [k, 0])) as Record<PortalKey, number>;
    for (const it of items) {
      if (it.status === 'published') counts[it.portal] += 1;
    }
    return counts;
  }, [items]);

  const chartData = useMemo(
    () =>
      PORTAL_KEYS.map((k) => ({ key: k, name: PORTAL_META[k].label, value: portalCounts[k] })).filter(
        (d) => d.value > 0,
      ),
    [portalCounts],
  );

  const visibleGroups = useMemo(() => {
    if (tab === 'draft') return groups.filter((g) => g.isDraft);
    // No expiry data is tracked by the endpoint yet — this tab renders empty.
    if (tab === 'expiring') return [] as PropertyGroup[];
    return groups;
  }, [groups, tab]);

  const columns: Column<PropertyGroup>[] = [
    {
      id: 'property',
      header: 'Immobile',
      cell: (g) => (
        <div className="flex items-center gap-3">
          <ImageWithFallback
            src={null}
            alt={g.address}
            className="size-11 shrink-0 rounded-lg object-cover"
            fallbackClassName="size-11 shrink-0 rounded-lg"
            fallback={<Building2 className="size-5" />}
          />
          <div className="min-w-0">
            <p className="truncate font-medium text-navy">{g.address}</p>
            <p className="truncate text-xs text-muted">{g.city ?? '—'}</p>
          </div>
        </div>
      ),
    },
    {
      id: 'portals',
      header: 'Portali pubblicati',
      cell: (g) => (
        <div className="flex flex-wrap gap-1">
          {g.listings.map((l) => (
            <Badge key={l.id} variant={STATUS_META[l.status].variant}>
              {PORTAL_META[l.portal].label}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      id: 'published',
      header: 'Data pubblicazione',
      cell: (g) => <span className="text-sm text-navy">{g.publishedAt ? formatDate(g.publishedAt) : '—'}</span>,
    },
    {
      id: 'expiry',
      header: 'Scadenza',
      cell: () => <span className="text-sm text-muted">—</span>,
    },
    {
      id: 'views',
      header: 'Visualizzazioni',
      align: 'center',
      cell: () => (
        <span className="inline-flex items-center gap-1.5 text-muted">
          <Eye className="size-4 text-secondary" />
          <span className="text-sm">—</span>
        </span>
      ),
    },
    {
      id: 'contacts',
      header: 'Contatti',
      align: 'center',
      cell: () => (
        <span className="inline-flex items-center gap-1.5 text-muted">
          <MessageCircle className="size-4 text-success" />
          <span className="text-sm">—</span>
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Stato',
      align: 'right',
      cell: (g) => {
        const meta = STATUS_META[g.status];
        return (
          <div className="flex justify-end">
            <Badge variant={meta.variant}>{meta.label}</Badge>
          </div>
        );
      },
    },
  ];

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Pubblicazione Portali"
        subtitle="Gestione annunci su Immobiliare.it, Casa.it, Idealista e altri"
        actions={
          <Button>
            <Plus className="size-4" />
            Nuova Pubblicazione
          </Button>
        }
      />

      {isError ? (
        <Card>
          <ErrorState onRetry={() => refetch()} />
        </Card>
      ) : (
        <>
          {/* Portal connection cards ------------------------------------- */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
            {isLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <Card key={i} className="p-4">
                    <Skeleton className="size-9 rounded-lg" />
                    <Skeleton className="mt-3 h-4 w-24" />
                    <Skeleton className="mt-2 h-3 w-20" />
                  </Card>
                ))
              : PORTAL_KEYS.map((key) => (
                  <PortalConnectionCard key={key} portal={key} count={portalCounts[key]} />
                ))}
          </div>

          {/* Main two-column area ---------------------------------------- */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            {/* LEFT — listings table */}
            <Card className="xl:col-span-2">
              <CardHeader className="mb-0 flex-col items-start gap-4 sm:flex-row sm:items-center">
                <CardTitle>Annunci Pubblicati</CardTitle>
                <div className="flex items-center gap-1">
                  {TABS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setTab(t.key)}
                      className={cn(
                        'border-b-2 px-3 py-1.5 text-sm font-medium transition-colors',
                        tab === t.key
                          ? 'border-primary text-primary'
                          : 'border-transparent text-muted hover:text-navy',
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </CardHeader>

              <div className="mt-4">
                <DataTable
                  columns={columns}
                  data={isLoading ? undefined : visibleGroups}
                  isLoading={isLoading}
                  rowKey={(g) => g.propertyId}
                  skeletonRows={6}
                  empty={{
                    icon: Megaphone,
                    title:
                      tab === 'expiring'
                        ? 'Nessun annuncio in scadenza'
                        : tab === 'draft'
                          ? 'Nessuna bozza'
                          : 'Nessun annuncio pubblicato',
                    description:
                      tab === 'all'
                        ? 'Pubblica un immobile sui portali per vederlo qui.'
                        : undefined,
                  }}
                />
              </div>
            </Card>

            {/* RIGHT — per-portal performance */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="size-4 text-primary" />
                  Performance Portali
                </CardTitle>
              </CardHeader>
              {isLoading ? (
                <Skeleton className="h-64 w-full rounded-xl" />
              ) : chartData.length === 0 ? (
                <EmptyState icon={BarChart3} title="Nessun dato" description="Nessun annuncio attivo." />
              ) : (
                <>
                  <p className="mb-3 text-xs text-muted">Annunci attivi per portale</p>
                  <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 46)}>
                    <BarChart
                      data={chartData}
                      layout="vertical"
                      margin={{ top: 0, right: 16, left: 8, bottom: 0 }}
                      barCategoryGap={12}
                    >
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={92}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 12, fill: '#06224F' }}
                      />
                      <Tooltip
                        cursor={{ fill: '#EEF2F8' }}
                        formatter={(v: number) => [formatNumber(v), 'Annunci']}
                        contentStyle={{ borderRadius: 12, border: '1px solid #E5E7EB', fontSize: 13 }}
                      />
                      <Bar dataKey="value" radius={[4, 4, 4, 4]} isAnimationActive={false}>
                        {chartData.map((_, i) => (
                          <Cell key={i} fill={i === 0 ? '#0B3D91' : '#4A90D9'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// --- Sub-components ----------------------------------------------------------

function PortalConnectionCard({ portal, count }: { portal: PortalKey; count: number }) {
  const { label, icon: Icon } = PORTAL_META[portal];
  const connected = count > 0;

  return (
    <Card className="p-4">
      <div
        className={cn(
          'flex size-9 items-center justify-center rounded-lg',
          connected ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-400',
        )}
      >
        <Icon className="size-5" />
      </div>
      <p className="mt-3 truncate text-sm font-semibold text-navy">{label}</p>
      {connected ? (
        <p className="mt-0.5 text-xs font-medium text-success">
          {formatNumber(count)} {count === 1 ? 'annuncio attivo' : 'annunci attivi'}
        </p>
      ) : (
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-xs text-muted">Non connesso</span>
          <Button variant="outline" size="sm">
            Connetti
          </Button>
        </div>
      )}
    </Card>
  );
}
