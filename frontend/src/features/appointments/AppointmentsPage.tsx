import { CalendarCheck, Home, Clock } from 'lucide-react';
import { ResourceListPage } from '@/features/_shared/ResourceListPage';
import { Badge } from '@/components/ui/badge';
import type { Column } from '@/components/common/DataTable';
import { formatDate, formatTime } from '@/lib/format';

interface Appointment {
  id: number;
  appointment_date: string;
  duration_minutes: number | null;
  status: string;
  property_address: string | null;
  lead_name: string | null;
  lead_surname: string | null;
  client_name: string | null;
  client_surname: string | null;
  agent_name: string | null;
}

const STATUS: Record<string, { label: string; variant: 'primary' | 'success' | 'danger' | 'neutral' | 'warning' }> = {
  scheduled: { label: 'In programma', variant: 'primary' },
  confirmed: { label: 'Confermato', variant: 'primary' },
  completed: { label: 'Completato', variant: 'success' },
  cancelled: { label: 'Annullato', variant: 'neutral' },
  no_show: { label: 'Assente', variant: 'danger' },
};

function person(a: Appointment): string {
  const lead = [a.lead_name, a.lead_surname].filter(Boolean).join(' ');
  const client = [a.client_name, a.client_surname].filter(Boolean).join(' ');
  return lead || client || '—';
}

const columns: Column<Appointment>[] = [
  {
    id: 'when',
    header: 'Data e ora',
    cell: (a) => (
      <div>
        <p className="font-medium text-navy">{formatDate(a.appointment_date)}</p>
        <p className="flex items-center gap-1 text-xs text-muted">
          <Clock className="size-3" />
          {formatTime(a.appointment_date)}
        </p>
      </div>
    ),
  },
  {
    id: 'property',
    header: 'Immobile',
    cell: (a) => (
      <span className="flex items-center gap-1.5 text-sm text-navy">
        <Home className="size-3.5 text-muted" />
        {a.property_address ?? '—'}
      </span>
    ),
  },
  { id: 'person', header: 'Con', cell: (a) => person(a) },
  { id: 'agent', header: 'Agente', cell: (a) => <span className="capitalize text-muted">{a.agent_name ?? '—'}</span> },
  {
    id: 'status',
    header: 'Stato',
    cell: (a) => {
      const s = STATUS[a.status] ?? { label: a.status, variant: 'neutral' as const };
      return <Badge variant={s.variant}>{s.label}</Badge>;
    },
  },
];

export default function AppointmentsPage() {
  return (
    <ResourceListPage<Appointment>
      title="Visite"
      subtitle="Appuntamenti e sopralluoghi"
      endpoint="appointments.php"
      columns={columns}
      rowKey={(a) => a.id}
      itemLabel="visite"
      searchable={false}
      statusFilter={{
        param: 'status',
        placeholder: 'Tutti gli stati',
        options: [
          { value: 'scheduled', label: 'In programma' },
          { value: 'completed', label: 'Completate' },
          { value: 'cancelled', label: 'Annullate' },
        ],
      }}
      newHref="/index.php?view=appointment_edit"
      newLabel="Nuova Visita"
      empty={{ icon: CalendarCheck, title: 'Nessuna visita', description: 'Pianifica il primo appuntamento.' }}
    />
  );
}
