import { CheckCircle2, Mail, MessageCircle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Static design showcase of a visual flow builder — matches the mockup. */
export function FlowPreview() {
  return (
    <div className="flex flex-col items-center">
      {/* Trigger node */}
      <div className="flex items-center gap-2 rounded-full bg-warning px-5 py-3 text-sm font-semibold text-white shadow-sm">
        <CheckCircle2 className="size-4" />
        Visita Completata
      </div>

      <Connector />

      {/* Action node — email */}
      <div className="w-full max-w-[280px] rounded-2xl bg-primary px-5 py-4 text-white shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Mail className="size-4" />
          Invia Email
        </div>
        <p className="mt-1 text-xs text-white/80">Template: "Rimuovi" · Ritardo immediato</p>
      </div>

      <Connector />

      {/* Decision diamond */}
      <div className="relative flex h-28 w-28 items-center justify-center">
        <div className="absolute inset-0 rotate-45 rounded-xl border border-border bg-slate-50" />
        <p className="relative z-10 px-2 text-center text-[11px] font-medium leading-tight text-muted">
          SE nessuna risposta dopo 24h
        </p>
      </div>

      <Connector />

      {/* Final action node — whatsapp */}
      <div className="w-full max-w-[280px] rounded-2xl bg-success px-5 py-4 text-white shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <MessageCircle className="size-4" />
          Invia WhatsApp
        </div>
        <p className="mt-1 text-xs text-white/80">Messaggio: "Ti va di sentirti a riguardo?"</p>
      </div>

      {/* Footer actions (visual only) */}
      <div className="mt-6 flex w-full items-center justify-between border-t border-border pt-5">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-primary"
        >
          <Plus className="size-4" />
          Aggiungi Passo
        </button>
        <Button size="sm" type="button">Salva</Button>
      </div>
    </div>
  );
}

function Connector() {
  return <span className="my-2 h-6 w-px bg-border" aria-hidden />;
}
