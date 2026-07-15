import { Clock, Plus, Workflow, Zap } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { KpiCard, KpiCardSkeleton } from '@/components/common/KpiCard';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAutomations, useToggleAutomation, type Automation } from './api';
import { Toggle } from './components/Toggle';
import { FlowPreview } from './components/FlowPreview';

/** Fallback accent bars when a row has no explicit hex color. */
const BAR_CYCLE = ['bg-primary', 'bg-warning', 'bg-danger', 'bg-success', 'bg-slate-400'];

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isHex(color: string | null): color is string {
  return !!color && HEX_RE.test(color.trim());
}

export default function AutomationsPage() {
  const { data, isLoading, isError, refetch } = useAutomations();
  const toggle = useToggleAutomation();

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Automazioni"
        subtitle="Flussi automatici per email, notifiche e azioni"
        actions={
          <Button type="button">
            <Plus className="size-4" />
            Nuova Automazione
          </Button>
        }
      />

      {isError ? (
        <Card>
          <ErrorState onRetry={() => refetch()} />
        </Card>
      ) : isLoading || !data ? (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <KpiCardSkeleton key={i} />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full rounded-xl" />
                ))}
              </div>
            </Card>
            <Skeleton className="h-96 w-full rounded-2xl" />
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <KpiCard
              label="Automazioni Attive"
              value={data.stats.active_count}
              icon={Workflow}
              accent="primary"
            />
            <KpiCard
              label="Esecuzioni Totali"
              value={formatNumber(data.stats.total_runs)}
              icon={Zap}
              accent="secondary"
            />
            <KpiCard
              label="Tempo Risparmiato"
              value={`~${data.stats.hours_saved}h/mese`}
              icon={Clock}
              accent="success"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>Le Tue Automazioni</CardTitle>
              </CardHeader>
              <CardContent>
                {data.items.length === 0 ? (
                  <EmptyState
                    icon={Workflow}
                    title="Nessuna automazione"
                    description="Crea la tua prima automazione"
                    action={
                      <Button type="button" size="sm">
                        <Plus className="size-4" />
                        Nuova Automazione
                      </Button>
                    }
                  />
                ) : (
                  <ul className="space-y-3">
                    {data.items.map((item, i) => (
                      <AutomationRow
                        key={item.id}
                        item={item}
                        index={i}
                        onToggle={(active) => toggle.mutate({ id: item.id, active })}
                        disabled={toggle.isPending}
                      />
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Anteprima Flusso</CardTitle>
              </CardHeader>
              <CardContent>
                <FlowPreview />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

interface AutomationRowProps {
  item: Automation;
  index: number;
  onToggle: (active: boolean) => void;
  disabled?: boolean;
}

function AutomationRow({ item, index, onToggle, disabled }: AutomationRowProps) {
  const useHex = isHex(item.color);
  const barClass = useHex ? undefined : BAR_CYCLE[index % BAR_CYCLE.length];

  return (
    <li className="flex items-stretch gap-4 rounded-xl border border-border p-4 transition-shadow hover:shadow-card">
      <span
        className={cn('w-1.5 shrink-0 rounded-full', barClass)}
        style={useHex ? { backgroundColor: item.color as string } : undefined}
        aria-hidden
      />

      <div className="min-w-0 flex-1">
        <p className="font-semibold text-navy">{item.name}</p>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
          {item.trigger}
          {item.trigger && item.actions ? ' → ' : ''}
          {item.actions}
        </p>
        <p className="mt-1.5 text-[11px] text-muted">
          Eseguita {formatNumber(item.run_count)} volte
        </p>
      </div>

      <div className="flex items-center">
        <Toggle
          checked={item.active}
          onChange={onToggle}
          disabled={disabled}
          aria-label={`Attiva ${item.name}`}
        />
      </div>
    </li>
  );
}
