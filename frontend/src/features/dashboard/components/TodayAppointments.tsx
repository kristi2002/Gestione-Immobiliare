import { CalendarClock } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { formatTime, initials } from '@/lib/format';
import type { AppointmentToday } from '@/types/dashboard';

interface Props {
  data: AppointmentToday[] | undefined;
  isLoading: boolean;
}

/** "Appuntamenti di Oggi" rail. */
export function TodayAppointments({ data, isLoading }: Props) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Appuntamenti di Oggi</CardTitle>
      </CardHeader>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-10 flex-1" />
            </div>
          ))}
        </div>
      ) : data && data.length > 0 ? (
        <ul className="space-y-1">
          {data.map((appt) => (
            <li
              key={appt.id}
              className="flex items-center gap-3 rounded-xl border-l-2 border-primary/60 py-2.5 pl-3 pr-2 transition-colors hover:bg-slate-50"
            >
              <span className="w-12 shrink-0 text-sm font-semibold text-navy">
                {formatTime(appt.appointment_date)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-navy">
                  {appt.property_address ?? appt.property_type ?? 'Appuntamento'}
                </p>
                <p className="truncate text-xs text-muted">{appt.person_name ?? '—'}</p>
              </div>
              {appt.agent_name && (
                <Avatar className="size-8">
                  <AvatarFallback className="text-[10px]">{initials(appt.agent_name)}</AvatarFallback>
                </Avatar>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={CalendarClock}
          title="Nessun appuntamento"
          description="Non ci sono visite in programma per oggi."
        />
      )}
    </Card>
  );
}
