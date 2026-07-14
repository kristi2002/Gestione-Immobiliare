import { Badge, type BadgeProps } from '@/components/ui/badge';

type Variant = NonNullable<BadgeProps['variant']>;

interface StatusMeta {
  label: string;
  variant: Variant;
}

/** Italian labels + colors for the status enums used across the product. */
const STATUS_MAP: Record<string, StatusMeta> = {
  // properties
  available: { label: 'Disponibile', variant: 'success' },
  rented: { label: 'Affittato', variant: 'primary' },
  sold: { label: 'Venduto', variant: 'neutral' },
  reserved: { label: 'Riservato', variant: 'warning' },
  archived: { label: 'Archiviato', variant: 'neutral' },
  // payments
  paid: { label: 'Pagato', variant: 'success' },
  pending: { label: 'In attesa', variant: 'warning' },
  late: { label: 'In ritardo', variant: 'danger' },
  cancelled: { label: 'Annullato', variant: 'neutral' },
  // generic people / leads
  active: { label: 'Attivo', variant: 'success' },
  inactive: { label: 'Inattivo', variant: 'neutral' },
  // price type
  vendita: { label: 'Vendita', variant: 'primary' },
  affitto: { label: 'Affitto', variant: 'secondary' },
  // contracts / invoices
  draft: { label: 'Bozza', variant: 'neutral' },
  sent: { label: 'Inviato', variant: 'primary' },
  signed: { label: 'Firmato', variant: 'success' },
  expired: { label: 'Scaduto', variant: 'danger' },
};

interface StatusBadgeProps {
  status: string | null | undefined;
  /** Override the auto-derived label. */
  label?: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const key = (status ?? '').toLowerCase();
  const meta = STATUS_MAP[key] ?? { label: label ?? status ?? '—', variant: 'neutral' as Variant };
  return <Badge variant={meta.variant}>{label ?? meta.label}</Badge>;
}
