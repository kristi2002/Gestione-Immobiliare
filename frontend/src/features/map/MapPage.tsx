import { useMemo, useState, type ReactNode } from 'react';
import { Building2, MapPin, Minus, Plus, Search, X } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ImageWithFallback } from '@/components/common/ImageWithFallback';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { PropertyListItem } from '@/types/property';
import { useMapProperties } from './api';

// Agency HQ (Civitanova Marche) — used only to derive a real "distance" label.
const AGENCY = { lat: 43.3076, lng: 13.7228 };

type MainFilter = 'all' | 'vendita' | 'affitto' | 'available' | 'sold';
type ListFilter = 'all' | 'vendita' | 'affitto' | 'commerciale';

const MAIN_FILTERS: { key: MainFilter; label: string }[] = [
  { key: 'all', label: 'Tutti' },
  { key: 'vendita', label: 'Vendita' },
  { key: 'affitto', label: 'Affitto' },
  { key: 'available', label: 'Disponibile' },
  { key: 'sold', label: 'Venduto' },
];

const LIST_FILTERS: { key: ListFilter; label: string }[] = [
  { key: 'all', label: 'Tutti' },
  { key: 'vendita', label: 'Vendita' },
  { key: 'affitto', label: 'Affitto' },
  { key: 'commerciale', label: 'Commerciale' },
];

// Pin colour by status (per spec): disponibile=primary, affittato=success, venduto=neutral.
const PIN_COLORS: Record<string, string> = {
  available: 'text-primary',
  rented: 'text-success',
  sold: 'text-slate-400',
  reserved: 'text-warning',
};

interface PinPos {
  item: PropertyListItem;
  x: number; // 0–100 (%)
  y: number; // 0–100 (%)
}

function num(v: string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function distanceLabel(p: PropertyListItem): string | null {
  const lat = num(p.latitude);
  const lng = num(p.longitude);
  if (lat == null || lng == null) return null;
  return `${haversineKm(AGENCY.lat, AGENCY.lng, lat, lng).toFixed(1)} km`;
}

function matchMain(p: PropertyListItem, f: MainFilter): boolean {
  switch (f) {
    case 'vendita':
      return p.price_type === 'vendita';
    case 'affitto':
      return p.price_type === 'affitto';
    case 'available':
      return p.status === 'available';
    case 'sold':
      return p.status === 'sold';
    default:
      return true;
  }
}

function matchList(p: PropertyListItem, f: ListFilter): boolean {
  switch (f) {
    case 'vendita':
      return p.price_type === 'vendita';
    case 'affitto':
      return p.price_type === 'affitto';
    case 'commerciale':
      return ['ufficio', 'negozio', 'box'].includes((p.property_type ?? '').toLowerCase());
    default:
      return true;
  }
}

/**
 * Normalise each property's lat/lng into the container's 0–100% box using the
 * min/max of the visible set. Items without coordinates (or when the set has no
 * usable spread) fall back to a deterministic pseudo-grid so the panel is never
 * empty. Latitude is inverted so north sits at the top.
 */
function computePins(items: PropertyListItem[]): PinPos[] {
  const valid = items
    .map((it) => ({ it, lat: num(it.latitude), lng: num(it.longitude) }))
    .filter((g): g is { it: PropertyListItem; lat: number; lng: number } => g.lat != null && g.lng != null);

  const lats = valid.map((g) => g.lat);
  const lngs = valid.map((g) => g.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spanLat = maxLat - minLat;
  const spanLng = maxLng - minLng;
  const useGeo = valid.length >= 2 && (spanLat > 1e-6 || spanLng > 1e-6);

  const cols = Math.max(1, Math.ceil(Math.sqrt(items.length)));
  const rows = Math.max(1, Math.ceil(items.length / cols));

  return items.map((it, i) => {
    const lat = num(it.latitude);
    const lng = num(it.longitude);
    if (useGeo && lat != null && lng != null) {
      const nx = spanLng > 1e-6 ? (lng - minLng) / spanLng : 0.5;
      const ny = spanLat > 1e-6 ? (lat - minLat) / spanLat : 0.5;
      return { item: it, x: 12 + nx * 76, y: 12 + (1 - ny) * 76 };
    }
    const col = i % cols;
    const row = Math.floor(i / cols);
    const jitter = (((i * 37) % 13) / 13 - 0.5) * 5; // deterministic ±2.5%
    const x = 14 + (cols > 1 ? col / (cols - 1) : 0.5) * 72 + jitter;
    const y = 14 + (rows > 1 ? row / (rows - 1) : 0.5) * 72 + jitter;
    return { item: it, x: clamp(x, 6, 94), y: clamp(y, 6, 94) };
  });
}

// -- Small building blocks ---------------------------------------------------

function Chip({
  active,
  onClick,
  children,
  inactiveVariant = 'outline',
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  inactiveVariant?: 'outline' | 'ghost';
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? 'primary' : inactiveVariant}
      onClick={onClick}
      className="rounded-full"
    >
      {children}
    </Button>
  );
}

function PropertyRow({
  item,
  selected,
  onSelect,
}: {
  item: PropertyListItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const dist = distanceLabel(item);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border border-border bg-white p-3 text-left transition hover:shadow-card',
        selected && 'ring-2 ring-primary',
      )}
    >
      <ImageWithFallback
        src={item.cover_url}
        alt={item.address}
        className="size-14 shrink-0 rounded-lg object-cover"
        fallbackClassName="size-14 shrink-0 rounded-lg"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-navy">{item.address}</p>
        {item.city && <p className="truncate text-xs text-muted">{item.city}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-primary">{formatCurrency(item.price)}</span>
          <StatusBadge status={item.status} />
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end justify-between gap-3 self-stretch">
        <span
          className={cn(
            'size-4 rounded-full border-2',
            selected ? 'border-primary bg-primary' : 'border-slate-300 bg-white',
          )}
        />
        {dist && <span className="text-xs text-muted">{dist}</span>}
      </div>
    </button>
  );
}

// -- Page --------------------------------------------------------------------

export default function MapPage() {
  const { data, isLoading, isError, refetch } = useMapProperties(200);

  const [mainFilter, setMainFilter] = useState<MainFilter>('all');
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);

  const all = data?.items ?? [];

  // The map shows the header-filtered set; the left list narrows it further.
  const mapItems = useMemo(() => all.filter((p) => matchMain(p, mainFilter)), [all, mainFilter]);
  const pins = useMemo(() => computePins(mapItems), [mapItems]);

  const listItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return mapItems.filter(
      (p) =>
        matchList(p, listFilter) &&
        (q === '' ||
          (p.address ?? '').toLowerCase().includes(q) ||
          (p.city ?? '').toLowerCase().includes(q)),
    );
  }, [mapItems, listFilter, search]);

  const selectedPin = pins.find((pin) => pin.item.id === selectedId) ?? null;

  const header = (
    <PageHeader
      title="Mappa Immobili"
      subtitle="Visualizzazione geografica del portafoglio"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {MAIN_FILTERS.map((f) => (
            <Chip key={f.key} active={mainFilter === f.key} onClick={() => setMainFilter(f.key)}>
              {f.label}
            </Chip>
          ))}
        </div>
      }
    />
  );

  if (isError) {
    return (
      <div className="animate-fade-in space-y-6">
        {header}
        <Card>
          <ErrorState onRetry={() => refetch()} />
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="animate-fade-in space-y-6">
        {header}
        <div className="grid grid-cols-1 gap-6 lg:h-[620px] lg:grid-cols-5">
          <Card className="flex flex-col gap-4 lg:col-span-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-11 w-full" />
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-xl" />
              ))}
            </div>
          </Card>
          <Card className="lg:col-span-3">
            <Skeleton className="h-full min-h-[420px] w-full rounded-2xl" />
          </Card>
        </div>
      </div>
    );
  }

  if (all.length === 0) {
    return (
      <div className="animate-fade-in space-y-6">
        {header}
        <Card>
          <EmptyState
            icon={Building2}
            title="Nessun immobile da mostrare"
            description="Aggiungi immobili al portafoglio per visualizzarli sulla mappa."
            action={
              <Button asChild>
                <a href="/index.php?view=property_edit">Nuovo immobile</a>
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      {header}

      <div className="grid grid-cols-1 gap-6 lg:h-[620px] lg:grid-cols-5">
        {/* LEFT — list */}
        <Card className="flex min-h-0 flex-col gap-4 lg:col-span-2">
          <div>
            <h2 className="text-card-title text-navy">Immobili in zona</h2>
            <p className="text-sm text-muted">{listItems.length}</p>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca indirizzo…"
              className="pl-11"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {LIST_FILTERS.map((f) => (
              <Chip
                key={f.key}
                active={listFilter === f.key}
                onClick={() => setListFilter(f.key)}
                inactiveVariant="ghost"
              >
                {f.label}
              </Chip>
            ))}
          </div>

          <div className="-mr-2 min-h-0 flex-1 space-y-3 overflow-y-auto pr-2">
            {listItems.length === 0 ? (
              <EmptyState
                icon={Search}
                title="Nessun risultato"
                description="Nessun immobile corrisponde ai filtri selezionati."
              />
            ) : (
              listItems.map((item) => (
                <PropertyRow
                  key={item.id}
                  item={item}
                  selected={selectedId === item.id}
                  onSelect={() => setSelectedId(item.id)}
                />
              ))
            )}
          </div>
        </Card>

        {/* RIGHT — map surface */}
        <Card className="relative min-h-[440px] overflow-hidden p-0 lg:col-span-3">
          {/* map-like background: gradient + faint grid */}
          <div
            className="absolute inset-0"
            style={{
              backgroundColor: '#eef2f8',
              backgroundImage: [
                'linear-gradient(180deg, #f1f5fb 0%, #e7edf6 100%)',
                'linear-gradient(rgba(148,163,184,0.14) 1px, transparent 1px)',
                'linear-gradient(90deg, rgba(148,163,184,0.14) 1px, transparent 1px)',
              ].join(','),
              backgroundSize: `100% 100%, ${40 * zoom}px ${40 * zoom}px, ${40 * zoom}px ${40 * zoom}px`,
            }}
          >
            {/* faint "roads" for a map feel */}
            <div className="absolute left-0 top-1/3 h-px w-full bg-slate-300/50" />
            <div className="absolute left-1/2 top-0 h-full w-px bg-slate-300/50" />
            <div className="absolute -left-10 top-2/3 h-1.5 w-[130%] -rotate-6 rounded-full bg-slate-300/40" />
            <div className="absolute left-1/4 top-0 h-[130%] w-1.5 rotate-12 rounded-full bg-slate-300/40" />
          </div>

          {/* search overlay (top-center, visual) */}
          <div className="absolute left-1/2 top-4 z-20 w-[min(88%,26rem)] -translate-x-1/2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                placeholder="Cerca indirizzo completo…"
                className="border-transparent pl-11 shadow-card"
                aria-label="Cerca indirizzo completo"
              />
            </div>
          </div>

          {/* pins */}
          {pins.map(({ item, x, y }) => {
            const selected = item.id === selectedId;
            return (
              <button
                type="button"
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={cn(
                  'absolute z-10 -translate-x-1/2 -translate-y-full transition-transform hover:scale-110',
                  selected && 'z-30',
                )}
                style={{ left: `${x}%`, top: `${y}%` }}
                aria-label={item.address}
              >
                <MapPin
                  className={cn(
                    'drop-shadow',
                    PIN_COLORS[item.status] ?? 'text-slate-400',
                    selected ? 'size-10 drop-shadow-lg' : 'size-7',
                  )}
                  fill="currentColor"
                  strokeWidth={selected ? 2 : 1.5}
                />
              </button>
            );
          })}

          {/* selected popup card */}
          {selectedPin && (
            <div
              className="absolute z-40 w-60"
              style={{
                left: `${clamp(selectedPin.x, 18, 82)}%`,
                top: `${selectedPin.y}%`,
                transform: `translate(-50%, ${
                  selectedPin.y > 42 ? 'calc(-100% - 44px)' : '28px'
                })`,
              }}
            >
              <Card className="relative p-3 shadow-card-hover">
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full text-muted transition hover:bg-slate-100"
                  aria-label="Chiudi"
                >
                  <X className="size-4" />
                </button>
                <ImageWithFallback
                  src={selectedPin.item.cover_url}
                  alt={selectedPin.item.address}
                  className="mb-2 h-28 w-full rounded-lg object-cover"
                  fallbackClassName="mb-2 h-28 w-full rounded-lg"
                />
                <p className="pr-6 text-sm font-semibold text-navy">{selectedPin.item.address}</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-primary">
                    {formatCurrency(selectedPin.item.price)}
                  </span>
                  <StatusBadge status={selectedPin.item.status} />
                </div>
                <Button asChild size="sm" className="mt-3 w-full">
                  <a href={`/app/properties/${selectedPin.item.id}`}>Vedi Scheda</a>
                </Button>
              </Card>
            </div>
          )}

          {/* zoom controls (visual) */}
          <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="rounded-full shadow-card"
              onClick={() => setZoom((z) => clamp(+(z + 0.2).toFixed(2), 0.6, 1.8))}
              aria-label="Ingrandisci"
            >
              <Plus className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="rounded-full shadow-card"
              onClick={() => setZoom((z) => clamp(+(z - 0.2).toFixed(2), 0.6, 1.8))}
              aria-label="Riduci"
            >
              <Minus className="size-4" />
            </Button>
          </div>

          {/* scale hint */}
          <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2 rounded-md bg-white/80 px-2 py-1 text-xs text-muted shadow-sm">
            <span className="h-px w-8 bg-navy" />
            200m
          </div>
        </Card>
      </div>
    </div>
  );
}
