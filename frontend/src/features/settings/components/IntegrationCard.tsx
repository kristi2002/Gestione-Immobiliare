import type { LucideIcon } from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface Props {
  icon: LucideIcon;
  title: string;
  description: string;
  enabled: boolean;
  configured: boolean;
  /** Non-secret detail rows (label → value). Secrets are never shown. */
  details?: { label: string; value: string }[];
}

/**
 * Read-only status card for an integration. Secrets (tokens, passwords) are
 * intentionally not rendered — configuration happens in the legacy settings /
 * environment, this just reports state.
 */
export function IntegrationCard({ icon: Icon, title, description, enabled, configured, details }: Props) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex size-10 items-center justify-center rounded-xl',
              enabled ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-muted',
            )}
          >
            <Icon className="size-5" />
          </div>
          <div>
            <CardTitle>{title}</CardTitle>
            <p className="text-xs text-muted">{description}</p>
          </div>
        </div>
        <Badge variant={enabled ? 'success' : 'neutral'}>{enabled ? 'Attivo' : 'Disattivo'}</Badge>
      </div>

      <div className="mt-4 space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Configurazione</span>
          <Badge variant={configured ? 'success' : 'warning'}>{configured ? 'Configurato' : 'Da configurare'}</Badge>
        </div>
        {details?.map((d) => (
          <div key={d.label} className="flex items-center justify-between text-sm">
            <span className="text-muted">{d.label}</span>
            <span className="max-w-[60%] truncate font-medium text-navy">{d.value || '—'}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
