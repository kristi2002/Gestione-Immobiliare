import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Lead } from '@/types/people';
import type { KanbanColumn } from '../config';
import { LeadCard } from './LeadCard';

interface Props {
  column: KanbanColumn;
  leads: Lead[];
  count: number;
  isLoading: boolean;
  draggingId: number | null;
  onDragStart: (lead: Lead) => void;
  onDragEnd: () => void;
  onDrop: (status: KanbanColumn['status']) => void;
}

export function LeadColumn({
  column,
  leads,
  count,
  isLoading,
  draggingId,
  onDragStart,
  onDragEnd,
  onDrop,
}: Props) {
  const [isOver, setIsOver] = useState(false);

  return (
    <div className="flex min-w-[240px] flex-1 flex-col">
      {/* Header */}
      <div className={cn('flex items-center justify-between rounded-t-xl px-4 py-2.5 text-white', column.headerClass)}>
        <span className="text-sm font-semibold">{column.label}</span>
        <span className="flex min-w-6 items-center justify-center rounded-full bg-white/25 px-1.5 text-xs font-semibold">
          {isLoading ? '·' : count}
        </span>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!isOver) setIsOver(true);
        }}
        onDragLeave={() => setIsOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsOver(false);
          onDrop(column.status);
        }}
        className={cn(
          'flex-1 space-y-2.5 rounded-b-xl border border-t-0 border-gray-100 bg-slate-50/60 p-2.5 transition-colors',
          isOver && 'bg-primary/5 ring-2 ring-inset ring-primary/30',
        )}
      >
        {isLoading ? (
          Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)
        ) : leads.length === 0 ? (
          <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-gray-200 text-xs text-muted">
            Nessun lead
          </div>
        ) : (
          leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              dot={column.dot}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              isDragging={draggingId === lead.id}
            />
          ))
        )}
      </div>
    </div>
  );
}
