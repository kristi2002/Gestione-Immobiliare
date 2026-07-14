import { Bell, Home } from 'lucide-react';
import { ResourceListPage } from '@/features/_shared/ResourceListPage';
import { Badge } from '@/components/ui/badge';
import type { Column } from '@/components/common/DataTable';
import { formatDate } from '@/lib/format';

interface Reminder {
  id: number;
  title: string;
  description: string | null;
  reminder_date: string | null;
  status: string;
  priority: string | null;
  category: string | null;
  property_address: string | null;
  client_name: string | null;
  client_surname: string | null;
}

const STATUS: Record<string, { label: string; variant: 'warning' | 'success' | 'neutral' | 'danger' }> = {
  pending: { label: 'Da fare', variant: 'warning' },
  completed: { label: 'Completato', variant: 'success' },
  done: { label: 'Completato', variant: 'success' },
  cancelled: { label: 'Annullato', variant: 'neutral' },
  overdue: { label: 'Scaduto', variant: 'danger' },
};

const PRIORITY: Record<string, 'danger' | 'warning' | 'primary' | 'neutral'> = {
  urgente: 'danger',
  alta: 'warning',
  normale: 'primary',
  bassa: 'neutral',
};

function isOverdue(r: Reminder): boolean {
  return r.status === 'pending' && !!r.reminder_date && new Date(r.reminder_date).getTime() < Date.now();
}

const columns: Column<Reminder>[] = [
  {
    id: 'title',
    header: 'Promemoria',
    cell: (r) => (
      <div className="min-w-0">
        <p className="truncate font-medium text-navy">{r.title}</p>
        {r.category && <p className="truncate text-xs text-muted">{r.category}</p>}
      </div>
    ),
  },
  {
    id: 'related',
    header: 'Collegato a',
    cell: (r) => {
      const who = [r.client_name, r.client_surname].filter(Boolean).join(' ') || r.property_address;
      return who ? (
        <span className="flex items-center gap-1.5 text-sm text-muted">
          <Home className="size-3.5" />
          <span className="truncate">{who}</span>
        </span>
      ) : (
        <span className="text-muted">—</span>
      );
    },
  },
  {
    id: 'priority',
    header: 'Priorità',
    cell: (r) => (r.priority ? <Badge variant={PRIORITY[r.priority] ?? 'neutral'}>{r.priority}</Badge> : '—'),
  },
  {
    id: 'date',
    header: 'Scadenza',
    cell: (r) => (
      <span className={isOverdue(r) ? 'font-medium text-danger' : 'text-navy'}>{formatDate(r.reminder_date)}</span>
    ),
  },
  {
    id: 'status',
    header: 'Stato',
    cell: (r) => {
      const s = STATUS[r.status] ?? { label: r.status, variant: 'neutral' as const };
      return <Badge variant={s.variant}>{s.label}</Badge>;
    },
  },
];

export default function RemindersPage() {
  return (
    <ResourceListPage<Reminder>
      title="Promemoria"
      subtitle="Scadenze, attività e manutenzioni"
      endpoint="reminders.php"
      columns={columns}
      rowKey={(r) => r.id}
      itemLabel="promemoria"
      searchable={false}
      statusFilter={{
        param: 'status',
        placeholder: 'Tutti gli stati',
        options: [
          { value: 'pending', label: 'Da fare' },
          { value: 'completed', label: 'Completati' },
        ],
      }}
      newHref="/index.php?view=reminders"
      newLabel="Nuovo Promemoria"
      empty={{ icon: Bell, title: 'Nessun promemoria', description: 'Crea il primo promemoria.' }}
    />
  );
}
