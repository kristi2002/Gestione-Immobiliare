import { History } from 'lucide-react';
import { ResourceListPage } from '@/features/_shared/ResourceListPage';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import type { Column } from '@/components/common/DataTable';
import { formatDate, formatTime, initials } from '@/lib/format';

interface ActivityEntry {
  id: number;
  username: string | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  description: string | null;
  created_at: string;
}

const ACTION: Record<string, { label: string; variant: 'success' | 'primary' | 'danger' | 'neutral' | 'warning' }> = {
  create: { label: 'Creazione', variant: 'success' },
  update: { label: 'Modifica', variant: 'primary' },
  delete: { label: 'Eliminazione', variant: 'danger' },
  login: { label: 'Accesso', variant: 'neutral' },
  logout: { label: 'Uscita', variant: 'neutral' },
};

const columns: Column<ActivityEntry>[] = [
  {
    id: 'when',
    header: 'Quando',
    cell: (e) => (
      <div>
        <p className="text-sm text-navy">{formatDate(e.created_at)}</p>
        <p className="text-xs text-muted">{formatTime(e.created_at)}</p>
      </div>
    ),
  },
  {
    id: 'user',
    header: 'Utente',
    cell: (e) => (
      <div className="flex items-center gap-2">
        <Avatar className="size-7">
          <AvatarFallback className="text-[10px]">{initials(e.username ?? '?')}</AvatarFallback>
        </Avatar>
        <span className="text-sm capitalize text-navy">{e.username ?? 'Sistema'}</span>
      </div>
    ),
  },
  {
    id: 'action',
    header: 'Azione',
    cell: (e) => {
      const a = ACTION[e.action] ?? { label: e.action, variant: 'neutral' as const };
      return <Badge variant={a.variant}>{a.label}</Badge>;
    },
  },
  { id: 'entity', header: 'Oggetto', cell: (e) => <span className="text-muted">{e.entity_type ?? '—'}</span> },
  {
    id: 'desc',
    header: 'Dettaglio',
    cell: (e) => <span className="text-sm text-muted">{e.description ?? '—'}</span>,
  },
];

export default function ActivityLogPage() {
  return (
    <ResourceListPage<ActivityEntry>
      title="Log Attività"
      subtitle="Registro delle operazioni degli utenti"
      endpoint="activity_log.php"
      columns={columns}
      rowKey={(e) => e.id}
      itemLabel="eventi"
      searchable={false}
      empty={{ icon: History, title: 'Nessuna attività', description: 'Le operazioni compariranno qui.' }}
    />
  );
}
