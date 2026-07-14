import { LayoutGrid, List } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUiStore, type PropertyViewMode } from '@/store/ui';

const OPTIONS: { mode: PropertyViewMode; icon: typeof LayoutGrid; label: string }[] = [
  { mode: 'grid', icon: LayoutGrid, label: 'Griglia' },
  { mode: 'list', icon: List, label: 'Lista' },
];

export function ViewToggle() {
  const view = useUiStore((s) => s.propertyView);
  const setView = useUiStore((s) => s.setPropertyView);

  return (
    <div className="flex items-center gap-1 rounded-xl border border-border bg-white p-1">
      {OPTIONS.map(({ mode, icon: Icon, label }) => (
        <button
          key={mode}
          type="button"
          aria-label={label}
          aria-pressed={view === mode}
          onClick={() => setView(mode)}
          className={cn(
            'flex size-9 items-center justify-center rounded-lg transition-colors',
            view === mode ? 'bg-primary text-white' : 'text-muted hover:bg-slate-100',
          )}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}
