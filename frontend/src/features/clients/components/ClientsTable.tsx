import { Users, Building2, Mail, Phone } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { type Column } from '@/components/common/DataTable';
import { cn } from '@/lib/utils';
import { initials } from '@/lib/format';
import type { Client } from '@/types/people';
import { fullName, personType, PERSON_TYPE_LABEL } from '../utils';

interface Props {
  items: Client[] | undefined;
  isLoading: boolean;
  selectedId: number | null;
  onSelect: (client: Client) => void;
}

function TypeBadge({ client }: { client: Client }) {
  const type = personType(client);
  if (!type) return <span className="text-muted">—</span>;
  return (
    <Badge variant={type === 'fisica' ? 'primary' : 'secondary'}>{PERSON_TYPE_LABEL[type]}</Badge>
  );
}

export function ClientsTable({ items, isLoading, selectedId, onSelect }: Props) {
  const columns: Column<Client>[] = [
    {
      id: 'name',
      header: 'Nome Proprietario',
      cell: (c) => (
        <div className="flex items-center gap-3">
          <Avatar className="size-9">
            <AvatarFallback>{initials(fullName(c))}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium text-navy">{fullName(c)}</p>
            {c.codice_fiscale && <p className="truncate text-xs text-muted">{c.codice_fiscale}</p>}
          </div>
        </div>
      ),
    },
    { id: 'type', header: 'Tipo', cell: (c) => <TypeBadge client={c} /> },
    {
      id: 'contact',
      header: 'Contatti',
      cell: (c) => (
        <div className="space-y-0.5 text-xs text-muted">
          {c.email && (
            <p className="flex items-center gap-1.5">
              <Mail className="size-3" />
              <span className="truncate">{c.email}</span>
            </p>
          )}
          {c.phone && (
            <p className="flex items-center gap-1.5">
              <Phone className="size-3" />
              {c.phone}
            </p>
          )}
          {!c.email && !c.phone && '—'}
        </div>
      ),
    },
    {
      id: 'portfolio',
      header: 'Portafoglio',
      align: 'center',
      cell: (c) => (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-navy">
          <Building2 className="size-4 text-muted" />
          {Number(c.property_count) || 0}
        </span>
      ),
    },
    {
      id: 'agent',
      header: 'Agente Ref.',
      cell: (c) =>
        c.agent_name ? (
          <div className="flex items-center gap-2">
            <Avatar className="size-7">
              <AvatarFallback className="text-[10px]">{initials(c.agent_name)}</AvatarFallback>
            </Avatar>
            <span className="text-sm capitalize text-navy">{c.agent_name}</span>
          </div>
        ) : (
          <span className="text-xs text-muted">Non assegnato</span>
        ),
    },
  ];

  return (
    <Card className="p-2">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-gray-100">
            {columns.map((col) => (
              <th
                key={col.id}
                className={cn(
                  'px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-gray-400',
                  col.align === 'center' && 'text-center',
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading &&
            Array.from({ length: 6 }).map((_, i) => (
              <tr key={i} className="border-b border-gray-100">
                {columns.map((col) => (
                  <td key={col.id} className="px-4 py-3.5">
                    <div className="h-4 w-24 animate-pulse rounded bg-slate-200/70" />
                  </td>
                ))}
              </tr>
            ))}
          {!isLoading &&
            items?.map((c) => (
              <tr
                key={c.id}
                onClick={() => onSelect(c)}
                className={cn(
                  'cursor-pointer border-b border-gray-100 transition-colors last:border-0',
                  selectedId === c.id ? 'bg-primary/5' : 'hover:bg-[#F8F9FB]',
                )}
              >
                {columns.map((col) => (
                  <td key={col.id} className={cn('px-4 py-3', col.align === 'center' && 'text-center')}>
                    {col.cell(c)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>

      {!isLoading && items && items.length === 0 && (
        <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-muted">
            <Users className="size-7" />
          </div>
          <p className="text-card-title text-navy">Nessun proprietario trovato</p>
          <p className="mt-1 text-sm text-muted">Prova a modificare la ricerca o aggiungi un nuovo proprietario.</p>
        </div>
      )}
    </Card>
  );
}
