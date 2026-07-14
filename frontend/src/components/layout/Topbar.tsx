import { Search, Bell, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Sticky top bar: global search, notifications, primary CTA. */
export function Topbar() {
  return (
    <header className="sticky top-0 z-20 flex h-[72px] items-center gap-4 border-b border-border bg-background/80 px-6 backdrop-blur">
      {/* Search */}
      <div className="relative w-full max-w-md">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          placeholder="Cerca immobili, proprietari, contratti…"
          className="h-11 w-full rounded-full border border-border bg-white pl-11 pr-4 text-sm text-navy placeholder:text-muted focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
        />
      </div>

      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          aria-label="Notifiche"
          className="relative flex size-11 items-center justify-center rounded-full border border-border bg-white text-navy transition-colors hover:bg-slate-50"
        >
          <Bell className="size-5" />
          <span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-danger ring-2 ring-white" />
        </button>

        <Button>
          <Plus className="size-4" />
          Aggiungi Immobile
        </Button>
      </div>
    </header>
  );
}
