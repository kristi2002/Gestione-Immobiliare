import { Search } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { formatTime, initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { CommunicationSummary } from '../api';

function fullName(c: CommunicationSummary): string {
  return `${c.name ?? ''} ${c.surname ?? ''}`.trim() || 'Senza nome';
}

interface MessageListProps {
  items: CommunicationSummary[];
  isLoading: boolean;
  search: string;
  onSearch: (value: string) => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export function MessageList({ items, isLoading, search, onSearch, selectedId, onSelect }: MessageListProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="relative shrink-0">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Cerca…"
          className="pl-11"
        />
      </div>

      <div className="-mx-2 mt-4 flex-1 overflow-y-auto pr-1">
        {isLoading ? (
          <SkeletonRows />
        ) : items.length === 0 ? (
          <EmptyState title="Nessun messaggio" description="Questa cartella è vuota." />
        ) : (
          <ul className="space-y-1">
            {items.map((item) => {
              const isSelected = selectedId === item.id;
              const isUnread = item.last_message_direction === 'received';
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(item.id)}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-xl border-l-2 px-3 py-3 text-left transition-colors',
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-transparent hover:bg-slate-50',
                    )}
                  >
                    <Avatar className="mt-0.5 size-9">
                      <AvatarFallback>{initials(fullName(item))}</AvatarFallback>
                    </Avatar>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p
                          className={cn(
                            'min-w-0 flex-1 truncate text-sm text-navy',
                            isUnread ? 'font-semibold' : 'font-medium',
                          )}
                        >
                          {fullName(item)}
                        </p>
                        <span className="shrink-0 text-xs text-muted">
                          {item.last_message_at ? formatTime(item.last_message_at) : ''}
                        </span>
                      </div>

                      <p className={cn('mt-0.5 truncate text-xs', isUnread ? 'text-navy/80' : 'text-muted')}>
                        {item.last_message_preview || 'Nessun messaggio'}
                      </p>

                      <div className="mt-1.5">
                        <Badge variant="success">Proprietari</Badge>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <ul className="space-y-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="flex items-start gap-3 px-3 py-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
        </li>
      ))}
    </ul>
  );
}
