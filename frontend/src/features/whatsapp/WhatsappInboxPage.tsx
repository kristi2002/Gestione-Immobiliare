import { useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Calendar,
  Check,
  CheckCheck,
  Home,
  MessageCircle,
  Paperclip,
  Phone,
  Search,
  Send,
  Smile,
  Upload,
  Video,
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
import { formatTime, initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  useMarkThreadRead,
  useSendWhatsapp,
  useWhatsappThread,
  useWhatsappThreads,
  type WhatsappMessage,
  type WhatsappThread,
} from './api';

const WA_GREEN = '#25D366';

type Tab = 'all' | 'unread' | 'archived';

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'Tutte' },
  { id: 'unread', label: 'Non Lette' },
  { id: 'archived', label: 'Archiviate' },
];

function threadUnread(thread: WhatsappThread): number {
  return Number(thread.unread_count) || 0;
}

function threadName(thread: WhatsappThread): string {
  return thread.contact_name?.trim() || thread.phone || 'Sconosciuto';
}

function messageSenderName(m: WhatsappMessage): string {
  const client = [m.client_name, m.client_surname].filter(Boolean).join(' ').trim();
  const tenant = [m.tenant_name, m.tenant_surname].filter(Boolean).join(' ').trim();
  return client || tenant || m.from_number || 'Contatto';
}

export default function WhatsappInboxPage() {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const threadsQuery = useWhatsappThreads();
  const threadQuery = useWhatsappThread(selectedPhone);
  const sendMutation = useSendWhatsapp(selectedPhone);
  const markRead = useMarkThreadRead();

  const threads = threadsQuery.data ?? [];

  const filteredThreads = useMemo(() => {
    const term = search.trim().toLowerCase();
    return threads.filter((t) => {
      if (tab === 'unread' && threadUnread(t) === 0) return false;
      if (tab === 'archived') return false; // no archive concept in the backend yet
      if (!term) return true;
      return (
        threadName(t).toLowerCase().includes(term) ||
        (t.phone ?? '').toLowerCase().includes(term) ||
        (t.last_message ?? '').toLowerCase().includes(term)
      );
    });
  }, [threads, tab, search]);

  const selectedThread = threads.find((t) => t.phone === selectedPhone) ?? null;
  const messages = threadQuery.data?.items ?? [];

  function selectThread(thread: WhatsappThread) {
    setSelectedPhone(thread.phone);
    if (threadUnread(thread) > 0) markRead.mutate(thread.phone);
  }

  function handleSend(e: FormEvent) {
    e.preventDefault();
    const message = draft.trim();
    if (!message || !selectedPhone) return;
    sendMutation.mutate(
      { phone: selectedPhone, message },
      { onSuccess: () => setDraft('') },
    );
  }

  const archivedCount = 0;

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader title="WhatsApp Inbox" subtitle="Conversazioni WhatsApp Business" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
        {/* LEFT — conversations */}
        <Card className="flex h-[calc(100vh-14rem)] flex-col overflow-hidden p-0">
          {/* channel header */}
          <div className="flex items-center gap-3 border-b border-border px-4 py-4">
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-white"
              style={{ backgroundColor: WA_GREEN }}
            >
              <MessageCircle className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-card-title text-navy">WhatsApp Business</p>
            </div>
            <Badge variant="success">
              <Check className="size-3" />
              Connesso
            </Badge>
          </div>

          {/* search */}
          <div className="px-4 pt-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cerca conversazione…"
                className="pl-9"
              />
            </div>
          </div>

          {/* tabs */}
          <div className="flex items-center gap-5 border-b border-border px-4 pt-3">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex items-center gap-2 border-b-2 pb-2 text-sm font-medium transition-colors',
                  tab === t.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted hover:text-navy',
                )}
              >
                {t.label}
                {t.id === 'archived' && archivedCount > 0 && (
                  <span
                    className="flex size-5 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                    style={{ backgroundColor: WA_GREEN }}
                  >
                    {archivedCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* conversation list */}
          <div className="flex-1 overflow-y-auto">
            {threadsQuery.isLoading ? (
              <ThreadListSkeleton />
            ) : threadsQuery.isError ? (
              <ErrorState onRetry={() => threadsQuery.refetch()} />
            ) : filteredThreads.length === 0 ? (
              <EmptyState
                icon={MessageCircle}
                title="Nessuna conversazione"
                description={
                  tab === 'archived'
                    ? 'Non ci sono conversazioni archiviate.'
                    : 'Le conversazioni WhatsApp appariranno qui.'
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {filteredThreads.map((t) => {
                  const unread = threadUnread(t);
                  const active = t.phone === selectedPhone;
                  return (
                    <li key={t.phone}>
                      <button
                        type="button"
                        onClick={() => selectThread(t)}
                        className={cn(
                          'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                          active ? 'bg-primary/5' : 'hover:bg-slate-50',
                        )}
                      >
                        <Avatar className="size-11">
                          <AvatarFallback>{initials(threadName(t))}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate font-semibold text-navy">{threadName(t)}</p>
                            <span className="shrink-0 text-xs text-muted">{formatTime(t.last_at)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm text-muted">{t.last_message || '—'}</p>
                            {unread > 0 && (
                              <span
                                className="flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                                style={{ backgroundColor: WA_GREEN }}
                              >
                                {unread}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        {/* RIGHT — chat thread */}
        <Card className="flex h-[calc(100vh-14rem)] flex-col overflow-hidden p-0">
          {!selectedThread ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={MessageCircle}
                title="Seleziona una conversazione"
                description="Scegli una conversazione dall'elenco per visualizzare i messaggi."
              />
            </div>
          ) : (
            <>
              {/* thread header */}
              <div className="flex items-center gap-3 border-b border-border px-5 py-3">
                <Avatar className="size-10">
                  <AvatarFallback>{initials(threadName(selectedThread))}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-navy">{threadName(selectedThread)}</p>
                  <p className="truncate text-xs text-muted">{selectedThread.phone}</p>
                </div>
                <Button variant="link" size="sm" className="hidden sm:inline-flex">
                  Visualizza Contatto
                </Button>
                <div className="flex items-center gap-1 text-muted">
                  <Button variant="ghost" size="icon" aria-label="Chiama">
                    <Phone className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Videochiamata">
                    <Video className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Condividi">
                    <Upload className="size-4" />
                  </Button>
                </div>
              </div>

              {/* messages */}
              <div className="flex-1 space-y-3 overflow-y-auto bg-background/40 px-5 py-4">
                {threadQuery.isLoading ? (
                  <ThreadMessagesSkeleton />
                ) : threadQuery.isError ? (
                  <ErrorState onRetry={() => threadQuery.refetch()} />
                ) : messages.length === 0 ? (
                  <EmptyState
                    icon={MessageCircle}
                    title="Nessun messaggio"
                    description="Inizia la conversazione scrivendo un messaggio."
                  />
                ) : (
                  messages.map((m) => <MessageBubble key={m.id} message={m} />)
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* composer */}
              <div className="space-y-3 border-t border-border px-5 py-4">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="primary" size="sm">
                    <Home className="size-4" />
                    Invia Scheda Immobile
                  </Button>
                  <Button type="button" variant="outline" size="sm">
                    <Calendar className="size-4" />
                    Fissa Appuntamento
                  </Button>
                </div>

                {sendMutation.isError && (
                  <p className="text-xs text-danger">
                    {(sendMutation.error as Error)?.message || 'Invio non riuscito.'}
                  </p>
                )}

                <form onSubmit={handleSend} className="flex items-center gap-2">
                  <Button type="button" variant="ghost" size="icon" aria-label="Emoji">
                    <Smile className="size-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" aria-label="Allega">
                    <Paperclip className="size-4" />
                  </Button>
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Scrivi un messaggio…"
                    className="flex-1"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    className="shrink-0 rounded-full text-white hover:opacity-90"
                    style={{ backgroundColor: WA_GREEN }}
                    disabled={!draft.trim() || sendMutation.isPending}
                    aria-label="Invia"
                  >
                    <Send className="size-4" />
                  </Button>
                </form>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MessageBubble({ message }: { message: WhatsappMessage }) {
  const outbound = message.direction === 'outbound';

  return (
    <div className={cn('flex w-full', outbound ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[78%] rounded-2xl px-4 py-2 text-sm shadow-sm',
          outbound
            ? 'rounded-tr-sm bg-success/10 text-navy'
            : 'rounded-tl-sm bg-white text-navy',
        )}
      >
        {!outbound && (
          <p className="mb-0.5 text-xs font-semibold text-success">{messageSenderName(message)}</p>
        )}

        {message.media_url && (
          <img
            src={message.media_url}
            alt="Allegato"
            className="mb-2 max-h-48 w-full rounded-lg object-cover"
          />
        )}

        {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}

        <div className="mt-1 flex items-center justify-end gap-1">
          <span className="text-[11px] text-muted">{formatTime(message.received_at)}</span>
          {outbound &&
            (message.is_read ? (
              <CheckCheck className="size-3.5 text-secondary" />
            ) : (
              <Check className="size-3.5 text-muted" />
            ))}
        </div>
      </div>
    </div>
  );
}

function ThreadListSkeleton() {
  return (
    <ul className="divide-y divide-border">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-11 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-44" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ThreadMessagesSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-14 w-3/5 rounded-2xl" />
      <Skeleton className="ml-auto h-10 w-2/5 rounded-2xl" />
      <Skeleton className="h-16 w-3/5 rounded-2xl" />
      <Skeleton className="ml-auto h-12 w-1/2 rounded-2xl" />
    </div>
  );
}
