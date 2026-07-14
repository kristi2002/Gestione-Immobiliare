import type { Lead } from '@/types/people';

/** "€250k – 350k", "da €200k", "fino a €400k", or "" when no budget set. */
export function budgetRange(lead: Pick<Lead, 'budget_min' | 'budget_max'>): string {
  const min = lead.budget_min ? Number(lead.budget_min) : null;
  const max = lead.budget_max ? Number(lead.budget_max) : null;
  if (min && max) return `€${short(min)} – ${short(max)}`;
  if (min) return `da €${short(min)}`;
  if (max) return `fino a €${short(max)}`;
  return '';
}

function short(n: number): string {
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `${trim(n / 1_000)}k`;
  return String(n);
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.0', '');
}

/** Italian relative time: "Oggi", "Ieri", "5gg fa", "2 sett. fa", "3 mesi fa". */
export function timeAgo(dateStr: string): string {
  const d = new Date(dateStr.replace(' ', 'T')).getTime();
  if (Number.isNaN(d)) return '';
  const days = Math.floor((Date.now() - d) / 86_400_000);
  if (days <= 0) return 'Oggi';
  if (days === 1) return 'Ieri';
  if (days < 7) return `${days}gg fa`;
  if (days < 30) return `${Math.floor(days / 7)} sett. fa`;
  if (days < 365) return `${Math.floor(days / 30)} mesi fa`;
  return `${Math.floor(days / 365)} anni fa`;
}

export function leadName(lead: Pick<Lead, 'name' | 'surname'>): string {
  return [lead.name, lead.surname].filter(Boolean).join(' ').trim() || 'Lead';
}
