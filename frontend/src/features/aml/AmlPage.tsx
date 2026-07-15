import { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Plus,
  Download,
  ShieldCheck,
  AlertTriangle,
  AlertOctagon,
  CalendarClock,
  Eye,
  SquarePen,
  FileText,
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { KpiCard, KpiCardSkeleton } from '@/components/common/KpiCard';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { Pagination } from '@/components/common/Pagination';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import { useDebounce } from '@/lib/hooks/useDebounce';
import {
  useAmlList,
  useAmlCompletedCount,
  useAmlExpiring,
  type AmlRecord,
  type AmlRiskLevel,
  type AmlStatus,
  type AmlSubjectType,
  type AmlOperationType,
} from './api';

type BadgeVariant = NonNullable<BadgeProps['variant']>;

const SUBJECT_META: Record<AmlSubjectType, { code: string; label: string; variant: BadgeVariant }> = {
  persona_fisica: { code: 'PF', label: 'Persona fisica', variant: 'primary' },
  persona_giuridica: { code: 'PG', label: 'Persona giuridica', variant: 'secondary' },
};

const RISK_META: Record<AmlRiskLevel, { label: string; variant: BadgeVariant; dot: string }> = {
  basso: { label: 'Basso', variant: 'success', dot: 'bg-success' },
  medio: { label: 'Medio', variant: 'warning', dot: 'bg-warning' },
  alto: { label: 'Alto', variant: 'danger', dot: 'bg-danger' },
};

const STATUS_META: Record<AmlStatus, { label: string; variant: BadgeVariant }> = {
  completata: { label: 'Completo', variant: 'success' },
  da_completare: { label: 'Da completare', variant: 'warning' },
  sospesa: { label: 'Sospesa', variant: 'neutral' },
};

const OPERATION_LABEL: Record<AmlOperationType, string> = {
  vendita: 'Vendita',
  locazione: 'Locazione',
  mediazione: 'Mediazione',
  altro: 'Altro',
};

const TIPO_OPTIONS = [
  { value: '', label: 'Tutti i tipi' },
  { value: 'persona_fisica', label: 'Persona fisica (PF)' },
  { value: 'persona_giuridica', label: 'Persona giuridica (PG)' },
];

const STATO_OPTIONS = [
  { value: '', label: 'Tutti gli stati' },
  { value: 'completata', label: 'Completo' },
  { value: 'da_completare', label: 'Da completare' },
  { value: 'sospesa', label: 'Sospesa' },
];

const RISK_OPTIONS = [
  { value: '', label: 'Tutti i profili' },
  { value: 'basso', label: 'Basso' },
  { value: 'medio', label: 'Medio' },
  { value: 'alto', label: 'Alto' },
];

const PAGE_SIZE = 25;

export default function AmlPage() {
  const [search, setSearch] = useState('');
  const [tipo, setTipo] = useState('');
  const [stato, setStato] = useState('');
  const [risk, setRisk] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search, 350);

  const { data, isLoading, isError, refetch } = useAmlList({
    search: debounced,
    status: stato,
    risk_level: risk,
    page,
    limit: PAGE_SIZE,
  });
  const { data: completedCount } = useAmlCompletedCount();
  const { data: expiring } = useAmlExpiring();

  useEffect(() => setPage(1), [debounced, stato, risk, tipo]);

  const stats = data?.stats;

  // "Tipo" (subject_type) is not a server filter — narrow the current page client-side.
  const rows = useMemo(() => {
    const items = data?.items ?? [];
    return tipo ? items.filter((r) => r.subject_type === tipo) : items;
  }, [data?.items, tipo]);

  // Soonest upcoming retention deadline across the expiring set.
  const nextReview = useMemo(() => {
    if (!expiring || expiring.length === 0) return null;
    const today = new Date().toISOString().slice(0, 10);
    const dates = expiring
      .map((r) => r.retention_until)
      .filter((d): d is string => !!d && d >= today)
      .sort();
    return dates[0] ?? null;
  }, [expiring]);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Antiriciclaggio"
        subtitle="Adempimenti D.Lgs. 231/2007 — Identificazione e profilazione clienti"
        actions={
          <>
            <Button>
              <Plus className="size-4" />
              Nuova Scheda AML
            </Button>
            <Button variant="outline">
              <Download className="size-4" />
              Esporta Registro
            </Button>
          </>
        }
      />

      {/* Compliance notice */}
      <div className="flex items-start gap-3 rounded-2xl bg-primary/10 px-5 py-4 text-sm text-navy">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
        <p>
          Obbligo di identificazione e verifica della clientela ai sensi del D.Lgs. 231/2007.
          Conservare la documentazione per 10 anni.
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading && !stats ? (
          Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
        ) : (
          <>
            <KpiCard
              label="Schede Completate"
              value={completedCount ?? 0}
              icon={ShieldCheck}
              accent="success"
            />
            <KpiCard
              label="Da Completare"
              value={stats?.pending ?? 0}
              icon={AlertTriangle}
              accent="warning"
            />
            <KpiCard
              label="Operazioni Segnalate"
              value={0}
              icon={AlertOctagon}
              accent="primary"
              caption="Segnalazioni UIF"
            />
            <KpiCard
              label="Prossima Revisione"
              value={nextReview ? formatDate(nextReview) : '—'}
              icon={CalendarClock}
              accent="secondary"
              caption={stats?.expiring ? `${stats.expiring} in scadenza` : undefined}
            />
          </>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca per nome…"
            className="pl-11"
          />
        </div>
        <Select className="w-48" value={tipo} onChange={(e) => setTipo(e.target.value)} options={TIPO_OPTIONS} />
        <Select className="w-48" value={stato} onChange={(e) => setStato(e.target.value)} options={STATO_OPTIONS} />
        <Select className="w-48" value={risk} onChange={(e) => setRisk(e.target.value)} options={RISK_OPTIONS} />
      </div>

      {/* Registry */}
      {isError ? (
        <Card>
          <ErrorState onRetry={() => refetch()} />
        </Card>
      ) : (
        <Card className="p-2">
          <CardHeader className="px-4 pt-3">
            <CardTitle>Registro Identificazione Clienti</CardTitle>
          </CardHeader>
          <RegistryTable rows={rows} isLoading={isLoading} />
        </Card>
      )}

      {data && !tipo && (
        <Pagination
          page={data.page}
          pages={data.pages}
          total={data.total}
          onPageChange={setPage}
          itemLabel="schede"
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

const HEADERS = [
  '#',
  'Cliente',
  'Tipo',
  'Operazione',
  'Data Identificazione',
  'Profilo Rischio',
  'Stato',
  'Azioni',
];

function RegistryTable({ rows, isLoading }: { rows: AmlRecord[]; isLoading?: boolean }) {
  const showEmpty = !isLoading && rows.length === 0;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-gray-100">
            {HEADERS.map((h) => (
              <th
                key={h}
                className={cn(
                  'px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-gray-400',
                  h === '#' && 'w-10',
                  h === 'Azioni' && 'text-right',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading &&
            Array.from({ length: 8 }).map((_, i) => (
              <tr key={`sk-${i}`} className="border-b border-gray-100">
                {HEADERS.map((h) => (
                  <td key={h} className="px-4 py-3.5">
                    <Skeleton className="h-4 w-full max-w-[120px]" />
                  </td>
                ))}
              </tr>
            ))}

          {!isLoading &&
            rows.map((row, i) => {
              const subject = SUBJECT_META[row.subject_type];
              const riskMeta = RISK_META[row.risk_level];
              const statusMeta = STATUS_META[row.status];
              const attention = row.status === 'da_completare';
              const identifier = row.codice_fiscale ?? row.partita_iva;

              return (
                <tr
                  key={row.id}
                  className={cn(
                    'border-b border-gray-100 text-sm text-navy transition-colors last:border-0',
                    attention ? 'bg-warning/5 hover:bg-warning/10' : 'hover:bg-[#F8F9FB]',
                  )}
                >
                  <td className="px-4 py-3.5 text-muted">{i + 1}</td>

                  <td className="px-4 py-3.5">
                    <p className="font-semibold text-navy">{row.subject_name}</p>
                    {identifier && (
                      <p className="mt-0.5 text-xs text-muted">
                        {row.codice_fiscale ? 'CF' : 'P.IVA'}: {identifier}
                      </p>
                    )}
                  </td>

                  <td className="px-4 py-3.5">
                    <Badge variant={subject.variant} title={subject.label}>
                      {subject.code}
                    </Badge>
                  </td>

                  <td className="px-4 py-3.5">{OPERATION_LABEL[row.operation_type]}</td>

                  <td className="px-4 py-3.5">{formatDate(row.verification_date)}</td>

                  <td className="px-4 py-3.5">
                    <span className="inline-flex items-center gap-2">
                      <span className={cn('size-2 rounded-full', riskMeta.dot)} />
                      <Badge variant={riskMeta.variant}>{riskMeta.label}</Badge>
                    </span>
                  </td>

                  <td className="px-4 py-3.5">
                    <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                  </td>

                  <td className="px-4 py-3.5">
                    <div className="flex items-center justify-end gap-1 text-muted">
                      <IconAction icon={Eye} label="Visualizza" />
                      <IconAction icon={SquarePen} label="Modifica" />
                      <IconAction icon={FileText} label="Documenti" />
                    </div>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>

      {showEmpty && (
        <EmptyState
          icon={ShieldCheck}
          title="Nessuna scheda AML"
          description="Non ci sono adempimenti di adeguata verifica corrispondenti ai filtri."
        />
      )}
    </div>
  );
}

function IconAction({ icon: Icon, label }: { icon: typeof Eye; label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-slate-100 hover:text-navy"
    >
      <Icon className="size-4" />
    </button>
  );
}
