import type { LeadStatus } from '@/types/people';

export interface KanbanColumn {
  status: LeadStatus;
  label: string;
  /** Tailwind classes for the column header background. */
  headerClass: string;
  /** Dot / accent color (CSS) shown on cards in this column. */
  dot: string;
}

/**
 * Pipeline columns, left → right. "lost" (Perso) is intentionally excluded from
 * the board — lost leads are archived, not a working stage.
 */
export const KANBAN_COLUMNS: KanbanColumn[] = [
  { status: 'new', label: 'Nuovo', headerClass: 'bg-warning', dot: '#F97316' },
  { status: 'contacted', label: 'Contattato', headerClass: 'bg-primary', dot: '#0B3D91' },
  { status: 'interested', label: 'Visita Fissata', headerClass: 'bg-violet-500', dot: '#8B5CF6' },
  { status: 'negotiating', label: 'Proposta Inviata', headerClass: 'bg-amber-500', dot: '#F59E0B' },
  { status: 'converted', label: 'Chiuso / Vinto', headerClass: 'bg-success', dot: '#22C55E' },
];

export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'Nuovo',
  contacted: 'Contattato',
  interested: 'Visita Fissata',
  negotiating: 'Proposta Inviata',
  converted: 'Chiuso / Vinto',
  lost: 'Perso',
};

export const INTEREST_LABEL: Record<string, string> = {
  affitto: 'Affitto',
  acquisto: 'Acquisto',
  entrambi: 'Affitto / Acquisto',
};
