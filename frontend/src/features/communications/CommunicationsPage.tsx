import { useMemo, useState, type FormEvent } from 'react';
import {
  Inbox,
  Send,
  Star,
  FileText,
  Trash2,
  Search,
  Mail,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { formatTime, formatDate, initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/lib/hooks/useDebounce';
import {
  useCommunicationsSummary,
  useCommunicationThread,
  useSendMessage,
  type CommunicationSummary,
  type CommunicationMessage,
} from './api';

type Folder = 'inbox' | 'sent' | 'important' | 'drafts' | 'trash';

const FOLDERS: { id: Folder; label: string; icon: LucideIcon }[] = [
  { id: 'inbox', label: 'In Arrivo', icon: Inbox },
  { id: 'sent', label: 'Inviata', icon: Send },
  { id: 'important', label: 'Importanti', icon: Star },
  { id: 'drafts', label: 'Bozze', icon: FileText },
  { id: 'trash', label: 'Cestino', icon: Trash2 },
];

const LABELS: { label: string; color: string }[] = [
  { label: 'Inquilini', color: 'bg-primary' },
  { label: 'Proprietari', color: 'bg-success' },
  { label: 'Leads', color: 'bg-secondary' },
];

function convName(c: CommunicationSummary): string {
  return [c.name, c.surname].filter(Boolean).join(' ').trim() || c.email || 'Sconosciuto';
}

export default function CommunicationsPage() {
  const [folder, setFolder] = useState<Folder>('inbox');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const debounced = useDebounce(search, 350);

  const summaryQuery = useCommunicationsSummary(debounced);
  const threadQuery = useCommunicationThread(selectedId);
  const sendMutation = useSendMessage();

  const conversations = summaryQuery.data?.items ?? [];

  // "In Arrivo" = last message received, "Inviata" = last message sent.
  // Importanti/Bozze/Cestino have no backend concept yet → empty by design.
  const filtered = useMemo(() => {
    return conversations.filter((c) => {
      if (folder === 'inbox') return c.last_message_direction !== 'sent';
      if (folder === 'sent') return c.last_message_direction === 'sent';
      return false;
    });
  }, [conversations, folder]);

  const inboxUnread = conversations.filter((c) => c.last_message_direction !== 'sent').length;
  const thread = threadQuery.data;

  function handleSend(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !selectedId) return;
    sendMutation.mutate(
      { client_id: selectedId, body },
      { onSuccess: () => setDraft('') },
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Comunicazioni"
        subtitle="Gestione comunicazioni con clienti, inquilini e fornitori"
        actions={
          <Button>
            <Plus className="size-4" />
            Nuova Comunicazione
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_360px_1fr]">
        {/* LEFT — folders + labels */}
        <Card className="h-[calc(100vh-14rem)] overflow-y-auto">
          <p className="text-eyebrow mb-3">Cartelle</p>
          <ul className="space-y-1">
            {FOLDERS.map((f) => {
              const active = folder === f.id;
              const count = f.id === 'inbox' ? inboxUnread : 0;
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => setFolder(f.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                      active ? 'bg-primary/10 text-primary' : 'text-navy hover:bg-slate-50',
                    )}
                  >
                    <f.icon className="size-[18px]" />
                    <span className="flex-1 text-left">{f.label}</span>
                    {count > 0 && (
                      <span className="flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-white">
                        {count}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="my-4 border-t border-border" />

          <p className="text-eyebrow mb-3">Etichette</p>
          <ul className="space-y-2">
            {LABELS.map((l) => (
              <li key={l.label} className="flex items-center gap-3 px-3 text-sm text-navy">
                <span className={cn('size-2.5 rounded-full', l.color)} />
                {l.label}
              </li>
            ))}
          </ul>
        </Card>

        {/* MIDDLE — conversation list */}
        <Card className="flex h-[calc(100vh-14rem)] flex-col overflow-hidden p-0">
          <div className="border-b border-border p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cerca…"
                className="pl-9"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {summaryQuery.isLoading ? (
              <ListSkeleton />
            ) : summaryQuery.isError ? (
              <ErrorState onRetry={() => summaryQuery.refetch()} />
            ) : filtered.length === 0 ? (
              <EmptyState icon={Mail} title="Nessuna comunicazione" description="Questa cartella è vuota." />
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((c) => {
                  const active = c.id === selectedId;
                  const unread = c.last_message_direction !== 'sent';
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(c.id)}
                        className={cn(
                          'flex w-full items-start gap-3 border-l-2 px-4 py-3 text-left transition-colors',
                          active
                            ? 'border-primary bg-primary/5'
                            : 'border-transparent hover:bg-slate-50',
                        )}
                      >
                        <Avatar className="size-10">
                          <AvatarFallback>{initials(convName(c))}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className={cn('truncate text-navy', unread ? 'font-bold' : 'font-semibold')}>
                              {convName(c)}
                            </p>
                            <span className="shrink-0 text-xs text-muted">{formatTime(c.last_message_at)}</span>
                          </div>
                          <p className="truncate text-sm text-muted">{c.last_message_preview || '—'}</p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        {/* RIGHT — reading pane */}
        <Card className="flex h-[calc(100vh-14rem)] flex-col overflow-hidden p-0">
          {!selectedId ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={Mail}
                title="Seleziona una comunicazione"
                description="Scegli una conversazione dall'elenco per leggerla."
              />
            </div>
          ) : threadQuery.isLoading ? (
            <div className="space-y-4 p-6">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : threadQuery.isError ? (
            <ErrorState onRetry={() => threadQuery.refetch()} />
          ) : thread ? (
            <>
              <div className="flex items-center gap-3 border-b border-border px-6 py-4">
                <Avatar className="size-10">
                  <AvatarFallback>
                    {initials([thread.client.name, thread.client.surname].filter(Boolean).join(' '))}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-navy">
                    {[thread.client.name, thread.client.surname].filter(Boolean).join(' ')}
                  </p>
                  <p className="truncate text-xs text-muted">{thread.client.email || thread.client.phone || '—'}</p>
                </div>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto bg-background/40 px-6 py-5">
                {thread.messages.length === 0 ? (
                  <EmptyState icon={Mail} title="Nessun messaggio" description="Inizia scrivendo qui sotto." />
                ) : (
                  thread.messages.map((m) => <MessageRow key={m.id} message={m} />)
                )}
              </div>

              <form onSubmit={handleSend} className="space-y-2 border-t border-border px-6 py-4">
                {sendMutation.isError && (
                  <p className="text-xs text-danger">
                    {(sendMutation.error as Error)?.message || 'Invio non riuscito.'}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Scrivi una risposta…"
                    className="flex-1"
                  />
                  <Button type="submit" disabled={!draft.trim() || sendMutation.isPending}>
                    <Send className="size-4" />
                    Invia
                  </Button>
                </div>
              </form>
            </>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MessageRow({ message }: { message: CommunicationMessage }) {
  const outbound = message.direction === 'sent';
  return (
    <div className={cn('flex w-full', outbound ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-sm',
          outbound ? 'rounded-tr-sm bg-primary/10 text-navy' : 'rounded-tl-sm bg-white text-navy',
        )}
      >
        {message.subject && <p className="mb-1 font-semibold">{message.subject}</p>}
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
        <div className="mt-1.5 flex items-center justify-end gap-2">
          <Badge variant={message.channel === 'whatsapp' ? 'success' : 'primary'}>{message.channel}</Badge>
          <span className="text-[11px] text-muted">{formatDate(message.created_at)} · {formatTime(message.created_at)}</span>
        </div>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="divide-y divide-border">
      {Array.from({ length: 7 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-44" />
          </div>
        </li>
      ))}
    </ul>
  );
}
