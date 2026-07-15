import type { LucideIcon } from 'lucide-react';
import { FileText, Inbox, Send, Star, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type FolderKey = 'inbox' | 'sent' | 'important' | 'drafts' | 'trash';

interface FolderDef {
  key: FolderKey;
  label: string;
  icon: LucideIcon;
}

const FOLDERS: FolderDef[] = [
  { key: 'inbox', label: 'In Arrivo', icon: Inbox },
  { key: 'sent', label: 'Inviata', icon: Send },
  { key: 'important', label: 'Importanti', icon: Star },
  { key: 'drafts', label: 'Bozze', icon: FileText },
  { key: 'trash', label: 'Cestino', icon: Trash2 },
];

interface LabelDef {
  key: string;
  label: string;
  dot: string;
  count: number;
}

interface FolderSidebarProps {
  active: FolderKey;
  onSelect: (key: FolderKey) => void;
  counts: Record<FolderKey, number>;
  labels: LabelDef[];
}

export function FolderSidebar({ active, onSelect, counts, labels }: FolderSidebarProps) {
  return (
    <div className="flex h-full flex-col">
      <p className="text-card-title text-navy">Cartelle</p>

      <nav className="mt-4 space-y-1">
        {FOLDERS.map(({ key, label, icon: Icon }) => {
          const isActive = active === key;
          const count = counts[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
                isActive ? 'bg-primary/10 font-semibold text-primary' : 'text-navy hover:bg-slate-50',
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1 text-left">{label}</span>
              {count > 0 &&
                (key === 'inbox' ? (
                  <Badge variant="primary">{count}</Badge>
                ) : (
                  <span className="text-xs font-medium text-muted">{count}</span>
                ))}
            </button>
          );
        })}
      </nav>

      <div className="my-5 border-t border-border" />

      <p className="text-eyebrow">Etichette</p>
      <ul className="mt-3 space-y-2">
        {labels.map((l) => (
          <li key={l.key} className="flex items-center gap-3 px-3 py-1.5 text-sm text-navy">
            <span className={cn('size-2.5 shrink-0 rounded-full', l.dot)} />
            <span className="flex-1">{l.label}</span>
            <span className="text-xs font-medium text-muted">{l.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
