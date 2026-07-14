import { useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { ErrorState } from '@/components/common/ErrorState';
import type { Lead, LeadStatus } from '@/types/people';
import { KANBAN_COLUMNS } from '../config';
import { useBoardLeads, useMoveLead } from '../api';
import { LeadColumn } from './LeadColumn';

export function LeadKanban() {
  const { byStatus, counts, isLoading, isError, refetch } = useBoardLeads();
  const move = useMoveLead();
  const dragged = useRef<Lead | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);

  const onDragStart = (lead: Lead) => {
    dragged.current = lead;
    setDraggingId(lead.id);
  };
  const onDragEnd = () => {
    dragged.current = null;
    setDraggingId(null);
  };
  const onDrop = (toStatus: LeadStatus) => {
    const lead = dragged.current;
    dragged.current = null;
    setDraggingId(null);
    if (lead && lead.status !== toStatus) move.mutate({ lead, toStatus });
  };

  if (isError) {
    return (
      <Card>
        <ErrorState onRetry={refetch} message="Impossibile caricare la pipeline dei lead." />
      </Card>
    );
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {KANBAN_COLUMNS.map((column) => (
        <LeadColumn
          key={column.status}
          column={column}
          leads={byStatus[column.status] ?? []}
          count={counts[column.status] ?? 0}
          isLoading={isLoading}
          draggingId={draggingId}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDrop={onDrop}
        />
      ))}
    </div>
  );
}
