import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Home } from 'lucide-react';
import { api } from '@/lib/api/client';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatTime, capitalize } from '@/lib/format';
import type { Paginated } from '@/types/property';

interface Appt {
  id: number;
  appointment_date: string;
  status: string;
  property_address: string | null;
  lead_name: string | null;
  lead_surname: string | null;
  client_name: string | null;
  client_surname: string | null;
}

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function personOf(a: Appt): string {
  return (
    [a.lead_name, a.lead_surname].filter(Boolean).join(' ') ||
    [a.client_name, a.client_surname].filter(Boolean).join(' ') ||
    ''
  );
}

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });

  const { data, isLoading } = useQuery({
    queryKey: ['appointments', 'calendar'],
    queryFn: ({ signal }) => api.get<Paginated<Appt>>('appointments.php', { params: { limit: 300 }, signal }),
  });

  const byDay = useMemo(() => {
    const map = new Map<string, Appt[]>();
    for (const a of data?.items ?? []) {
      const key = a.appointment_date?.slice(0, 10);
      if (!key) continue; // skip rows with no/blank date instead of crashing
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    for (const list of map.values()) list.sort((x, y) => x.appointment_date.localeCompare(y.appointment_date));
    return map;
  }, [data]);

  // Build the 6-week grid starting Monday.
  const cells = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const offset = (first.getDay() + 6) % 7; // Mon=0
    const start = new Date(cursor.year, cursor.month, 1 - offset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const monthLabel = capitalize(
    new Date(cursor.year, cursor.month, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }),
  );
  const todayKey = dayKey(new Date());

  const shift = (delta: number) => {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Calendario"
        subtitle="Appuntamenti e visite"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => shift(-1)} aria-label="Mese precedente">
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-[10rem] text-center text-sm font-semibold text-navy">{monthLabel}</span>
            <Button variant="outline" size="icon" onClick={() => shift(1)} aria-label="Mese successivo">
              <ChevronRight className="size-4" />
            </Button>
          </div>
        }
      />

      <Card className="p-3">
        <div className="grid grid-cols-7 gap-2">
          {WEEKDAYS.map((w) => (
            <div key={w} className="pb-2 text-center text-eyebrow">
              {w}
            </div>
          ))}
          {isLoading
            ? Array.from({ length: 42 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)
            : cells.map((d) => {
                const key = dayKey(d);
                const inMonth = d.getMonth() === cursor.month;
                const appts = byDay.get(key) ?? [];
                return (
                  <div
                    key={key}
                    className={cn(
                      'flex min-h-24 flex-col gap-1 rounded-lg border p-1.5',
                      inMonth ? 'border-gray-100 bg-white' : 'border-transparent bg-slate-50/50',
                      key === todayKey && 'ring-2 ring-primary/40',
                    )}
                  >
                    <span
                      className={cn(
                        'text-xs font-semibold',
                        inMonth ? 'text-navy' : 'text-slate-300',
                        key === todayKey && 'text-primary',
                      )}
                    >
                      {d.getDate()}
                    </span>
                    <div className="flex flex-col gap-1 overflow-hidden">
                      {appts.slice(0, 3).map((a) => (
                        <div
                          key={a.id}
                          className="truncate rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                          title={`${formatTime(a.appointment_date)} · ${a.property_address ?? ''} · ${personOf(a)}`}
                        >
                          <span className="font-semibold">{formatTime(a.appointment_date)}</span>{' '}
                          <span className="inline-flex items-center gap-0.5">
                            <Home className="size-2.5" />
                            {a.property_address ?? personOf(a)}
                          </span>
                        </div>
                      ))}
                      {appts.length > 3 && <span className="pl-1 text-[10px] text-muted">+{appts.length - 3} altri</span>}
                    </div>
                  </div>
                );
              })}
        </div>
      </Card>
    </div>
  );
}
