import { useState } from 'react';
import { MailOpen, Send } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { formatDate, formatTime, initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCommunicationThread, useSendMessage, type CommunicationMessage } from '../api';

interface ReadingPaneProps {
  clientId: number | null;
}

export function ReadingPane({ clientId }: ReadingPaneProps) {
  const { data, isLoading, isError, refetch } = useCommunicationThread(clientId);
  const send = useSendMessage();
  const [reply, setReply] = useState('');

  if (!clientId) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={MailOpen}
          title="Seleziona una comunicazione"
          description="Scegli un messaggio dall'elenco per leggerne il contenuto e rispondere."
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return <ErrorState onRetry={() => refetch()} />;
  }

  const { client, messages } = data;
  const name = `${client.name ?? ''} ${client.surname ?? ''}`.trim() || 'Senza nome';
  const latest = messages.length ? messages[messages.length - 1] : null;
  const subject = latest?.subject || '(nessun oggetto)';

  const canSend = reply.trim().length > 0 && !send.isPending;
  const onSend = () => {
    if (!canSend) return;
    send.mutate(
      {
        client_id: client.id,
        subject: latest?.subject ? `Re: ${latest.subject.replace(/^Re:\s*/i, '')}` : null,
        body: reply.trim(),
      },
      { onSuccess: () => setReply('') },
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-start gap-3 border-b border-border pb-4">
        <Avatar className="size-11">
          <AvatarFallback className="text-sm">{initials(name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-semibold text-navy">{name}</p>
            <span className="shrink-0 text-xs text-muted">
              {latest ? `${formatDate(latest.created_at)}, ${formatTime(latest.created_at)}` : ''}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted">
            A: {client.email || 'io'}
          </p>
        </div>
      </div>

      {/* Subject + thread */}
      <div className="min-h-0 flex-1 overflow-y-auto py-4">
        <h2 className="text-card-title font-semibold text-navy">{subject}</h2>

        <div className="mt-4 space-y-3">
          {messages.length === 0 ? (
            <p className="text-sm text-muted">Nessun messaggio in questa conversazione.</p>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}
        </div>
      </div>

      {/* Reply box */}
      <div className="shrink-0 border-t border-border pt-4">
        <div className="flex items-start gap-2">
          <Button onClick={onSend} disabled={!canSend} className="h-11 shrink-0">
            <Send className="size-4" />
            {send.isPending ? 'Invio…' : 'Invia'}
          </Button>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Scrivi una risposta…"
            rows={2}
            className={cn(
              'min-h-[44px] w-full resize-none rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-navy',
              'placeholder:text-muted focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20',
            )}
          />
        </div>
        {send.isError && (
          <p className="mt-2 text-xs text-danger">
            {send.error instanceof Error ? send.error.message : 'Invio non riuscito.'}
          </p>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: CommunicationMessage }) {
  const sent = message.direction === 'sent';
  return (
    <div className={cn('flex', sent ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
          sent ? 'bg-primary/10 text-navy' : 'bg-slate-100 text-navy',
        )}
      >
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
        <p className="mt-1 text-right text-[11px] text-muted">
          {formatTime(message.created_at)}
        </p>
      </div>
    </div>
  );
}
