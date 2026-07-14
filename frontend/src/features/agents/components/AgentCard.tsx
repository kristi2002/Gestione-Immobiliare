import { Target, CheckCircle2, CalendarCheck, Building2, KeyRound } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { initials, formatNumber } from '@/lib/format';
import type { AgentPortfolio } from '@/types/people';

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Amministratore',
  admin: 'Amministratore',
  agent: 'Agente',
};

function Metric({ icon: Icon, label, value }: { icon: typeof Target; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center rounded-xl bg-slate-50 px-2 py-3 text-center">
      <Icon className="mb-1 size-4 text-muted" />
      <span className="text-base font-bold text-navy">{value}</span>
      <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}

export function AgentCard({ agent }: { agent: AgentPortfolio }) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-center gap-3">
        <Avatar className="size-12">
          <AvatarFallback className="bg-primary text-white">{initials(agent.username)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold capitalize text-navy">{agent.username}</p>
          <p className="truncate text-xs text-muted">{agent.email}</p>
        </div>
        <Badge variant="primary">{ROLE_LABEL[agent.role] ?? agent.role}</Badge>
      </div>

      {/* Conversion */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">Tasso di conversione</span>
          <span className="font-semibold text-navy">{agent.conversion_rate}%</span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-success"
            style={{ width: `${Math.min(100, agent.conversion_rate)}%` }}
          />
        </div>
      </div>

      {/* Metrics */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Metric icon={Target} label="Leads" value={formatNumber(agent.leads_total)} />
        <Metric icon={CheckCircle2} label="Vinti" value={formatNumber(agent.leads_converted)} />
        <Metric icon={CalendarCheck} label="Visite" value={formatNumber(agent.appointments)} />
        <Metric icon={Building2} label="Immobili" value={formatNumber(agent.properties)} />
        <Metric icon={KeyRound} label="Chiavi" value={formatNumber(agent.keys_out)} />
        <Metric icon={Target} label="Nuovi" value={formatNumber(agent.leads_new)} />
      </div>
    </Card>
  );
}
