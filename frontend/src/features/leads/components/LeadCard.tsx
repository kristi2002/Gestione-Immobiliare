import { Home, Clock, MapPin } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { initials } from '@/lib/format';
import type { Lead } from '@/types/people';
import { budgetRange, leadName, timeAgo } from '../utils';

interface Props {
  lead: Lead;
  dot: string;
  onDragStart: (lead: Lead) => void;
  onDragEnd: () => void;
  isDragging: boolean;
}

export function LeadCard({ lead, dot, onDragStart, onDragEnd, isDragging }: Props) {
  const budget = budgetRange(lead);

  return (
    <article
      draggable
      onDragStart={() => onDragStart(lead)}
      onDragEnd={onDragEnd}
      className={cn(
        'group cursor-grab rounded-xl border border-gray-100 bg-white p-3 shadow-sm transition-all active:cursor-grabbing',
        'hover:border-primary/30 hover:shadow-card',
        isDragging && 'opacity-40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-sm font-semibold text-navy">{leadName(lead)}</p>
        <span className="mt-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} />
      </div>

      {lead.preferred_type && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
          <Home className="size-3" />
          <span className="capitalize">{lead.preferred_type}</span>
          {lead.preferred_city && (
            <>
              <MapPin className="ml-1 size-3" />
              {lead.preferred_city}
            </>
          )}
        </p>
      )}

      {budget && <p className="mt-2 text-sm font-bold text-primary">{budget}</p>}

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Avatar className="size-6">
            <AvatarFallback className="text-[9px]">
              {lead.agent_name ? initials(lead.agent_name) : '—'}
            </AvatarFallback>
          </Avatar>
          <span className="truncate text-[11px] text-muted">{lead.agent_name ?? 'Non assegnato'}</span>
        </div>
        <span className="flex items-center gap-1 text-[11px] text-muted">
          <Clock className="size-3" />
          {timeAgo(lead.created_at)}
        </span>
      </div>
    </article>
  );
}
