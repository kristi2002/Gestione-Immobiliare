import { Target, Mail, Phone } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/common/DataTable';
import { initials } from '@/lib/format';
import type { Lead } from '@/types/people';
import { INTEREST_LABEL, STATUS_LABEL } from '../config';
import { budgetRange, leadName, timeAgo } from '../utils';

const STATUS_VARIANT: Record<string, Parameters<typeof Badge>[0]['variant']> = {
  new: 'warning',
  contacted: 'primary',
  interested: 'secondary',
  negotiating: 'warning',
  converted: 'success',
  lost: 'danger',
};

const columns: Column<Lead>[] = [
  {
    id: 'name',
    header: 'Lead',
    cell: (l) => (
      <div className="flex items-center gap-3">
        <Avatar className="size-9">
          <AvatarFallback>{initials(leadName(l))}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate font-medium text-navy">{leadName(l)}</p>
          <p className="text-xs text-muted">{timeAgo(l.created_at)}</p>
        </div>
      </div>
    ),
  },
  {
    id: 'contact',
    header: 'Contatti',
    cell: (l) => (
      <div className="space-y-0.5 text-xs text-muted">
        {l.email && (
          <p className="flex items-center gap-1.5">
            <Mail className="size-3" />
            <span className="truncate">{l.email}</span>
          </p>
        )}
        {l.phone && (
          <p className="flex items-center gap-1.5">
            <Phone className="size-3" />
            {l.phone}
          </p>
        )}
        {!l.email && !l.phone && '—'}
      </div>
    ),
  },
  {
    id: 'interest',
    header: 'Interesse',
    cell: (l) => <span className="text-muted">{INTEREST_LABEL[l.interest_type] ?? l.interest_type}</span>,
  },
  {
    id: 'budget',
    header: 'Budget',
    align: 'right',
    cell: (l) => <span className="font-medium">{budgetRange(l) || '—'}</span>,
  },
  {
    id: 'status',
    header: 'Stato',
    cell: (l) => <Badge variant={STATUS_VARIANT[l.status] ?? 'neutral'}>{STATUS_LABEL[l.status]}</Badge>,
  },
  {
    id: 'agent',
    header: 'Agente',
    cell: (l) => <span className="text-sm capitalize text-navy">{l.agent_name ?? '—'}</span>,
  },
];

export function LeadsTable({ items, isLoading }: { items: Lead[] | undefined; isLoading: boolean }) {
  return (
    <Card className="p-2">
      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        rowKey={(l) => l.id}
        skeletonRows={8}
        empty={{ icon: Target, title: 'Nessun lead trovato', description: 'Prova a modificare i filtri.' }}
      />
    </Card>
  );
}
