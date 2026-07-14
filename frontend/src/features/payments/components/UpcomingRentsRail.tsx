import { CalendarClock, Check } from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { formatCurrencyCents, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Payment } from '@/types/finance';
import { usePayments, useMarkPaid } from '../api';

function tenantName(p: Payment): string {
  return [p.tenant_name, p.tenant_surname].filter(Boolean).join(' ') || 'Inquilino';
}

function isOverdue(due: string): boolean {
  return new Date(due.replace(' ', 'T')).getTime() < Date.now();
}

/** "Canoni in Scadenza" — next pending rents, soonest first. */
export function UpcomingRentsRail() {
  const { data, isLoading } = usePayments({ status: 'pending' });
  const markPaid = useMarkPaid();

  const upcoming = [...(data?.items ?? [])]
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 6);

  return (
    <Card className="h-full">
      <CardTitle className="mb-4 flex items-center gap-2">
        <CalendarClock className="size-4 text-muted" />
        Canoni in Scadenza
      </CardTitle>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : upcoming.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Tutto in regola" description="Nessun canone in attesa." />
      ) : (
        <ul className="space-y-2">
          {upcoming.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-xl border border-gray-100 p-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-navy">{tenantName(p)}</p>
                <p className={cn('text-xs', isOverdue(p.due_date) ? 'font-medium text-danger' : 'text-muted')}>
                  {isOverdue(p.due_date) ? 'Scaduto ' : 'Scad. '}
                  {formatDate(p.due_date)}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold text-navy">{formatCurrencyCents(p.amount)}</span>
              <Button
                variant="primary"
                size="sm"
                disabled={markPaid.isPending}
                onClick={() => markPaid.mutate(p)}
              >
                <Check className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
