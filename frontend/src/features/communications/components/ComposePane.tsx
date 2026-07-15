import { useState } from 'react';
import { PenSquare, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useSendMessage, type CommunicationSummary } from '../api';

interface ComposePaneProps {
  recipients: CommunicationSummary[];
  onClose: () => void;
  onSent: (clientId: number) => void;
}

export function ComposePane({ recipients, onClose, onSent }: ComposePaneProps) {
  const send = useSendMessage();
  const [clientId, setClientId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const options = recipients.map((r) => ({
    value: String(r.id),
    label: `${r.name ?? ''} ${r.surname ?? ''}`.trim() || `Proprietario #${r.id}`,
  }));

  const canSend = clientId !== '' && body.trim().length > 0 && !send.isPending;
  const onSend = () => {
    if (!canSend) return;
    send.mutate(
      {
        client_id: Number(clientId),
        subject: subject.trim() || null,
        body: body.trim(),
      },
      { onSuccess: () => onSent(Number(clientId)) },
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-2 text-navy">
          <PenSquare className="size-5 text-primary" />
          <h2 className="text-card-title font-semibold">Nuova Comunicazione</h2>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Chiudi">
          <X className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4">
        <div>
          <label className="text-eyebrow">Destinatario</label>
          <Select
            className="mt-1.5"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            options={options}
            placeholder="Seleziona un proprietario…"
          />
        </div>

        <div>
          <label className="text-eyebrow">Oggetto</label>
          <Input
            className="mt-1.5"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Oggetto del messaggio"
          />
        </div>

        <div>
          <label className="text-eyebrow">Messaggio</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Scrivi la comunicazione…"
            rows={8}
            className={cn(
              'mt-1.5 w-full resize-none rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-navy',
              'placeholder:text-muted focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20',
            )}
          />
        </div>

        {send.isError && (
          <p className="text-xs text-danger">
            {send.error instanceof Error ? send.error.message : 'Invio non riuscito.'}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-border pt-4">
        <Button onClick={onSend} disabled={!canSend}>
          <Send className="size-4" />
          {send.isPending ? 'Invio…' : 'Invia'}
        </Button>
        <Button variant="outline" onClick={onClose}>
          Annulla
        </Button>
      </div>
    </div>
  );
}
